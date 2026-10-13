import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import { HOUSE_EVENTS_ENTITY } from '../../config/entities';
import { formatApplianceEta } from '../../energy/applianceRun';
import { formatHomeClock } from '../../energy/homeTime';
import {
  canViewerSeeKind,
  episodeCandidates,
  houseEpisodes,
  houseEventLabel,
  parseHouseEvents,
  visibleHouseEvents,
} from '../../home/houseEvents';
import { MotionScopeContext, useMotionSlot } from '../../home/motionBudget';
import { NOW_RESOLVE_GIVE_UP_MS, resolveNowFocus, type NowResolution } from '../../home/nowResolve';
import { readUpcoming, upcomingCandidates, type UpcomingAppliance } from '../../home/upcoming';
import { useNowMs } from '../../hooks/useNowMs';
import { useTrackedEntities } from '../../hooks/useTrackedEntities';
import { useViewer } from '../../hooks/useViewer';
import { formatKWh } from '../../utils/format';
import type { NowFocus } from '../../utils/navigation';
import { SkyStrip } from '../Home/LivingSky';
import { buildNowTimeline, dayBreaks, rowTone, type PastRow, type PlanRow, type RunningRow } from './nowModel';
import './NowView.css';

/** How long a focused item keeps its ring, in ms; its glow plays three times within it. */
const FOCUS_MS = 10_000;
const FOCUS_GLOW_MS = 3 * 3200;

interface RowShellProps {
  id: string;
  /** The rail's time and dot; null for a row that sits on the NOW line. */
  time: string | null;
  tone: string | null;
  focused: boolean;
  className?: string;
  children: ReactNode;
}

function RowShell({ id, time, tone, focused, className = '', children }: RowShellProps) {
  return (
    <div className={`now-ev ${className} ${focused ? 'is-focus' : ''}`} data-row-id={id} data-focus={focused ? id : undefined}>
      <span className='now-t'>{time}</span>
      {tone ? (
        <span className={`now-dot tone-${tone}`}>
          <i />
        </span>
      ) : (
        <span aria-hidden='true' />
      )}
      {children}
    </div>
  );
}

/** A row's body: a tap opens the room that owns it, when one does. */
function RowBody({
  areaId,
  onOpenRoom,
  className,
  label,
  children,
}: {
  areaId: string | null;
  onOpenRoom: (areaId: string) => void;
  className: string;
  label: string;
  children: ReactNode;
}) {
  return areaId ? (
    <button type='button' className={`${className} is-link`} onClick={() => onOpenRoom(areaId)} aria-label={label}>
      {children}
    </button>
  ) : (
    <div className={className} role='group' aria-label={label}>
      {children}
    </div>
  );
}

function PastEpisode({
  row,
  age,
  focused,
  onOpenRoom,
}: {
  row: PastRow;
  age: number;
  focused: boolean;
  onOpenRoom: (areaId: string) => void;
}) {
  const rows = row.episode.rows;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const cause = first.cause;
  const effectText = cause ? (houseEventLabel(last) ?? last.effect ?? last.text) : first.text;
  const by = rows.find(event => event.by)?.by;
  return (
    <RowShell
      id={row.id}
      time={formatHomeClock(row.atMs)}
      tone={rowTone(first)}
      focused={focused}
      className={`is-past age-${Math.min(age, 3)}`}
    >
      <RowBody
        areaId={row.areaId}
        onOpenRoom={onOpenRoom}
        className='now-body'
        label={[cause, last.effect ?? last.text].filter(Boolean).join(', ')}
      >
        {cause && (
          <span className={`now-chip tone-${rowTone(first)}`}>
            <Icon icon={first.icon} />
            <span className='now-chip-text'>{cause}</span>
          </span>
        )}
        <span className='now-effect'>
          {cause && (
            <span className='now-arr' aria-hidden='true'>
              <Icon icon='mdi:arrow-right' />
            </span>
          )}
          <span className={`now-chip is-tone tone-${rowTone(last)}`}>
            <Icon icon={cause ? last.icon : first.icon} />
            {by && <span className='now-mini'>{by.charAt(0).toUpperCase()}</span>}
            <span className='now-chip-text'>{effectText}</span>
            {row.restricted && <Icon icon='mdi:eye-off-outline' className='now-chip-adm' role='img' aria-label='Not everyone sees this' />}
          </span>
        </span>
      </RowBody>
    </RowShell>
  );
}

