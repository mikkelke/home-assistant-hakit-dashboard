import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import { HOUSE_EVENTS_ENTITY } from '../../config/entities';
import { useSwipeToClose } from '../../hooks';
import './HomeActivity.css';

/** One published house-event row — see config/entities.ts's HOUSE_EVENTS_ENTITY doc for the
 * backend contract. `tsMs` is pre-parsed (rather than kept as the raw ISO string) so nothing
 * downstream needs to re-parse it, and so a malformed timestamp is caught once, at parse time.
 * `cause`/`effect` are set together, or not at all (see `parseHouseEvents`) — `EventRow` renders
 * them as two lines when both are present, and falls back to plain `text` otherwise (`text` is
 * always parsed regardless, since it's also the backend's own "cause -> effect" wording of the same
 * content, and the only thing to show for events the backend hasn't upgraded to publish both halves
 * of yet). */
interface HouseEvent {
  tsMs: number;
  icon: string;
  text: string;
  cause?: string;
  effect?: string;
}

// Mirrors the backend's own documented cap (AppDaemon HouseEvents keeps at most 40) — re-applied
// here defensively since attributes.events is external data, never trusted blind.
const MAX_EVENTS = 40;

const JUST_NOW_MS = 90_000;
const HOUR_MS = 60 * 60_000;

/** Defensively parses `attributes.events` into newest-first {@link HouseEvent}s: array check,
 * per-item ts/text string checks, a fallback icon, and a hard cap — one malformed publish can't
 * crash the card or blow up the DOM. Order is trusted as newest-first (the backend's documented
 * contract), not re-sorted here. `cause`/`effect` are optional, upgraded-backend fields — kept on
 * the parsed event only when BOTH are strings that are still non-empty after trimming; otherwise
 * left unset entirely, so `EventRow` never has to re-check trimmed-emptiness itself. */
function parseHouseEvents(value: unknown): HouseEvent[] {
  if (!Array.isArray(value)) return [];

  const events: HouseEvent[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.ts !== 'string' || typeof item.text !== 'string') continue;

    const tsMs = new Date(item.ts).getTime();
    if (!Number.isFinite(tsMs)) continue; // unparseable timestamp — the relative-time formatter needs a real instant

    const cause = typeof item.cause === 'string' ? item.cause.trim() : '';
    const effect = typeof item.effect === 'string' ? item.effect.trim() : '';
    const hasCauseEffect = cause.length > 0 && effect.length > 0;

    events.push({
      tsMs,
      text: item.text,
      icon: typeof item.icon === 'string' ? item.icon : 'mdi:information-outline',
      cause: hasCauseEffect ? cause : undefined,
      effect: hasCauseEffect ? effect : undefined,
    });
    if (events.length >= MAX_EVENTS) break;
  }
  return events;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "09:32" — 24h, zero-padded (mirrors DishwasherCard/WasherCard/DryerCard's own
 * `toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })`). */
function formatHHMM(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "just now" / "X min ago" / "HH:MM" (today) / "Yesterday HH:MM" / "Mon DD HH:MM" — a pure
 * function of two fixed instants, never the ambient clock (see HomeActivity's own now-tick).
 * Month/day is pinned to 'en-US' (month before day, English abbreviation) rather than the
 * browser's default locale, which elsewhere in this app is Danish and would otherwise print
 * day-before-month with a Danish month name. A negative diff (event ts arriving slightly ahead of
 * `nowMs`, e.g. clock skew) is clamped to 0 rather than shown as a negative age. */
function formatEventTime(tsMs: number, nowMs: number): string {
  const diffMs = Math.max(0, nowMs - tsMs);
  if (diffMs < JUST_NOW_MS) return 'just now';
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / 60_000)} min ago`;

  const eventDate = new Date(tsMs);
  const nowDate = new Date(nowMs);
  if (sameLocalDay(eventDate, nowDate)) return formatHHMM(eventDate);

  const yesterday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 1);
  if (sameLocalDay(eventDate, yesterday)) return `Yesterday ${formatHHMM(eventDate)}`;

  return `${eventDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${formatHHMM(eventDate)}`;
}

interface EventRowProps {
  event: HouseEvent;
  nowMs: number;
}

/** One event line — reused as-is for both the collapsed card and the "Show all" modal. Renders a
 * muted "cause" line over a normal-weight "effect" line when the event has both (the icon stays to
 * the left, spanning both lines via the row's own flex layout — see HomeActivity.css); falls back
 * to the single plain `text` line otherwise. */
function EventRow({ event, nowMs }: EventRowProps) {
  const hasCauseEffect = event.cause != null && event.effect != null;
  return (
    <div className='home-activity-row'>
      <Icon icon={event.icon} className='home-activity-row-icon' aria-hidden='true' />
      {hasCauseEffect ? (
        <div className='home-activity-row-lines'>
          <span className='home-activity-row-cause'>{event.cause}</span>
          <span className='home-activity-row-effect'>{event.effect}</span>
        </div>
      ) : (
        <span className='home-activity-row-text'>{event.text}</span>
      )}
      <span className='home-activity-row-time'>{formatEventTime(event.tsMs, nowMs)}</span>
    </div>
  );
}

interface HouseEventsModalProps {
  entities: HassEntities;
  onClose: () => void;
}

/** "Home activity" — a plain-English feed of what the house just did, for non-technical
 * housemates (see HOUSE_EVENTS_ENTITY). Hosted by QuickAccess's own qa-button (icon 'mdi:history',
 * title "House activity") rather than a permanent spot in the room grid; this component owns its
 * own overlay/modal chrome (mirrors PriceAdvisor.tsx's self-contained modal) since QuickAccess's
 * shared modal chrome is reserved for its own body-only content (intercom/media/transit/weather).
 * Open state, Android back, and history all live in QuickAccess (the same
 * `openQuickAccess`/`requestCloseQuickAccess` mechanism as its other modals) — this component only
 * mounts while open and calls `onClose` rather than managing its own `isOpen` or pushing a second
 * history entry. */
export function HouseEventsModal({ entities, onClose }: HouseEventsModalProps) {
  // Depends on the whole `entities` map, matching HomePulse's own `deriveHomePulseSummary` memo —
  // this component is handed the whole map as a prop (not a scoped `useHass` selector), so that's
  // the granularity sibling code already re-derives at.
  const events = useMemo(() => parseHouseEvents(entities?.[HOUSE_EVENTS_ENTITY]?.attributes?.events), [entities]);

  // Same now-tick pattern as PriceAdvisor.tsx: state + a 60s interval, so nothing else in this
  // component reads Date.now()/new Date() during render — only the interval callback (an
  // external-timer subscription) sets state, never the effect body itself.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowMs = now.getTime();

  // QuickAccess's own useSwipeToClose call only wires up its shared .qa-modal — this modal has its
  // own wrapper element instead (see this component's own doc), so it needs its own swipe handlers.
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(onClose);

  return (
    <div className='home-activity-overlay' onClick={onClose}>
      <div
        className='home-activity-modal'
        role='dialog'
        aria-modal='true'
        aria-labelledby='home-activity-title'
        onClick={e => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className='home-activity-modal-header'>
          <span className='home-activity-modal-title' id='home-activity-title'>
            Home activity
          </span>
          <button className='home-activity-close modal-close-button' onClick={onClose} aria-label='Close'>
            <Icon icon='mdi:close' />
          </button>
        </div>

        <div className='home-activity-modal-body'>
          {events.map((event, index) => (
            <EventRow key={`${event.tsMs}-${index}`} event={event} nowMs={nowMs} />
          ))}
        </div>
      </div>
    </div>
  );
}
