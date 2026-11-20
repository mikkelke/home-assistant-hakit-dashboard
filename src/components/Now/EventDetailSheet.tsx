import { useEffect, useMemo, useState } from 'react';
import { useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import { formatHomeClock } from '../../energy/homeTime';
import { formatMinSec } from '../../coffee/model';
import { useCoffeeBrews, useCoffeeRecent, useCoffeeRecipes } from '../../coffee/useCoffee';
import { brewName } from '../../coffee/view';
import {
  applianceRun,
  arrivalPath,
  brewForRow,
  detailEntities,
  detailWindow,
  earlierArrivals,
  formatOffset,
  numeric,
  unlockMethod,
  type DetailSpec,
  type HistorySpec,
} from '../../home/eventDetail';
import { fetchEventHistory, type HistoryPoint } from '../../home/eventHistory';
import type { HouseEvent } from '../../home/houseEvents';
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

function ApplianceBody({ spec, nowMs }: { spec: Extract<DetailSpec, { kind: 'appliance' }>; nowMs: number }) {
  const load = useDetailHistory(spec, nowMs);
  const { startMs, endMs } = detailWindow(spec, nowMs);
  const run = useMemo(
    () =>
      load.status === 'ready' ? applianceRun(load.history[spec.stateEntity] ?? [], load.history[spec.powerEntity] ?? [], spec.atMs) : null,
    [load, spec]
  );
  const chartStart = run?.startMs != null ? Math.max(startMs, run.startMs - 10 * 60_000) : startMs;
  const duration = run?.minutes != null ? `${Math.floor(run.minutes / 60)} h ${run.minutes % 60} min` : '–';
  return (
    <>
      <Headline
        before={spec.kwh != null ? `${spec.kwh.toFixed(2)} kWh` : '–'}
        after={duration}
        note={run?.startMs != null ? `${formatHomeClock(run.startMs)}–${formatHomeClock(spec.atMs)}` : null}
      />
      {load.status === 'ready' ? (
        <EventChart
          points={numeric(load.history[spec.powerEntity] ?? [])}
          startMs={chartStart}
          endMs={endMs}
          eventMs={spec.atMs}
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

const TITLES: Record<DetailSpec['kind'], (spec: DetailSpec) => string> = {
  plant: spec => (spec.kind === 'plant' ? `Watered ${spec.name}` : ''),
  appliance: spec => (spec.kind === 'appliance' ? `${spec.label} run` : ''),
  arrival: spec => (spec.kind === 'arrival' ? `${spec.resident.name} came home` : ''),
  coffee: () => 'Coffee',
};

const ICONS: Record<DetailSpec['kind'], string> = {
  plant: 'mdi:watering-can-outline',
  appliance: 'mdi:washing-machine',
  arrival: 'mdi:home-import-outline',
  coffee: 'mdi:coffee',
};

export interface EventDetailSheetProps {
  spec: DetailSpec;
  /** The row the sheet opened on: its time and who acted. */
  event: HouseEvent;
  /** Every row the timeline holds, for a resident's earlier arrivals. */
  events: readonly HouseEvent[];
  /** Another row to show instead, such as an earlier arrival. */
  onPick: (event: HouseEvent) => void;
  onClose: () => void;
}

/** What a timeline row looked like before and after: a plant's soil around its watering, an appliance's power through
 * its run, a brew's curve, or one resident's way in through the apartment door. No buttons beyond close. */
export default function EventDetailSheet({ spec, event, events, onPick, onClose }: EventDetailSheetProps) {
  const [nowMs] = useState(() => Date.now());
  const icon = spec.kind === 'appliance' ? event.icon : ICONS[spec.kind];
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
        {spec.kind === 'appliance' && <ApplianceBody spec={spec} nowMs={nowMs} />}
        {spec.kind === 'arrival' && <ArrivalBody spec={spec} nowMs={nowMs} events={events} onPick={onPick} />}
        {spec.kind === 'coffee' && <CoffeeBody spec={spec} />}
      </div>
    </ApplianceSheet>
  );
}
