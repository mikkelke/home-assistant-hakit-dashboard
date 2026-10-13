import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import { HOUSE_EVENTS_ENTITY } from '../../config/entities';
import { parseHouseEvents, visibleHouseEvents, type HouseEvent } from '../../home/houseEvents';
import { useSwipeToClose, useViewer } from '../../hooks';
import './HomeActivity.css';

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
        {/* Restricted rows only ever render for viewers allowed to see them (HouseEventsModal's
            audience gate), so the marker explains restriction to the included — "the others don't
            see this one" — rather than announcing anything to the excluded. Named, not "you"
            (user 2026-07-30): whoever is looking at the screen reads the same words. Mikkel is
            the admin, so "admin rows" read as his. */}
        {(event.audience === 'admin' || event.audienceUsers) && (
          <span
            title={event.audienceUsers ? `Visible only to ${event.audienceUsers.join(', ')} and Mikkel` : 'Visible only to Mikkel'}
            aria-label='Restricted visibility'
          >
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

  // Audience gate: admin viewers (Mikkel) get the full feed incl. plumbing-level entries. Everyone
  // else — including the brief null while the user lookup resolves — gets the shared-space events
  // plus any rows naming them in audienceUsers (e.g. Claudia sees her own room's overrides). See
  // useViewer/HouseEvent.audience/audienceUsers.
  const viewer = useViewer();
  const events = useMemo(() => visibleHouseEvents(allEvents, viewer), [allEvents, viewer]);

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