/** Labels the monitors publish when they do not know the programme. */
const UNKNOWN_PROGRAMMES = new Set(['unknown', 'auto (unconfirmed)']);

function ApplianceTitle({ item }: { item: UpcomingAppliance }) {
  const programme = item.cycle.programme && !UNKNOWN_PROGRAMMES.has(item.cycle.programme.toLowerCase()) ? item.cycle.programme : null;
  return (
    <b>
      <span className='now-pt-name'>
        {item.appliance.config.label}
        {programme ? ` · ${programme}` : ''}
      </span>
    </b>
  );
}

/** A running or paused appliance, on the NOW line: when it started goes in the card, not on the rail. */
function RunningCard({ row, focused, onOpenRoom }: { row: RunningRow; focused: boolean; onOpenRoom: (areaId: string) => void }) {
  const { cycle, appliance, announce } = row.item;
  const sheen = useMotionSlot(`sheen:${row.id}`, 'appliance', cycle.status === 'running');
  const pct = Math.round(cycle.progressPct ?? 0);
  const parts = [
    row.atMs != null ? `since ${formatHomeClock(row.atMs)}` : null,
    cycle.status === 'paused' ? `paused at ${pct} %` : `${pct} %`,
    cycle.status !== 'paused' && cycle.energyKwh ? formatKWh(cycle.energyKwh, 2) : null,
  ];
  return (
    <RowShell id={row.id} time={null} tone={null} focused={focused} className='is-live'>
      <RowBody areaId={row.areaId} onOpenRoom={onOpenRoom} className='now-card is-run' label={`${appliance.config.label}, ${pct} %`}>
        <span className='now-ph'>
          <span className='now-ico tone-sky'>
            <Icon icon={appliance.config.icon} />
          </span>
          <span className='now-pt'>
            <ApplianceTitle item={row.item} />
            <small>{parts.filter(Boolean).join(' · ')}</small>
          </span>
          <span className='now-when'>
            <Icon icon={cycle.status === 'paused' ? 'mdi:pause' : 'mdi:clock-outline'} />
            {formatApplianceEta(cycle) ?? '—'}
          </span>
        </span>
        <span className={`now-prog ${sheen ? 'is-anim' : ''}`}>
          <i style={{ width: `${pct}%` }} />
        </span>
        {announce && (
          <span className='now-status tone-purple'>
            <Icon icon='mdi:bullhorn-outline' />
            Announces when done
          </span>
        )}
      </RowBody>
    </RowShell>
  );
}

