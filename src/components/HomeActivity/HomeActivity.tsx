import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import { getUser, type Connection } from 'home-assistant-js-websocket';
import type { HassEntities } from '../../types';
import { HOUSE_EVENTS_ENTITY } from '../../config/entities';
import { useSwipeToClose } from '../../hooks';
import './HomeActivity.css';

/** One published house-event row — see config/entities.ts's HOUSE_EVENTS_ENTITY doc for the
 * backend contract. `tsMs` is pre-parsed (rather than kept as the raw ISO string) so nothing
 * downstream needs to re-parse it, and so a malformed timestamp is caught once, at parse time.
 * `cause`/`effect` are set together, or not at all (see `parseHouseEvents`) — `EventRow` shows
 * `effect` as the row's headline (falling back to plain `text` for events the backend hasn't
 * upgraded to publish both halves of yet), with `cause` underneath as a muted second line — the
 * reverse of the hierarchy implied by `text`'s own "cause -> effect" wording, matching HA's own
 * Activity view (action first, explanation second). `by` is a newer, independently-optional field
 * (a person's display name, e.g. "Mikkel") rendered as a third, more-muted "By {by}" line when
 * present. */
interface HouseEvent {
  tsMs: number;
  icon: string;
  text: string;
  cause?: string;
  effect?: string;
  by?: string;
  /** 'admin' = shown only to HA admin viewers (Mikkel) — plumbing-level entries (override
   * expiries, self-heals, his own room's automations) the housemates shouldn't wade through.
   * Absent = everyone. Mirrors the backend's v5 `audience` field; any other value is dropped
   * at parse time so a future backend change can't accidentally hide rows from admins. */
  audience?: 'admin';
}

// Mirrors the backend's own documented cap (AppDaemon HouseEvents keeps at most 40) — re-applied
// here defensively since attributes.events is external data, never trusted blind.
const MAX_EVENTS = 40;

/** Defensively parses `attributes.events` into newest-first {@link HouseEvent}s: array check,
 * per-item ts/text string checks, a fallback icon, and a hard cap — one malformed publish can't
 * crash the card or blow up the DOM. Order is trusted as newest-first (the backend's documented
 * contract), not re-sorted here. `cause`/`effect` are optional, upgraded-backend fields — kept on
 * the parsed event only when BOTH are strings that are still non-empty after trimming; otherwise
 * left unset entirely, so `EventRow` never has to re-check trimmed-emptiness itself. `by` is
 * independent of cause/effect — kept whenever it's a string that's still non-empty after
 * trimming, unset otherwise. */
function parseHouseEvents(value: unknown): HouseEvent[] {
  if (!Array.isArray(value)) return [];

  const events: HouseEvent[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.ts !== 'string' || typeof item.text !== 'string') continue;

    const tsMs = new Date(item.ts).getTime();
    if (!Number.isFinite(tsMs)) continue; // unparseable timestamp — nothing downstream can place this event on the timeline

    const cause = typeof item.cause === 'string' ? item.cause.trim() : '';
    const effect = typeof item.effect === 'string' ? item.effect.trim() : '';
    const hasCauseEffect = cause.length > 0 && effect.length > 0;

    const by = typeof item.by === 'string' ? item.by.trim() : '';

    events.push({
      tsMs,
      text: item.text,
      icon: typeof item.icon === 'string' ? item.icon : 'mdi:information-outline',
      cause: hasCauseEffect ? cause : undefined,
      effect: hasCauseEffect ? effect : undefined,
      by: by.length > 0 ? by : undefined,
      audience: item.audience === 'admin' ? 'admin' : undefined,
    });
    if (events.length >= MAX_EVENTS) break;
  }
  return events;
}

/** Whether the logged-in HA user is an admin — the feed's audience gate (see HouseEvent.audience).
 * `null` while resolving, and on failure it stays `false`: the restricted view is the safe
 * default, so a slow user fetch briefly hides admin rows from Mikkel rather than ever flashing
 * them at a housemate. */
