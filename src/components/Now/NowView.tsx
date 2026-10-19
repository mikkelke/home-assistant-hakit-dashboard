import { Fragment, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import {
  HOUSE_EVENTS_ENTITY,
  HOUSE_UPCOMING_ENTITY,
  QUIET_HOURS_END_ENTITY,
  QUIET_HOURS_START_ENTITY,
  SUN_ENTITY,
} from '../../config/entities';
import { withCoffeeDemo } from '../../coffee/demoStore';
import { brewProgressPct, phaseWord } from '../../coffee/model';
import { useCoffeeBrews, useCoffeeDemo, useCoffeeLive, useCoffeeRecipes, useCoffeeState } from '../../coffee/useCoffee';
import { brewName } from '../../coffee/view';
import { formatApplianceEta } from '../../energy/applianceRun';
import { formatHomeClock } from '../../energy/homeTime';
import {
  canViewerSeeKind,
  episodeCandidates,
  houseEpisodes,
  houseEventLabel,
  parseHouseEvents,
  visibleHouseEvents,
  type HouseEpisode,
} from '../../home/houseEvents';
import { canViewerSeeUpcoming, hasSheet, parseHouseUpcoming } from '../../home/houseUpcoming';
import { MARKERS } from '../../home/markers';
import { MotionScopeContext, useMotionSlot } from '../../home/motionBudget';
import { linkedRing, NOW_RESOLVE_GIVE_UP_MS, resolveNowFocus, resolveNowItem, type NowResolution } from '../../home/nowResolve';
import { isQuietAt, quietEndClock, readQuietHours, type QuietHours } from '../../home/quietHours';
import { applianceStarter, readUpcoming, upcomingCandidates, type UpcomingAppliance } from '../../home/upcoming';
import { useNowMs } from '../../hooks/useNowMs';
import { useTrackedEntities } from '../../hooks/useTrackedEntities';
import { useViewer } from '../../hooks/useViewer';
import { formatKWh } from '../../utils/format';
import type { NowFocus } from '../../utils/navigation';
import { series } from '../Coffee/chart';
import { Spark } from '../Coffee/Spark';
import { SkyStrip } from '../Home/LivingSky';
import { LazyBoundary } from '../Lazy/LazyBoundary';
import type { MapEntry } from '../Vacuum/maps';
import { formatRoberRoomName } from '../Vacuum/rooms';
import { mapEntryMs, roberRounds } from '../Vacuum/sessionRooms';
import {
  buildNowTimeline,
  dayBreaks,
  dayLabel,
  etaInQuietHours,
  rowTone,
  timelineMarkers,
  UP_TONES,
  type MarkerRow,
  type PastRow,
  type PlanRow,
  type RoomRow,
  type RoundSpan,
  type RunningRow,
  type UpRow,
} from './nowModel';
import { MaintSheet } from './MaintSheet';
import { useRoberMaps } from './useRoberMaps';
import './NowView.css';

const RingSheet = lazy(() => import('../Intercom/RingSheet'));
const RoomMapModal = lazy(() => import('../Vacuum/RoomMapModal'));

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

/** A row's body: a tap runs `onTap` when given, else opens the room that owns the row, when one does. */
function RowBody({
  areaId,
  onOpenRoom,
  onTap,
  className,
  label,
  children,
}: {
  areaId: string | null;
  onOpenRoom: (areaId: string) => void;
  onTap?: () => void;
  className: string;
  label: string;
  children: ReactNode;
}) {
  const open = onTap ?? (areaId ? () => onOpenRoom(areaId) : null);
  return open ? (
    <button type='button' className={`${className} is-link`} onClick={open} aria-label={label}>
      {children}
    </button>
  ) : (
    <div className={className} role='group' aria-label={label}>
      {children}
    </div>
  );
}

/** The classes that draw a row's piece of a Rober2 round's line. */
function roundClass(round: RoundSpan | null): string {
  return round == null ? '' : round === 'inner' ? 'in-round' : `in-round round-${round}`;
}

/** A room a Rober2 round cleaned: a tap opens the room, and its map button that room's map, from which the sheet steps
 * through the round's other rooms. */
function CleanedRoom({
  row,
  age,
  focused,
  onOpenRoom,
  onOpenMap,
}: {
  row: RoomRow;
  age: number;
  focused: boolean;
  onOpenRoom: (areaId: string) => void;
  onOpenMap: (maps: MapEntry[], index: number) => void;
}) {
  const name = formatRoberRoomName(row.map.room) ?? '';
  return (
    <RowShell
      id={row.id}
      time={formatHomeClock(row.atMs)}
      tone='green'
      focused={focused}
      className={`is-past is-room age-${Math.min(age, 3)} ${roundClass(row.round)}`}
    >
      <RowBody areaId={row.areaId} onOpenRoom={onOpenRoom} className='now-body' label={`${name} cleaned`}>
        <span className='now-chip tone-green'>
          <Icon icon='mdi:robot-vacuum' />
          <span className='now-chip-text'>{name} cleaned</span>
        </span>
      </RowBody>
      <button type='button' className='now-map' onClick={() => onOpenMap(row.maps, row.index)} aria-label={`${name} map`}>
        <Icon icon='mdi:map-outline' />
      </button>
    </RowShell>
  );
}

function PastEpisode({
  row,
  age,
  focused,
  onOpenRoom,
  onOpenRing,
}: {
  row: PastRow;
  age: number;
  focused: boolean;
  onOpenRoom: (areaId: string) => void;
  onOpenRing: (episode: HouseEpisode) => void;
}) {
  const rows = row.episode.rows;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const cause = first.cause;
  const effectText = cause ? (houseEventLabel(last) ?? last.effect ?? last.text) : first.text;
  const by = rows.find(event => event.by)?.by;
  const ring = row.episode.kind === 'ring';
  if (row.episode.kind === 'coffee' && !cause) {
    return <CoffeePastRow row={row} age={age} focused={focused} onOpenRoom={onOpenRoom} by={by} />;
  }
  return (
    <RowShell
      id={row.id}
      time={formatHomeClock(row.atMs)}
      tone={rowTone(first)}
      focused={focused}
      className={`is-past age-${Math.min(age, 3)} ${roundClass(row.round)}`}
    >
      <RowBody
        areaId={row.areaId}
        onOpenRoom={onOpenRoom}
        onTap={ring ? () => onOpenRing(row.episode) : undefined}
        className={ring ? 'now-body is-ring' : 'now-body'}
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
/** A finished brew in the past: its cup weight and curve when the ledger has it, else the feed's words. */
function CoffeePastRow({
  row,
  age,
  focused,
  onOpenRoom,
  by,
}: {
  row: PastRow;
  age: number;
  focused: boolean;
  onOpenRoom: (areaId: string) => void;
  by: string | undefined;
}) {
  const brews = useCoffeeBrews();
  const first = row.episode.rows[0];
  const brew = brews?.brews.find(item => item.outcome === 'complete' && item.atMs != null && Math.abs(item.atMs - row.atMs) < 20 * 60_000);
  const newest = brew != null && brews?.brews.find(item => item.outcome === 'complete')?.id === brew.id;
  const text = brew?.cupG != null ? `Coffee ${Math.round(brew.cupG)} g` : first.text;
  return (
    <RowShell
      id={row.id}
      time={formatHomeClock(row.atMs)}
      tone='copper'
      focused={focused}
      className={`is-past age-${Math.min(age, 3)} ${roundClass(row.round)}`}
    >
      <RowBody areaId={row.areaId} onOpenRoom={onOpenRoom} className='now-body' label={text}>
        <span className='now-chip is-tone tone-copper now-coffee-chip'>
          <Icon icon={first.icon} />
          {by && <span className='now-mini'>{by.charAt(0).toUpperCase()}</span>}
          <span className='now-chip-text'>{text}</span>
          {newest && brews?.lastCurve.length ? <Spark cup={series(brews.lastCurve, 4)} width={40} height={16} /> : null}
        </span>
      </RowBody>
    </RowShell>
  );
}

/** A brew on the NOW line: its stage, the one ETA, its live curve. */
function CoffeeRunningCard({ row, focused, onOpenRoom }: { row: RunningRow; focused: boolean; onOpenRoom: (areaId: string) => void }) {
  const state = useCoffeeState();
  const live = useCoffeeLive();
  const recipes = useCoffeeRecipes();
  const nowMs = useNowMs();
  const word = state ? phaseWord(state) : null;
  const title = `Coffee${word ? ` · ${word}` : ''}`;
  const sub = [
    state ? brewName(state, recipes?.usualName ?? null).replace(/^The /, 'the ') : null,
    state?.phase === 'paused' ? 'ETA after resume' : state?.etaMs != null ? `ready ≈ ${formatHomeClock(state.etaMs)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const pct = state ? brewProgressPct(state, nowMs) : 0;
  return (
    <RowShell id={row.id} time={null} tone='copper' focused={focused} className='is-live'>
      <RowBody
        areaId={row.areaId}
        onOpenRoom={onOpenRoom}
        className='now-card is-run is-coffee'
        label={[title, sub].filter(Boolean).join(', ')}
      >
        <span className='now-ph'>
          <span className='now-ico tone-copper'>
            <Icon icon='mdi:coffee' />
          </span>
          <span className='now-pt'>
            <b>
              <span className='now-pt-name'>{title}</span>
            </b>
            {sub && <small>{sub}</small>}
          </span>
          {live && live.cup.length > 1 && <Spark cup={series(live.cup, live.stepS)} width={46} height={22} />}
        </span>
        <span className='now-coffee-runbar' aria-hidden='true'>
          <i style={{ width: `${Math.round(pct)}%` }} />
        </span>
      </RowBody>
    </RowShell>
  );
}

function RunningCard({
  row,
  quiet,
  focused,
  onOpenRoom,
}: {
  row: RunningRow;
  quiet: QuietHours;
  focused: boolean;
  onOpenRoom: (areaId: string) => void;
}) {
  if (row.item.id === 'coffee') return <CoffeeRunningCard row={row} focused={focused} onOpenRoom={onOpenRoom} />;
  return <ApplianceRunningCard row={row} quiet={quiet} focused={focused} onOpenRoom={onOpenRoom} />;
}

function ApplianceRunningCard({
  row,
  quiet,
  focused,
  onOpenRoom,
}: {
  row: RunningRow;
  quiet: QuietHours;
  focused: boolean;
  onOpenRoom: (areaId: string) => void;
}) {
  const { cycle, appliance, announce } = row.item;
  const sheen = useMotionSlot(`sheen:${row.id}`, 'appliance', cycle.status === 'running');
  const startedBy = useHass(s => s.entities[appliance.config.stateEntityId]?.attributes?.started_by);
  const startedByMethod = useHass(s => s.entities[appliance.config.stateEntityId]?.attributes?.started_by_method);
  const pct = Math.round(cycle.progressPct ?? 0);
  const parts = [
    row.atMs != null ? `since ${formatHomeClock(row.atMs)}` : null,
    applianceStarter(startedBy, startedByMethod),
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
          <span className='now-statuses'>
            <span className='now-status tone-purple'>
              <Icon icon='mdi:bullhorn-outline' />
              Finish announcements on
            </span>
            {etaInQuietHours(cycle, quiet) && (
              <span className='now-status tone-slate'>
                <Icon icon='mdi:volume-off' />
                ETA in quiet hours
              </span>
            )}
          </span>
        )}
      </RowBody>
    </RowShell>
  );
}

function Marker({ row, focused }: { row: MarkerRow; focused: boolean }) {
  const { icon, word, tone } = MARKERS[row.id];
  return (
    <RowShell id={row.id} time={formatHomeClock(row.atMs)} tone={tone} focused={focused} className='is-marker'>
      <span className={`now-mark tone-${tone}`}>
        <Icon icon={icon} />
        {word}
        {row.until && <small>until {row.until}</small>}
      </span>
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
            <Icon icon={cleaning ? 'mdi:play' : 'mdi:home-export-outline'} />
            {cleaning ? 'cleaning' : 'all out'}
          </span>
        </span>
      </RowBody>
    </RowShell>
  );
}

/** A `sensor.house_upcoming` row, drawn like the Rober2 card: no buttons, a tap opens its sheet when it has one
 * (a maintenance row with a guide or a Done button), else its room. */
function UpCard({
  row,
  focused,
  onOpenRoom,
  onOpenSheet,
}: {
  row: UpRow;
  focused: boolean;
  onOpenRoom: (areaId: string) => void;
  onOpenSheet: (id: string) => void;
}) {
  const up = row.row;
  const tone = UP_TONES[up.kind];
  return (
    <RowShell id={row.id} time={up.atMs != null ? formatHomeClock(up.atMs) : null} tone={tone} focused={focused}>
      <RowBody
        areaId={up.areaId}
        onOpenRoom={onOpenRoom}
        onTap={hasSheet(up) ? () => onOpenSheet(up.id) : undefined}
        className='now-card'
        label={[up.title, up.detail, up.chip].filter(Boolean).join(', ')}
      >
        <span className='now-ph'>
          <span className={`now-ico tone-${tone}`}>
            <Icon icon={up.icon} />
          </span>
          <span className='now-pt'>
            <b>
              <span className='now-pt-name'>{up.title}</span>
              {(up.adminOnly || up.users) && <Icon icon='mdi:eye-off-outline' className='now-adm' aria-label='Not everyone sees this' />}
            </b>
            {up.detail && <small>{up.detail}</small>}
          </span>
        </span>
        {up.chip && (
          <span className='now-statuses'>
            <span className='now-status tone-rose'>
              <Icon icon='mdi:alert-outline' />
              {up.chip}
            </span>
          </span>
        )}
      </RowBody>
    </RowShell>
  );
}

function NowLine({ nowMs, missing, quietUntil }: { nowMs: number; missing: boolean; quietUntil: string | null }) {
  const pulsing = useMotionSlot('now-pulse', 'nowPulse', true);
  return (
    <>
      <div className='now-line' data-row-id='now'>
        <span className='now-t'>{formatHomeClock(nowMs)}</span>
        <span className='now-dot is-now'>
          <i className={pulsing ? 'is-anim' : ''} />
        </span>
        <span className='now-rule' />
        {quietUntil && (
          <span className='now-quiet' data-now-quiet=''>
            <Icon icon='mdi:volume-off' />
            Quiet until {quietUntil}
          </span>
        )}
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
  /** The link has just arrived, rather than Back, Forward or a reload returning to its entry: a ring it names opens
   * with its sheet up. */
  linkArrived?: boolean;
  onBack: () => void;
  onOpenRoom: (areaId: string) => void;
}

/** The `#now` timeline: what the house did, what runs now, and what comes next, opened on the item a
 * link names. */
export function NowView({ focus, itemId, arrival, linkArrived = false, onBack, onOpenRoom }: NowViewProps) {
  const entities = useTrackedEntities();
  const hassUrl = useHass(s => s.hassUrl);
  const viewer = useViewer();
  const nowMs = useNowMs();
  const feed = entities[HOUSE_EVENTS_ENTITY]?.attributes?.events;
  const episodes = useMemo(() => houseEpisodes(visibleHouseEvents(parseHouseEvents(feed), viewer)), [feed, viewer]);
  const coffeeDemo = useCoffeeDemo();
  const upcoming = useMemo(
    () =>
      readUpcoming(
        withCoffeeDemo(id => entities[id]),
        nowMs,
        viewer
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `coffeeDemo` is what a ?coffee_demo= preview changes
    [entities, nowMs, viewer, coffeeDemo]
  );
  // Primitive selectors: `sun.sun` changes every few minutes, but these values only a few times a day.
  const nextRising = useHass(s => s.entities[SUN_ENTITY]?.attributes?.next_rising);
  const nextSetting = useHass(s => s.entities[SUN_ENTITY]?.attributes?.next_setting);
  const quietStart = useHass(s => s.entities[QUIET_HOURS_START_ENTITY]?.state);
  const quietEnd = useHass(s => s.entities[QUIET_HOURS_END_ENTITY]?.state);
  const quiet = useMemo(() => readQuietHours(quietStart, quietEnd), [quietStart, quietEnd]);
  const markers = useMemo(() => timelineMarkers(nextRising, nextSetting, quiet, nowMs), [nextRising, nextSetting, quiet, nowMs]);
  const upAttributes = entities[HOUSE_UPCOMING_ENTITY]?.attributes;
  const upRows = useMemo(
    () => parseHouseUpcoming(upAttributes, nowMs).filter(row => canViewerSeeUpcoming(row, viewer)),
    [upAttributes, nowMs, viewer]
  );
  const roberMaps = useRoberMaps(episodes);
  const rounds = useMemo(() => roberRounds(episodes, roberMaps), [episodes, roberMaps]);
  const timeline = useMemo(
    () => buildNowTimeline(episodes, upcoming, markers, upRows, rounds),
    [episodes, upcoming, markers, upRows, rounds]
  );
  // A ring tapped elsewhere in the app, such as in the ticker, opens the timeline on its row with its sheet up.
  const [ring, setRing] = useState<HouseEpisode | null>(() =>
    arrival === 'warm' && itemId ? (episodes.find(episode => episode.id === itemId && episode.kind === 'ring') ?? null) : null
  );
  const [roomMaps, setRoomMaps] = useState<{ maps: MapEntry[]; index: number } | null>(null);
  // The row whose sheet is open, by id: the sheet reads the live row, so it follows a Done and closes with the row.
  const [sheetId, setSheetId] = useState<string | null>(null);
  const sheetRow = sheetId == null ? null : (upRows.find(row => row.id === sheetId && hasSheet(row)) ?? null);
  const mapWhen = (map: MapEntry) => {
    const atMs = mapEntryMs(map);
    return atMs == null ? '' : `${dayLabel(atMs, nowMs)} ${formatHomeClock(atMs)}`;
  };

  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGaveUp(true), NOW_RESOLVE_GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, []);
  // A hit is kept at once. A miss is not final before the wait is over: the store a warm link finds may
  // be stale, and the row it names can land a moment after the view opens.
  const candidates = useMemo(() => [...episodeCandidates(episodes), ...upcomingCandidates(upcoming)], [episodes, upcoming]);
  const rowIds = useMemo(() => [...timeline.past, ...timeline.running, ...timeline.future].map(row => row.id), [timeline]);
  const liveResolution = focus ? resolveNowFocus(focus, candidates, gaveUp, itemId) : resolveNowItem(itemId, rowIds, gaveUp);
  const [resolution, setResolution] = useState<NowResolution | null>(null);
  if (resolution == null && liveResolution.status !== 'pending') setResolution(liveResolution);
  const focusedId = resolution?.status === 'found' ? resolution.id : null;
  const missing = resolution?.status === 'unavailable' && (focus != null ? canViewerSeeKind(focus.kind, viewer) : itemId != null);
  // Opened once, as the link resolves, so the sheet stays closed after the viewer closes it.
  const [linkSheetDue, setLinkSheetDue] = useState(linkArrived);
  if (linkSheetDue && resolution != null) {
    setLinkSheetDue(false);
    const linked = linkedRing(focus, resolution, episodes);
    if (linked) setRing(linked);
  }

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
  const futureBreaks = dayBreaks(
    timeline.future.map(row => row.atMs),
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
                {row.type === 'room' ? (
                  <CleanedRoom
                    row={row}
                    age={timeline.past.length - 1 - index}
                    focused={isFocused(row.id)}
                    onOpenRoom={onOpenRoom}
                    onOpenMap={(maps, index) => setRoomMaps({ maps, index })}
                  />
                ) : (
                  <PastEpisode
                    row={row}
                    age={timeline.past.length - 1 - index}
                    focused={isFocused(row.id)}
                    onOpenRoom={onOpenRoom}
                    onOpenRing={setRing}
                  />
                )}
              </div>
            ))}
            {timeline.running.map(row => (
              <RunningCard key={row.id} row={row} quiet={quiet} focused={isFocused(row.id)} onOpenRoom={onOpenRoom} />
            ))}
            <NowLine nowMs={nowMs} missing={missing} quietUntil={isQuietAt(quiet, nowMs) ? quietEndClock(quiet) : null} />
            {timeline.future.map((row, index) => (
              <Fragment key={row.id}>
                {futureBreaks[index] && <div className='now-day'>{futureBreaks[index]}</div>}
                {row.type === 'marker' ? (
                  <Marker row={row} focused={isFocused(row.id)} />
                ) : row.type === 'up' ? (
                  <UpCard row={row} focused={isFocused(row.id)} onOpenRoom={onOpenRoom} onOpenSheet={setSheetId} />
                ) : (
                  <PlanCard row={row} isAdmin={viewer.isAdmin === true} focused={isFocused(row.id)} onOpenRoom={onOpenRoom} />
                )}
              </Fragment>
            ))}
          </div>
          <div ref={spacerRef} aria-hidden='true' />
        </div>
      </section>
      {ring && (
        <LazyBoundary fallback={null} error={null}>
          <RingSheet episode={ring} onClose={() => setRing(null)} />
        </LazyBoundary>
      )}
      {sheetRow && <MaintSheet row={sheetRow} isAdmin={viewer.isAdmin === true} onClose={() => setSheetId(null)} onOpenRoom={onOpenRoom} />}
      {roomMaps && (
        <LazyBoundary fallback={null} error={null}>
          <RoomMapModal
            maps={roomMaps.maps}
            start={roomMaps.index}
            historyKey='rober-session-map'
            when={mapWhen}
            onClose={() => setRoomMaps(null)}
          />
        </LazyBoundary>
      )}
    </MotionScopeContext.Provider>,
    document.body
  );
}