function PlanCard({
  row,
  isAdmin,
  focused,
  onOpenRoom,
}: {
  row: PlanRow;
  isAdmin: boolean;
  focused: boolean;
  onOpenRoom: (areaId: string) => void;
}) {
  const item = row.item;
  if (item.type === 'wake') {
    return (
      <RowShell id={row.id} time={item.clock} tone='gold' focused={focused} className={item.enabled ? '' : 'is-off'}>
        <RowBody
          areaId={row.areaId}
          onOpenRoom={onOpenRoom}
          className='now-card'
          label={`Wake alarm ${item.clock}, ${item.enabled ? 'on' : 'off'}`}
        >
          <span className='now-ph'>
            <span className='now-ico tone-gold'>
              <Icon icon='mdi:alarm' />
            </span>
            <span className='now-pt'>
              <b>
                <span className='now-pt-name'>Wake routine</span>
                {isAdmin && <Icon icon='mdi:eye-off-outline' className='now-adm' aria-label='Only you see this' />}
              </b>
              <small>{item.enabled ? 'Alarm on' : 'Alarm off'}</small>
            </span>
            <span className={`now-when ${item.enabled ? '' : 'is-off'}`}>
              <Icon icon={item.enabled ? 'mdi:alarm-check' : 'mdi:alarm-off'} />
              {item.clock}
            </span>
          </span>
        </RowBody>
      </RowShell>
    );
  }
  const cleaning = item.vacuumState === 'cleaning' || item.vacuumState === 'returning';
  return (
    <RowShell id={row.id} time='—' tone='green' focused={focused}>
      <RowBody areaId={row.areaId} onOpenRoom={onOpenRoom} className='now-card' label='Rober2'>
        <span className='now-ph'>
          <span className='now-ico tone-green'>
            <Icon icon='mdi:robot-vacuum' />
          </span>
          <span className='now-pt'>
            <b>
              <span className='now-pt-name'>Rober2 cleans</span>
            </b>
            <small>{item.narrative ?? item.rooms.join(', ')}</small>
          </span>
          <span className='now-when'>
            <Icon icon={cleaning ? 'mdi:play' : 'mdi:pause'} />
            {cleaning ? 'cleaning' : 'waiting'}
          </span>
        </span>
      </RowBody>
    </RowShell>
  );
}

function NowLine({ nowMs, missing }: { nowMs: number; missing: boolean }) {
  const pulsing = useMotionSlot('now-pulse', 'nowPulse', true);
  return (
    <>
      <div className='now-line' data-row-id='now'>
        <span className='now-t'>{formatHomeClock(nowMs)}</span>
        <span className='now-dot is-now'>
          <i className={pulsing ? 'is-anim' : ''} />
        </span>
        <span className='now-rule' />
        <span className='now-lbl'>now</span>
      </div>
      {missing && (
        <div className='now-missing' role='status' data-now-missing=''>
          <Icon icon='mdi:calendar-remove-outline' />
          Event no longer available
        </div>
      )}
    </>
  );
}

export interface NowViewProps {
  focus: NowFocus | null;
  /** The exact item to focus, which an in-app tap knows; a link only names a kind and a second. */
  itemId?: string | null;
  /** `cold`: the app opened on this link, or Back returned to it; `warm`: pushed in from the grid. */
  arrival: 'cold' | 'warm';
  onBack: () => void;
  onOpenRoom: (areaId: string) => void;
}

/** The `#now` timeline: what the house did, what runs now, and what comes next, opened on the item a
 * link names. */