function useIsAdminViewer(): boolean | null {
  const connection = useHass(s => s.connection);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    getUser(connection as Connection)
      .then(user => {
        if (!cancelled) setIsAdmin(user.is_admin === true);
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connection]);
  return isAdmin;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "09:32" — 24h, zero-padded (mirrors DishwasherCard/WasherCard/DryerCard's own
 * `toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })`). */
function formatHHMM(d: Date): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "Today" / "Yesterday" / "Monday 14 July" — a day-group header, a pure function of two fixed
 * instants (the event's own timestamp and the modal's own now-tick), never the ambient clock. Mirrors
 * HA 2026's own Activity view: anything older than yesterday spells out the full weekday, day, and
 * month (no year — the feed is ephemeral and never holds more than a handful of days, see
 * HOUSE_EVENTS_ENTITY/MAX_EVENTS). */
function formatDayHeader(tsMs: number, nowMs: number): string {
  const eventDate = new Date(tsMs);
  const nowDate = new Date(nowMs);
  if (sameLocalDay(eventDate, nowDate)) return 'Today';

  const yesterday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 1);
  if (sameLocalDay(eventDate, yesterday)) return 'Yesterday';

  return eventDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

interface DayGroup {
  header: string;
  events: HouseEvent[];
}

/** Buckets newest-first `events` into day groups for the timeline's day headers (`formatDayHeader`)
 * and its rail: each group renders as its own contiguous block so the connector line
 * (HomeActivity.css) never bridges across a day boundary, and a `:last-child` rule scoped to a
 * group only ever hides that group's own trailing line. Groups by actual calendar day
 * (`sameLocalDay`) rather than by the header string, so two genuinely different days can never
 * merge just because their formatted labels happened to collide. */
function groupEventsByDay(events: HouseEvent[], nowMs: number): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const event of events) {
    const prevGroup = groups[groups.length - 1];
    const prevEvent = prevGroup?.events[prevGroup.events.length - 1];
    if (prevEvent && sameLocalDay(new Date(event.tsMs), new Date(prevEvent.tsMs))) {
      prevGroup.events.push(event);
    } else {
      groups.push({ header: formatDayHeader(event.tsMs, nowMs), events: [event] });
    }
  }
  return groups;
}

interface EventRowProps {
  event: HouseEvent;
}

/** Color tone for an event's rail circle, derived from the mdi icon the feed already carries —
 * the icon IS the backend's category signal, so no schema change is needed and every entry
 * (old or new) gets a tone. Prefix matching keeps this robust to icon variants (mdi:lock vs
 * mdi:lock-open-variant). Unknown icons fall back to the neutral slate tone. Tones map to
 * .home-activity-tone-* rules in HomeActivity.css. */
function eventTone(icon: string): string {
  const name = icon.startsWith('mdi:') ? icon.slice(4) : icon;
  if (/^(washing-machine|dishwasher|tumble-dryer|basket)/.test(name)) return 'appliance';
  if (/^(television|radio|cast|speaker)/.test(name)) return 'media';
  if (/^lock/.test(name)) return 'lock';
  if (/^(bell|doorbell|door)/.test(name)) return 'door';
  if (/^(hand-back|lightbulb|white-balance-sunny|ceiling-light)/.test(name)) return 'light';
  if (/^(blinds|weather)/.test(name)) return 'sun';
  return 'neutral';
}

/** One timeline row: an absolute HH:MM on the left, the event's icon on the rail (see
 * HomeActivity.css for the connecting line) in a category-toned circle, and up to three content
 * lines — `effect` (or plain `text`, for events the backend hasn't upgraded to publish
 * cause/effect for yet) as the headline, `cause` underneath as the muted "why", and `by`
 * underneath that as a still-more-muted "By {name}" credit. */
