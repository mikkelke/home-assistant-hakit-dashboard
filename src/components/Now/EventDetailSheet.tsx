import { useEffect, useMemo, useState } from 'react';
import { useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import { formatHomeClock } from '../../energy/homeTime';
import { formatMinSec } from '../../coffee/model';
import { useCoffeeBrews, useCoffeeRecent, useCoffeeRecipes } from '../../coffee/useCoffee';
import { brewName } from '../../coffee/view';
import {
  DELIVERY_ENTITY,
  ROBER_AREA_ENTITY,
  applianceRun,
  arrivalPath,
  bedtimesIn,
  brewForRow,
  detailEntities,
  detailWindow,
  doorRowsNear,
  earlierArrivals,
  formatOffset,
  nightSummary,
  numeric,
  roberRound,
  runFinishBefore,
  unlockMethod,
  woltOrder,
  type DeliverySnapshot,
  type DetailSpec,
  type HistorySpec,
} from '../../home/eventDetail';
import { fetchAttributeHistory, fetchEventHistory, type HistoryPoint } from '../../home/eventHistory';
import { houseEventLabel, type HouseEvent } from '../../home/houseEvents';
import { ArchiveImage } from '../Archive/ArchiveMedia';
import { fetchMapsIndex, type MapEntry } from '../Vacuum/maps';
import { formatRoberRoomName } from '../Vacuum/rooms';
import { ApplianceSheet } from '../Appliance';
import '../Appliance/Appliance.css';
import { pastBrewInputs } from '../Coffee/chart';
import { ChartBox } from '../Coffee/ChartBox';
import { LOOK_HIST } from '../Coffee/looks';
import { TasteDot } from '../Coffee/taste';
import '../Coffee/Coffee.css';
import { EventChart } from './EventChart';
import { PlantSoilChart } from './PlantSoilChart';
import { dayLabel } from './nowModel';
import './EventDetailSheet.css';

type Load = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; history: Record<string, HistoryPoint[]> };

/** The recorder's states for a sheet, read once per open and again when the sheet moves to another row. */
function useDetailHistory(spec: HistorySpec, nowMs: number): Load {
  const connection = useHass(s => s.connection);
  const { startMs, endMs } = detailWindow(spec, nowMs);
  const entities = detailEntities(spec).join(',');
  const key = `${entities}|${startMs}|${endMs}`;
  const [answer, setAnswer] = useState<{ key: string; load: Load } | null>(null);
  useEffect(() => {
    if (!connection) return;
    let live = true;
    fetchEventHistory(connection, entities.split(','), startMs, endMs).then(
      history => live && setAnswer({ key, load: { status: 'ready', history } }),
      () => live && setAnswer({ key, load: { status: 'failed' } })
    );
    return () => {
      live = false;
    };
  }, [connection, entities, startMs, endMs, key]);
  return answer?.key === key ? answer.load : { status: 'loading' };
}

function Headline({ before, after, note }: { before: string; after: string; note?: string | null }) {
  return (
    <div className='evd-headline'>
      <span className='evd-num'>{before}</span>
      <Icon icon='mdi:arrow-right' className='evd-arrow' aria-hidden='true' />
      <span className='evd-num'>{after}</span>
      {note && <span className='evd-note'>{note}</span>}
    </div>
  );
}

function Status({ load }: { load: Load }) {
  if (load.status === 'loading') return <p className='evd-empty'>Loading…</p>;
  if (load.status === 'failed') return <p className='evd-empty'>Home Assistant did not answer. Close and open it again.</p>;
  return null;
}

function PlantBody({ spec }: { spec: Extract<DetailSpec, { kind: 'plant' }> }) {
  const live = useHass(s => s.entities[spec.entity]?.state);
  const nowValue = Number(live);
  return (
    <>
      <Headline
        before={spec.low != null ? `${spec.low}%` : '–'}
        after={spec.peak != null ? `${spec.peak}%` : '–'}
        note={live != null && live !== '' && Number.isFinite(nowValue) ? `now ${Math.round(nowValue)}%` : null}
      />
      <PlantSoilChart entity={spec.entity} atMs={spec.atMs} name={spec.name} />
      <p className='evd-caption'>Soil moisture, a day either side of the watering.</p>
    </>
  );
}