export function NowView({ focus, itemId, arrival, onBack, onOpenRoom }: NowViewProps) {
  const entities = useTrackedEntities();
  const hassUrl = useHass(s => s.hassUrl);
  const viewer = useViewer();
  const nowMs = useNowMs();
  const feed = entities[HOUSE_EVENTS_ENTITY]?.attributes?.events;
  const episodes = useMemo(() => houseEpisodes(visibleHouseEvents(parseHouseEvents(feed), viewer)), [feed, viewer]);
  const upcoming = useMemo(() => readUpcoming(id => entities[id], nowMs, viewer), [entities, nowMs, viewer]);
  const timeline = useMemo(() => buildNowTimeline(episodes, upcoming), [episodes, upcoming]);

  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGaveUp(true), NOW_RESOLVE_GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, []);
  // A hit is kept at once. A miss is not final before the wait is over: the store a warm link finds may
  // be stale, and the row it names can land a moment after the view opens.
  const candidates = useMemo(() => [...episodeCandidates(episodes), ...upcomingCandidates(upcoming)], [episodes, upcoming]);
  const liveResolution = resolveNowFocus(focus, candidates, gaveUp, itemId);
  const [resolution, setResolution] = useState<NowResolution | null>(null);
  if (resolution == null && liveResolution.status !== 'pending') setResolution(liveResolution);
  const focusedId = resolution?.status === 'found' ? resolution.id : null;
  const missing = resolution?.status === 'unavailable' && focus != null && canViewerSeeKind(focus.kind, viewer);

  const [focusShown, setFocusShown] = useState(true);
  useEffect(() => {
    if (!focusedId) return;
    const timer = setTimeout(() => setFocusShown(false), FOCUS_MS);
    return () => clearTimeout(timer);
  }, [focusedId]);
  const glowing = useMotionSlot('now-focus', 'oneShot', focusedId != null, FOCUS_GLOW_MS);
  const isFocused = (id: string) => focusShown && focusedId === id;

  // The view opens on the focused item, or on the NOW line, and holds it there while rows and icons
  // load above it, until the viewer scrolls.
  const scrollRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const userMovedRef = useRef(false);
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const rail = railRef.current;
    const spacer = spacerRef.current;
    if (!scroller || !rail || !spacer) return;
    const place = () => {
      if (userMovedRef.current) return;
      const target = focusedId ? scroller.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(focusedId)}"]`) : null;
      const anchor = target ?? scroller.querySelector<HTMLElement>('[data-row-id="now"]');
      if (!anchor) return;
      const top = Math.max(0, anchor.offsetTop - (target?.classList.contains('is-past') ? 8 : scroller.clientHeight * 0.36));
      // Room below the last row, so a focused item near the end can still sit at the top.
      spacer.style.height = target ? `${Math.max(0, top + scroller.clientHeight - rail.offsetHeight)}px` : '0px';
      scroller.scrollTop = top;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(rail);
    const stop = () => {
      userMovedRef.current = true;
    };
    const events = ['touchstart', 'wheel', 'pointerdown', 'keydown'] as const;
    events.forEach(name => scroller.addEventListener(name, stop, { passive: true }));
    return () => {
      observer.disconnect();
      events.forEach(name => scroller.removeEventListener(name, stop));
    };
  }, [focusedId]);

  const pastBreaks = dayBreaks(
    timeline.past.map(row => row.atMs),
    nowMs
  );
  const planBreaks = dayBreaks(
    timeline.plans.map(row => row.atMs),
    nowMs
  );

  return createPortal(
    <MotionScopeContext.Provider value='timeline'>
      <section className={`now-view ${arrival === 'warm' ? 'is-entering' : ''} ${glowing ? 'is-glowing' : ''}`} aria-label='Timeline'>
        <SkyStrip
          entities={entities}
          hassUrl={hassUrl}
          onBack={onBack}
          interactive={false}
          viewerName={viewer.name}
          className='now-strip'
        />
        <div className='now-scroll' ref={scrollRef}>
          <div className='now-rail' ref={railRef}>
            {timeline.past.map((row, index) => (
              <div key={row.id} className='now-group'>
                {pastBreaks[index] && <div className='now-day'>{pastBreaks[index]}</div>}
                <PastEpisode row={row} age={timeline.past.length - 1 - index} focused={isFocused(row.id)} onOpenRoom={onOpenRoom} />
              </div>
            ))}
            {timeline.running.map(row => (
              <RunningCard key={row.id} row={row} focused={isFocused(row.id)} onOpenRoom={onOpenRoom} />
            ))}
            <NowLine nowMs={nowMs} missing={missing} />
            {timeline.plans.map((row, index) => (
              <Fragment key={row.id}>
                {planBreaks[index] && <div className='now-day'>{planBreaks[index]}</div>}
                <PlanCard row={row} isAdmin={viewer.isAdmin === true} focused={isFocused(row.id)} onOpenRoom={onOpenRoom} />
              </Fragment>
            ))}
          </div>
          <div ref={spacerRef} aria-hidden='true' />
        </div>
      </section>
    </MotionScopeContext.Provider>,
    document.body
  );
}
