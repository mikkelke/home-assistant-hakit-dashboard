import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import { HOUSE_EVENTS_ENTITY } from '../../config/entities';
import { useModalBackButton, useSwipeToClose } from '../../hooks';
import './HomeActivity.css';

/** One published house-event row — see config/entities.ts's HOUSE_EVENTS_ENTITY doc for the
 * backend contract. `tsMs` is pre-parsed (rather than kept as the raw ISO string) so nothing
 * downstream needs to re-parse it, and so a malformed timestamp is caught once, at parse time. */
interface HouseEvent {
  tsMs: number;
  icon: string;
  text: string;
}

const COLLAPSED_COUNT = 3;
// Mirrors the backend's own documented cap (AppDaemon HouseEvents keeps at most 40) — re-applied
// here defensively since attributes.events is external data, never trusted blind.
const MAX_EVENTS = 40;

const JUST_NOW_MS = 90_000;
const HOUR_MS = 60 * 60_000;

/** Defensively parses `attributes.events` into newest-first {@link HouseEvent}s: array check,
 * per-item ts/text string checks, a fallback icon, and a hard cap — one malformed publish can't
 * crash the card or blow up the DOM. Order is trusted as newest-first (the backend's documented
 * contract), not re-sorted here. */
function parseHouseEvents(value: unknown): HouseEvent[] {
  if (!Array.isArray(value)) return [];

  const events: HouseEvent[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.ts !== 'string' || typeof item.text !== 'string') continue;

    const tsMs = new Date(item.ts).getTime();
    if (!Number.isFinite(tsMs)) continue; // unparseable timestamp — the relative-time formatter needs a real instant

    events.push({ tsMs, text: item.text, icon: typeof item.icon === 'string' ? item.icon : 'mdi:information-outline' });
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

/** One event line — reused as-is for both the collapsed card and the "Show all" modal. */
function EventRow({ event, nowMs }: EventRowProps) {
  return (
    <div className='home-activity-row'>
      <Icon icon={event.icon} className='home-activity-row-icon' aria-hidden='true' />
      <span className='home-activity-row-text'>{event.text}</span>
      <span className='home-activity-row-time'>{formatEventTime(event.tsMs, nowMs)}</span>
    </div>
  );
}

interface HomeActivityProps {
  entities: HassEntities;
}

/** "Home activity" — a plain-English feed of what the house just did, for non-technical
 * housemates (see HOUSE_EVENTS_ENTITY). Collapsed to the newest 3 events; "Show all" opens a
 * modal with the full (backend-capped) list. Renders nothing when the feed is missing or empty —
 * there's no useful empty state to show a housemate. */
export function HomeActivity({ entities }: HomeActivityProps) {
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

  const [isOpen, setIsOpen] = useState(false);
  const handleClose = useCallback(() => setIsOpen(false), []);
  const { requestClose } = useModalBackButton({ isOpen, onRequestClose: handleClose, historyKey: 'home-activity' });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestClose);

  if (events.length === 0) return null;

  const collapsed = events.slice(0, COLLAPSED_COUNT);
  const hasMore = events.length > COLLAPSED_COUNT;

  return (
    <>
      <section className='home-activity' aria-label='Home activity'>
        <div className='home-activity-card'>
          <div className='home-activity-header'>
            <Icon icon='mdi:history' className='home-activity-header-icon' aria-hidden='true' />
            <span className='home-activity-header-label'>Home activity</span>
          </div>

          <div className='home-activity-rows'>
            {collapsed.map((event, index) => (
              <EventRow key={`${event.tsMs}-${index}`} event={event} nowMs={nowMs} />
            ))}
          </div>

          {hasMore && (
            <button type='button' className='home-activity-show-all' onClick={() => setIsOpen(true)}>
              Show all
            </button>
          )}
        </div>
      </section>

      {isOpen && (
        <div className='home-activity-overlay' onClick={requestClose}>
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
              <button className='home-activity-close modal-close-button' onClick={requestClose} aria-label='Close'>
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
      )}
    </>
  );
}