/** "2 h 10 min", "45 min". */
function hoursMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

const FINISHED_KWH = /used (\d+(?:\.\d+)?) kWh/;

function ApplianceBody({
  spec,
  event,
  events,
  nowMs,
}: {
  spec: Extract<DetailSpec, { kind: 'appliance' }>;
  event: HouseEvent;
  events: readonly HouseEvent[];
  nowMs: number;
}) {
  const load = useDetailHistory(spec, nowMs);
  const { startMs, endMs } = detailWindow(spec, nowMs);
  const finishMs = useMemo(
    () => (!spec.emptied ? spec.atMs : load.status === 'ready' ? runFinishBefore(load.history[spec.stateEntity] ?? [], spec.atMs) : null),
    [load, spec]
  );
  const run = useMemo(
    () =>
      load.status === 'ready' && finishMs != null
        ? applianceRun(load.history[spec.stateEntity] ?? [], load.history[spec.powerEntity] ?? [], finishMs)
        : null,
    [load, spec, finishMs]
  );
  // An emptied row does not carry the run's energy; its finished row does.
  const kwh = useMemo(() => {
    if (spec.kwh != null || finishMs == null) return spec.kwh;
    const finished = events.find(
      e => e.icon !== 'mdi:basket-check' && Math.abs(e.tsMs - finishMs) <= 5 * 60_000 && FINISHED_KWH.test(e.text)
    );
    const match = finished ? FINISHED_KWH.exec(finished.text) : null;
    return match ? Number(match[1]) : null;
  }, [events, finishMs, spec.kwh]);
  const chartStart = run?.startMs != null ? Math.max(startMs, run.startMs - 10 * 60_000) : startMs;
  const chartEnd = spec.emptied && finishMs != null ? Math.min(endMs, finishMs + 10 * 60_000) : endMs;
  const sat = spec.emptied && finishMs != null ? Math.round((spec.atMs - finishMs) / 60_000) : null;
  if (spec.emptied && load.status === 'ready' && finishMs == null) {
    return <p className='evd-empty'>No finished run in the day before this.</p>;
  }
  return (
    <>
      <Headline
        before={kwh != null ? `${kwh.toFixed(2)} kWh` : '–'}
        after={run?.minutes != null ? hoursMinutes(run.minutes) : '–'}
        note={run?.startMs != null && finishMs != null ? `${formatHomeClock(run.startMs)}–${formatHomeClock(finishMs)}` : null}
      />
      {spec.emptied && sat != null && (
        <p className='evd-lead'>
          Emptied {formatHomeClock(spec.atMs)}
          {event.by ? ` by ${event.by}` : ''}, {hoursMinutes(sat)} after it finished
        </p>
      )}
      {load.status === 'ready' && finishMs != null ? (
        <EventChart
          points={numeric(load.history[spec.powerEntity] ?? [])}
          startMs={chartStart}
          endMs={chartEnd}
          eventMs={finishMs}
          markMs={run?.startMs ?? null}
          unit=' W'
          label={`${spec.label} power`}
        />
      ) : (
        <Status load={load} />
      )}
      <p className='evd-caption'>Power through the run{run?.peakW != null ? `, peak ${Math.round(run.peakW)} W` : ''}.</p>
    </>
  );
}