function EventRow({ event }: EventRowProps) {
  const date = new Date(event.tsMs);
  return (
    <div className='home-activity-row'>
      <span className='home-activity-row-time' title={date.toLocaleString('en-GB')}>
        {formatHHMM(date)}
        {/* Rows carrying audience:'admin' only ever render for admin viewers (filtered out for
            everyone else in HouseEventsModal), so this marker tells Mikkel "the housemates don't
            see this one" rather than announcing anything to them. */}
        {event.audience === 'admin' && (
          <span title='Only visible to you' aria-label='Only visible to you'>
            <Icon icon='mdi:eye-off-outline' className='home-activity-row-adminmark' aria-hidden='true' />
          </span>
        )}
      </span>
      <div className='home-activity-row-rail'>
        <span className={`home-activity-row-icon-circle home-activity-tone-${eventTone(event.icon)}`}>
          <Icon icon={event.icon} className='home-activity-row-icon' aria-hidden='true' />
        </span>
      </div>
      <div className='home-activity-row-content'>
        <span className='home-activity-row-title'>{event.effect ?? event.text}</span>
        {event.cause != null && <span className='home-activity-row-cause'>{event.cause}</span>}
        {event.by != null && <span className='home-activity-row-by'>By {event.by}</span>}
      </div>
    </div>
  );
}

interface HouseEventsModalProps {
  entities: HassEntities;
  onClose: () => void;
}

/** "Home activity" — an Activity-timeline view (mimics HA 2026's own Activity view: day-grouped,
 * newest-first, absolute times) of what the house just did, for non-technical housemates (see
 * HOUSE_EVENTS_ENTITY). Hosted by QuickAccess's own qa-button (icon 'mdi:history', title "House
 * activity") rather than a permanent spot in the room grid; this component owns its own
 * overlay/modal chrome (mirrors PriceAdvisor.tsx's self-contained modal) since QuickAccess's shared
 * modal chrome is reserved for its own body-only content (intercom/media/transit/weather). Open
 * state, Android back, and history all live in QuickAccess (the same
 * `openQuickAccess`/`requestCloseQuickAccess` mechanism as its other modals) — this component only
 * mounts while open and calls `onClose` rather than managing its own `isOpen` or pushing a second
 * history entry. */
export function HouseEventsModal({ entities, onClose }: HouseEventsModalProps) {
  // Depends on the whole `entities` map, matching HomePulse's own `deriveHomePulseSummary` memo —
  // this component is handed the whole map as a prop (not a scoped `useHass` selector), so that's
  // the granularity sibling code already re-derives at.
  const allEvents = useMemo(() => parseHouseEvents(entities?.[HOUSE_EVENTS_ENTITY]?.attributes?.events), [entities]);

  // Audience gate: admin viewers (Mikkel) get the full feed incl. plumbing-level entries; everyone
  // else — including the brief null while the user lookup resolves — gets only the shared-space
  // events. See useIsAdminViewer/HouseEvent.audience.
  const isAdmin = useIsAdminViewer();
  const events = useMemo(() => (isAdmin ? allEvents : allEvents.filter(e => e.audience !== 'admin')), [allEvents, isAdmin]);

  // Same now-tick pattern as PriceAdvisor.tsx: state + a 60s interval, so nothing else in this
  // component reads Date.now()/new Date() during render — only the interval callback (an
  // external-timer subscription) sets state, never the effect body itself. Drives the day-group
  // headers' Today/Yesterday boundary below, so it keeps flipping correctly at midnight even if the
  // modal is left open across it.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowMs = now.getTime();

  const groups = groupEventsByDay(events, nowMs);

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
          {groups.length === 0 ? (
            <div className='home-activity-empty'>Nothing yet — the house will explain what it does here.</div>
          ) : (
            groups.map(group => (
              <div className='home-activity-group' key={`${group.header}-${group.events[0].tsMs}`}>
                <div className='home-activity-day-header'>{group.header}</div>
                {group.events.map((event, index) => (
                  <EventRow key={`${event.tsMs}-${index}`} event={event} />
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