function ArrivalBody({
  spec,
  nowMs,
  events,
  onPick,
}: {
  spec: Extract<DetailSpec, { kind: 'arrival' }>;
  nowMs: number;
  events: readonly HouseEvent[];
  onPick: (event: HouseEvent) => void;
}) {
  const load = useDetailHistory(spec, nowMs);
  const path = useMemo(() => (load.status === 'ready' ? arrivalPath(load.history, spec.resident, spec.atMs) : null), [load, spec]);
  const earlier = useMemo(() => earlierArrivals(events, spec.resident, spec.atMs), [events, spec]);
  const unlock = path?.steps.find(step => step.key === 'unlock');
  return (
    <>
      {path ? (
        <>
          <p className='evd-lead'>
            Home {formatHomeClock(path.anchorMs)}
            {unlock?.offsetS != null && unlock.offsetS < 0 && path.doorSeen
              ? ` · unlocked ${-unlock.offsetS} s before the door opened`
              : ''}
          </p>
          <ol className='evd-path'>
            {path.steps.map(step => (
              <li key={step.key} className={step.atMs == null ? 'is-missing' : undefined}>
                <span className='evd-path-dot' aria-hidden='true' />
                <span className='evd-path-label'>{step.label}</span>
                <span className='evd-path-time'>
                  {step.atMs == null
                    ? 'not seen'
                    : step.key === 'door'
                      ? formatHomeClock(step.atMs)
                      : `${formatHomeClock(step.atMs)} · ${formatOffset(step.offsetS ?? 0)}`}
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <Status load={load} />
      )}
      {earlier.length > 0 && (
        <>
          <h3 className='evd-sub'>Earlier arrivals</h3>
          <ul className='evd-earlier'>
            {earlier.map(event => (
              <li key={`${event.tsMs}|${event.text}`}>
                <button type='button' onClick={() => onPick(event)}>
                  <span>
                    {dayLabel(event.tsMs, nowMs)} {formatHomeClock(event.tsMs)}
                  </span>
                  <span className='evd-earlier-how'>{unlockMethod(event)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** How a brew went: beans in and cup out, its curve over the band it was compared with, and what was brewed. */
function CoffeeBody({ spec }: { spec: Extract<DetailSpec, { kind: 'coffee' }> }) {
  const brews = useCoffeeBrews();
  const recipes = useCoffeeRecipes();
  const brew = brews ? brewForRow(brews.brews, spec.atMs) : null;
  const { data: recent, status } = useCoffeeRecent(brew != null, brews?.brews[0]?.id ?? null);
  if (!brew) return <p className='evd-empty'>{brews ? 'No record of this brew.' : 'Loading…'}</p>;
  const inputs = pastBrewInputs(recent, brew.id);
  const made = [
    brewName({ variant: brew.variant, recipeName: brew.recipeName }, recipes?.usualName ?? null),
    brew.beanName,
    brew.grind != null ? `grind ${brew.grind}` : null,
    brew.drawdownS != null ? `drawdown ${formatMinSec(brew.drawdownS)}` : null,
  ].filter((part, index, parts) => part && parts.indexOf(part) === index);
  return (
    <>
      <Headline
        before={brew.doseG != null ? `${brew.doseG} g` : '–'}
        after={brew.cupG != null ? `${Math.round(brew.cupG)} g` : '–'}
        note={brew.totalS != null ? formatMinSec(brew.totalS) : null}
      />
      {inputs ? (
        <ChartBox look={LOOK_HIST} mode='hist' height={170} label='This brew over the band it was compared with' {...inputs} />
      ) : (
        <p className='evd-empty'>{status === 'loading' ? 'Loading…' : 'No curve for this brew.'}</p>
      )}
      <p className='evd-caption'>Beans in, cup out. {made.join(' · ')}</p>
      {brew.rating && <TasteDot taste={brew.rating} long />}
    </>
  );
}

/** The maps index, read once per open. */
function useRoberMapsIndex(): MapEntry[] | null {
  const [maps, setMaps] = useState<MapEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    fetchMapsIndex().then(
      entries => live && setMaps(entries),
      () => live && setMaps([])
    );
    return () => {
      live = false;
    };
  }, []);
  return maps;
}

/** A Rober2 round: how long, how much floor, the rooms it did with their maps, and the rooms it left out. */
function RoberBody({
  spec,
  events,
  nowMs,
}: {
  spec: Extract<DetailSpec, { kind: 'rober' }>;
  events: readonly HouseEvent[];
  nowMs: number;
}) {
  const load = useDetailHistory(spec, nowMs);
  const maps = useRoberMapsIndex();
  const round = useMemo(
    () => (load.status === 'ready' && maps ? roberRound(events, maps, load.history[ROBER_AREA_ENTITY] ?? [], spec.atMs) : null),
    [load, maps, events, spec]
  );
  const [picked, setPicked] = useState<number | null>(null);
  if (!round) return load.status === 'ready' ? <p className='evd-empty'>Loading…</p> : <Status load={load} />;
  const lastMs = round.endMs ?? round.lastRoomMs;
  const minutes = round.startMs != null && lastMs != null ? Math.round((lastMs - round.startMs) / 60_000) : null;
  const shown = round.rooms[picked ?? round.rooms.length - 1];
  const name = (slug: string) => formatRoberRoomName(slug) ?? slug;
  return (
    <>
      <Headline
        before={`${round.rooms.length} room${round.rooms.length === 1 ? '' : 's'}`}
        after={minutes != null ? hoursMinutes(minutes) : '–'}
        note={round.areaM2 != null ? `${round.areaM2} m²` : null}
      />
      <ul className='evd-facts'>
        {round.startMs != null && (
          <li>
            <span>Started</span>
            <span>{formatHomeClock(round.startMs)}</span>
          </li>
        )}
        {round.endMs == null && round.lastRoomMs != null && (
          <li>
            <span>Last room</span>
            <span>{formatHomeClock(round.lastRoomMs)}</span>
          </li>
        )}
        {round.endMs != null && (
          <li>
            <span>Ended</span>
            <span>
              {formatHomeClock(round.endMs)}
              {round.endReason ? ` · ${round.endReason}` : ''}
            </span>
          </li>
        )}
        {round.skipped.length > 0 && (
          <li>
            <span>Left out</span>
            <span>{round.skipped.join(', ')}</span>
          </li>
        )}
      </ul>
      {round.rooms.length > 0 ? (
        <>
          <div className='evd-rooms'>
            {round.rooms.map((room, index) => (
              <button key={`${room.room}|${room.atMs}`} type='button' aria-pressed={room === shown} onClick={() => setPicked(index)}>
                {name(room.room)} {formatHomeClock(room.atMs)}
              </button>
            ))}
          </div>
          {shown && <ArchiveImage className='evd-map' path={shown.map.url} alt={`${name(shown.room)} map`} />}
        </>
      ) : (
        <p className='evd-empty'>No room maps saved for this round.</p>
      )}
    </>
  );
}

type WoltLoad = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; snapshots: DeliverySnapshot[] };

/** A Wolt order's way to the door: ordered, picked up, at the door, the first promised time against the real one,
 * and how the courier got in. */
function WoltBody({ spec, events }: { spec: Extract<DetailSpec, { kind: 'wolt' }>; events: readonly HouseEvent[] }) {
  const connection = useHass(s => s.connection);
  const [load, setLoad] = useState<WoltLoad>({ status: 'loading' });
  useEffect(() => {
    if (!connection) return;
    let live = true;
    fetchAttributeHistory(connection, DELIVERY_ENTITY, spec.atMs - 2 * 3_600_000, spec.atMs + 60_000).then(
      points =>
        live &&
        setLoad({
          status: 'ready',
          snapshots: points.map(p => ({
            ts: p.ts,
            deliveries: Array.isArray(p.attributes.deliveries) ? (p.attributes.deliveries as DeliverySnapshot['deliveries']) : [],
          })),
        }),
      () => live && setLoad({ status: 'failed' })
    );
    return () => {
      live = false;
    };
  }, [connection, spec.atMs]);
  if (load.status !== 'ready') return <Status load={load} />;
  const order = woltOrder(load.snapshots, spec.title, spec.atMs);
  const late = order.firstEtaMs != null ? Math.round((order.deliveredMs - order.firstEtaMs) / 60_000) : null;
  const door = doorRowsNear(events, (order.arrivingMs ?? order.pickedUpMs ?? spec.atMs) - 2 * 60_000, spec.atMs + 10 * 60_000);
  const steps: [string, number | null][] = [
    ['Ordered', order.orderedMs],
    ['Picked up', order.pickedUpMs],
    ['At the door', order.arrivingMs],
    ['Delivered', order.deliveredMs],
  ];
  return (
    <>
      <Headline
        before={order.firstEtaMs != null ? formatHomeClock(order.firstEtaMs) : '–'}
        after={formatHomeClock(order.deliveredMs)}
        note={late == null ? null : late === 0 ? 'on time' : late > 0 ? `${late} min late` : `${-late} min early`}
      />
      <ol className='evd-path'>
        {steps.map(([label, atMs]) => (
          <li key={label} className={atMs == null ? 'is-missing' : undefined}>
            <span className='evd-path-dot' aria-hidden='true' />
            <span className='evd-path-label'>{label}</span>
            <span className='evd-path-time'>{atMs == null ? 'not seen' : formatHomeClock(atMs)}</span>
          </li>
        ))}
      </ol>
      <h3 className='evd-sub'>At the door</h3>
      {door.length > 0 ? (
        <ul className='evd-facts'>
          {door.map(e => (
            <li key={`${e.tsMs}|${e.text}`}>
              <span>{e.cause ?? e.text}</span>
              <span>
                {formatHomeClock(e.tsMs)}
                {e.cause ? ` · ${houseEventLabel(e) ?? e.effect ?? ''}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className='evd-empty'>No ring or unlock around the delivery.</p>
      )}
    </>
  );
}

/** The night: when it started and ended and who went to bed; for the bedroom's sleeper, its feel temperature, CO2
 * and when it called for heat. */
function NightBody({
  spec,
  events,
  nowMs,
  showBedroom,
}: {
  spec: Extract<DetailSpec, { kind: 'night' }>;
  events: readonly HouseEvent[];
  nowMs: number;
  showBedroom: boolean;
}) {
  const load = useDetailHistory(spec, nowMs);
  const night = useMemo(() => (load.status === 'ready' ? nightSummary(load.history, spec.atMs, nowMs) : null), [load, spec, nowMs]);
  if (!night) return <Status load={load} />;
  const endMs = night.endMs ?? nowMs;
  const minutes = Math.round((endMs - spec.atMs) / 60_000);
  const beds = bedtimesIn(events, spec.atMs, endMs);
  return (
    <>
      <Headline
        before={formatHomeClock(spec.atMs)}
        after={night.endMs != null ? formatHomeClock(night.endMs) : 'now'}
        note={hoursMinutes(minutes)}
      />
      {beds.length > 0 && (
        <ul className='evd-facts'>
          {beds.map(e => (
            <li key={`${e.tsMs}|${e.by ?? ''}`}>
              <span>{e.by ?? 'Someone'} went to bed</span>
              <span>{formatHomeClock(e.tsMs)}</span>
            </li>
          ))}
        </ul>
      )}
      {showBedroom && (
        <>
          <h3 className='evd-sub'>Bedroom</h3>
          <EventChart
            points={night.feel}
            startMs={spec.atMs}
            endMs={endMs}
            eventMs={spec.atMs}
            unit=' °C'
            decimals={1}
            bands={night.heat}
            label='Bedroom temperature through the night'
          />
          <p className='evd-caption'>
            Feels {night.feelLow != null ? night.feelLow.toFixed(1) : '–'}–{night.feelHigh != null ? night.feelHigh.toFixed(1) : '–'} °C
            {night.heatMinutes > 0 ? `, heating ${hoursMinutes(night.heatMinutes)} (shaded)` : ', no heating'}.
          </p>
          <EventChart
            points={night.co2}
            startMs={spec.atMs}
            endMs={endMs}
            eventMs={spec.atMs}
            unit=' ppm'
            label='Bedroom CO2 through the night'
          />
          <p className='evd-caption'>CO₂{night.co2High != null ? `, highest ${Math.round(night.co2High)} ppm` : ''}.</p>
        </>
      )}
    </>
  );
}

const TITLES: Record<DetailSpec['kind'], (spec: DetailSpec) => string> = {
  plant: spec => (spec.kind === 'plant' ? `Watered ${spec.name}` : ''),
  appliance: spec => (spec.kind === 'appliance' ? `${spec.label} run` : ''),
  arrival: spec => (spec.kind === 'arrival' ? `${spec.resident.name} came home` : ''),
  coffee: () => 'Coffee',
  rober: () => 'Rober2 round',
  wolt: spec => (spec.kind === 'wolt' ? spec.title : ''),
  night: () => 'The night',
};

const APPLIANCE_ICONS = { washer: 'mdi:washing-machine', dryer: 'mdi:tumble-dryer', dish: 'mdi:dishwasher' } as const;

const ICONS: Record<DetailSpec['kind'], string> = {
  plant: 'mdi:watering-can-outline',
  appliance: 'mdi:washing-machine',
  arrival: 'mdi:home-import-outline',
  coffee: 'mdi:coffee',
  rober: 'mdi:robot-vacuum',
  wolt: 'mdi:moped',
  night: 'mdi:weather-night',
};

export interface EventDetailSheetProps {
  spec: DetailSpec;
  /** The row the sheet opened on: its time and who acted. */
  event: HouseEvent;
  /** Every row the timeline holds, for a resident's earlier arrivals. */
  events: readonly HouseEvent[];
  /** Another row to show instead, such as an earlier arrival. */
  onPick: (event: HouseEvent) => void;
  /** Whether the viewer sees the bedroom's night: the admin, who sleeps there. */
  isAdmin: boolean;
  onClose: () => void;
}

/** What a timeline row looked like before and after: a plant's soil around its watering, an appliance's power through
 * its run, a brew's curve, or one resident's way in through the apartment door. No buttons beyond close. */
export default function EventDetailSheet({ spec, event, events, onPick, isAdmin, onClose }: EventDetailSheetProps) {
  const [nowMs] = useState(() => Date.now());
  const icon = spec.kind === 'appliance' ? APPLIANCE_ICONS[spec.appliance] : ICONS[spec.kind];
  return (
    <ApplianceSheet
      accentClassName={`evd-sheet evd-${spec.kind}`}
      glyphIcon={icon}
      title={TITLES[spec.kind](spec)}
      subtitle={`${dayLabel(spec.atMs, nowMs)} ${formatHomeClock(spec.atMs)}${event.by ? ` · by ${event.by}` : ''}`}
      historyKey='now-detail'
      onClose={onClose}
    >
      <div className='evd-body'>
        {spec.kind === 'plant' && <PlantBody spec={spec} />}
        {spec.kind === 'appliance' && <ApplianceBody spec={spec} event={event} events={events} nowMs={nowMs} />}
        {spec.kind === 'arrival' && <ArrivalBody spec={spec} nowMs={nowMs} events={events} onPick={onPick} />}
        {spec.kind === 'coffee' && <CoffeeBody spec={spec} />}
        {spec.kind === 'rober' && <RoberBody spec={spec} events={events} nowMs={nowMs} />}
        {spec.kind === 'wolt' && <WoltBody spec={spec} events={events} />}
        {spec.kind === 'night' && <NightBody spec={spec} events={events} nowMs={nowMs} showBedroom={isAdmin} />}
      </div>
    </ApplianceSheet>
  );
}
