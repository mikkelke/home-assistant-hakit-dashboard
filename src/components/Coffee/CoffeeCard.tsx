import { useEffect, useMemo, useRef, useState } from 'react';
import { useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import { sendCoffeeCommand, type CoffeeCommands } from '../../coffee/command';
import { COFFEE_TABLET_VIEWER, XBLOOM_INTEGRATION_PATH } from '../../coffee/entities';
import {
  advisorShown,
  formatMinSec,
  hasBand,
  isBrewing,
  isEventful,
  phaseWord,
  secondsLeft,
  signed,
  usualRecipe,
  type BrewRecord,
  type CoffeeAdvice,
  type CoffeeBaseline,
  type CoffeeBeans,
  type CoffeeBrews,
  type CoffeeLive,
  type CoffeeRecipes,
  type CoffeeState,
} from '../../coffee/model';
import type { CoffeeRecentData } from '../../coffee/recent';
import {
  useCoffeeAdvice,
  useCoffeeBaseline,
  useCoffeeBeans,
  useCoffeeBrews,
  useCoffeeLive,
  useCoffeeRecent,
  useCoffeeRecipes,
  useCoffeeState,
} from '../../coffee/useCoffee';
import {
  bandVerdict,
  brewDayWord,
  brewName,
  brewWhen,
  canStart,
  deltaTone,
  faultView,
  liveVerdict,
  machineWord,
  pourStartS,
  staleFromS,
  startFailure,
  type Tone,
} from '../../coffee/view';
import { HOUSE_UPCOMING_ENTITY } from '../../config/entities';
import { formatHomeClock } from '../../energy/homeTime';
import { canViewerSeeUpcoming, parseHouseUpcoming, type HouseUpcomingRow } from '../../home/houseUpcoming';
import { dayLabel } from '../Now/nowModel';
import { useLocalStorageBoolean } from '../../hooks';
import { useNowMs } from '../../hooks/useNowMs';
import { useViewer } from '../../hooks/useViewer';
import { ApplianceCard } from '../Appliance';
import { AdviceCard } from './advice';
import { LOOK_CARD, LOOK_HIST, LOOK_MINI } from './looks';
import { chartInputs, lastValidS, planOf, series, valueAt } from './chart';
import { ChartBox } from './ChartBox';
import { BeansUndo, BrewStrip, StatsSheet } from './CoffeeStats';
import { Glyph } from './Glyph';
import { HoldButton } from './HoldButton';
import { Chip, LinkChip, NotifyChip, PersonFace, StoryPill, VerdictPill } from './parts';
import { BeansSheet, RecipeDetail, RecipeRow, TweakSheet } from './sheets';
import { Spark } from './Spark';
import { TasteDot, TasteRow } from './taste';
import { useClock } from './useClock';
import '../Appliance/Appliance.css';
import './Coffee.css';
import './CoffeeCard.css';

type Tab = 'brew' | 'history' | 'recipes';
type Sheet = 'stats' | 'beans' | 'tweak' | null;

const MAINT_NAMES: Record<string, string> = {
  'coffee:rinse': 'Rinse',
  'coffee:tank': 'Tank',
  'coffee:burrs': 'Burrs',
  'coffee:descale': 'Descale',
};

/** The next coffee maintenance row an admin sees, in a word and a count: "Rinse in 2". */
function maintenanceWord(rows: HouseUpcomingRow[]): string | null {
  const coffee = rows.filter(row => row.id.startsWith('coffee:'));
  if (coffee.length === 0) return null;
  const next = [...coffee].sort((a, b) => (a.atMs ?? -Infinity) - (b.atMs ?? -Infinity))[0];
  const name = MAINT_NAMES[next.id] ?? next.title.replace(/^xBloom\s+/i, '');
  const left = /(\d+)\s+brews?\s+left/i.exec(next.detail ?? '')?.[1];
  if (next.atMs == null || /\bdue\b/i.test(next.detail ?? '')) return `${name} due`;
  return left ? `${name} in ${left}` : name;
}

function headerWord(
  state: CoffeeState,
  beans: CoffeeBeans | null,
  lastAtMs: number | null,
  nowMs: number
): { word: string; tone: 'tint' | 'alert' | 'muted' | 'ok' } {
  const fault = faultView(state.fault);
  if (state.phase === 'paused' && fault) return { word: fault.text, tone: 'alert' };
  if (state.phase === 'ready' || state.phase === 'picked_up') return { word: 'Ready', tone: 'ok' };
  if (state.phase === 'start_failed') return { word: "Didn't start", tone: 'alert' };
  if (isBrewing(state.phase) || state.phase === 'starting') return { word: phaseWord(state) ?? 'Brewing', tone: 'tint' };
  if (state.phase === 'stopped') return { word: 'Stopped', tone: 'muted' };
  if (beans?.low && beans.brewsLeft != null) return { word: `≈ ${beans.brewsLeft} brew${beans.brewsLeft === 1 ? '' : 's'}`, tone: 'alert' };
  if (state.machine === 'awake' && lastAtMs != null && nowMs - lastAtMs < 3_600_000)
    return { word: brewDayWord(lastAtMs, nowMs), tone: 'muted' };
  return { word: machineWord(state) ?? (lastAtMs != null ? brewDayWord(lastAtMs, nowMs) : 'Coffee'), tone: 'muted' };
}

function lastBrewCurve(brews: CoffeeBrews | null, recent: CoffeeRecentData | null, id: string | null | undefined) {
  const curve = id ? recent?.curves[id] : undefined;
  if (curve) return series(curve.cup, curve.stepS);
  return brews?.lastCurve.length ? series(brews.lastCurve, 4) : null;
}

interface CardData {
  state: CoffeeState;
  live: CoffeeLive | null;
  baseline: CoffeeBaseline | null;
  beans: CoffeeBeans | null;
  brews: CoffeeBrews | null;
  recipes: CoffeeRecipes | null;
  advice: CoffeeAdvice | null;
}

function LastBrewRow({
  brew,
  brews,
  recent,
  nowMs,
}: {
  brew: BrewRecord;
  brews: CoffeeBrews | null;
  recent: CoffeeRecentData | null;
  nowMs: number;
}) {
  const stopped = brew.outcome === 'stopped' || brew.outcome === 'failed';
  return (
    <div className='cc-last'>
      <div className='cc-last-row'>
        <Spark cup={lastBrewCurve(brews, recent, brew.id)} width={64} height={26} />
        <span className='coffee-hrow-nm'>
          {brew.atMs != null ? brewWhen(brew.atMs, nowMs) : 'Last brew'}
          {brew.trial ? ` · grind ${brew.trial.to}` : ''}
          <small>
            {brew.outcome === 'unobserved'
              ? 'seen by the plug only'
              : stopped
                ? `stopped${brew.doseG != null ? ` · ${brew.doseG} g` : ''}`
                : [
                    brew.totalS != null ? formatMinSec(brew.totalS) : null,
                    brew.cupG != null ? `${Math.round(brew.cupG)} g` : null,
                    brew.inBand === 'inside' && brew.trial ? 'inside your usual' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
          </small>
        </span>
        {brew.rating && <TasteDot taste={brew.rating} long />}
        <PersonFace person={brew.who} size='sm' />
      </div>
      {!brew.rating && !stopped && brew.outcome === 'complete' && (
        <div className='cc-rate'>
          <span className='cc-rate-q'>How was it?</span>
          <TasteRow brewId={brew.id} rating={brew.rating} size='sm' />
        </div>
      )}
    </div>
  );
}

function IdleBrew({ data, nowMs, onSheet }: { data: CardData; nowMs: number; onSheet: (sheet: Sheet) => void }) {
  const { state, baseline, beans, brews, recipes, advice } = data;
  const usual = usualRecipe(recipes);
  const [sent, setSent] = useState<{ atMs: number; phase: string } | null>(null);
  const pending = state.phase === 'starting' || (sent != null && sent.phase === state.phase && nowMs - sent.atMs < 50_000);
  const shownAdvice = advisorShown(advice) ? advice : null;
  const trial = shownAdvice?.status === 'trial_queued' ? shownAdvice : null;
  const last = brews?.brews[0] ?? null;
  const { data: recent } = useCoffeeRecent(true, last?.id ?? null);
  const banded = hasBand(baseline);
  const total = banded ? baseline?.totalSMedian : null;
  const inputs = chartInputs({ plan: planOf(null, baseline, usual), baseline });
  const trialBrewed = shownAdvice?.status === 'trial_brewed' && last != null && shownAdvice.trialBrewId === last.id;
  const start = (data: CoffeeCommands['start']) => {
    setSent({ atMs: Date.now(), phase: state.phase });
    void sendCoffeeCommand('start', data).catch(() => setSent(null));
  };
  const failure = startFailure(state);

  if (trialBrewed && last) {
    return (
      <>
        <span className='coffee-lab'>Last brew · trial</span>
        <div className='cc-last-row is-top'>
          <Spark cup={lastBrewCurve(brews, recent, last.id)} width={64} height={26} />
          <span className='coffee-hrow-nm'>
            {last.atMs != null ? brewWhen(last.atMs, nowMs) : 'Last brew'}
            {last.trial ? ` · grind ${last.trial.to}` : ''}
            <small>
              {[
                last.totalS != null ? formatMinSec(last.totalS) : null,
                last.cupG != null ? `${Math.round(last.cupG)} g` : null,
                last.inBand === 'inside' ? 'inside your usual' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </small>
          </span>
          <PersonFace person={last.who} size='sm' />
        </div>
        <div className='coffee-tile cc-trial'>
          <div className='cc-rate-q'>How was it?</div>
          <TasteRow brewId={last.id} rating={last.rating} size='sm' />
          <AdviceCard advice={shownAdvice} brews={brews} beanName={beans?.beanName ?? null} forBrewId={last.id} size='sm' />
        </div>
        <div className='cc-sep' />
        <div className='cc-row'>
          <LinkChip state={state} />
          <span className='cc-sp' />
          {beans?.remainingG != null && (
            <button type='button' className='coffee-chip cc-beans-chip' onClick={() => onSheet('beans')}>
              <Glyph name='jar' />≈{Math.round(beans.remainingG)} g{beans.brewsLeft != null ? ` · ≈${beans.brewsLeft} brews` : ''}
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <div className='cc-usual-line'>
        <span className='coffee-lab'>The usual</span>
        <span>
          {[
            usual ? `${usual.pours.length} pours` : null,
            total != null ? `≈${formatMinSec(total)}` : null,
            banded ? `n=${baseline?.n}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <ChartBox look={LOOK_MINI} mode='idle' height={116} className='cc-chart' label='The usual: its plan and band' {...inputs} />
      <div className='coffee-chips cc-chips'>
        {usual?.doseG != null && <Chip glyph={<Glyph name='bean' />}>{usual.doseG} g</Chip>}
        {usual?.ratio && <Chip>{usual.ratio}</Chip>}
        {usual?.totalMl != null && <Chip icon='mdi:water-outline'>{Math.round(usual.totalMl)} ml</Chip>}
        {trial ? (
          <Chip icon='mdi:creation' tone='pur'>
            Grind {trial.to}
          </Chip>
        ) : (
          usual?.grind != null && <Chip>Grind {usual.grind}</Chip>
        )}
      </div>
      {shownAdvice && shownAdvice.status !== 'trial_brewed' && (
        <AdviceCard advice={shownAdvice} brews={brews} beanName={beans?.beanName ?? state.beanName} size='sm' />
      )}
      <div className='cc-go'>
        <LinkChip state={state} />
        <HoldButton
          kind='brew'
          className='cc-hold'
          label={trial ? 'Hold 1 s · trial' : 'Hold 1 s to brew'}
          pending={pending}
          failed={pending ? null : failure}
          disabled={!pending && !canStart(state)}
          onConfirm={() => start({ variant: 'usual' })}
        />
      </div>
      {beans && beans.remainingG == null && (
        <>
          <div className='cc-sep' />
          <button type='button' className='cc-beans' onClick={() => onSheet('beans')}>
            <span className='cc-disc'>
              <Glyph name='jar' />
            </span>
            <span className='cc-beans-tx'>
              <b>Beans</b>
              <small>tap when you fill the container</small>
            </span>
            <Chip icon='mdi:plus' tone='cof'>
              Added
            </Chip>
          </button>
        </>
      )}
      {beans?.remainingG != null && (
        <>
          <div className='cc-sep' />
          <button type='button' className='cc-beans' onClick={() => onSheet('beans')}>
            <span className='cc-disc'>
              <Glyph name='jar' />
            </span>
            <span className='cc-beans-tx'>
              <b>
                ≈{Math.round(beans.remainingG)} g{beans.beanName ? ` · ${beans.beanName}` : ''}
              </b>
              <small>{beans.addedAtMs != null ? `added ${dayLabelShort(beans.addedAtMs, nowMs)}` : 'tap when you add beans'}</small>
            </span>
            {beans.brewsLeft != null && (
              <Chip tone={beans.low ? 'warn' : 'cof'}>
                ≈ {beans.brewsLeft} brew{beans.brewsLeft === 1 ? '' : 's'}
              </Chip>
            )}
          </button>
          <BeansUndo beans={beans} nowMs={nowMs} />
        </>
      )}
      {last && (
        <>
          <div className='cc-sep' />
          <LastBrewRow brew={last} brews={brews} recent={recent} nowMs={nowMs} />
        </>
      )}
    </>
  );
}

function dayLabelShort(ms: number, nowMs: number): string {
  const label = dayLabel(ms, nowMs);
  return label === 'Today' || label === 'Yesterday' ? label.toLowerCase() : (label.split(' ').pop() ?? label);
}

function LiveBrew({ data, nowMs }: { data: CardData; nowMs: number }) {
  const { state, live, baseline, recipes } = data;
  const stale = staleFromS(live, state, nowMs);
  const paused = state.phase === 'paused';
  const power = state.source === 'power';
  const ownLive = live != null && !power && (live.brewId == null || state.brewId == null || live.brewId === state.brewId);
  const cup = ownLive ? series(live.cup, live.stepS) : null;
  const water = ownLive ? series(live.water, live.stepS) : null;
  const t0 = live?.t0Ms ?? state.firstBloomAtMs;
  const realNowS = t0 != null ? Math.max(0, (nowMs - t0) / 1000) : 0;
  const headS = stale != null ? realNowS : (lastValidS(cup) ?? realNowS);
  const laneAtS = stale ?? (paused && state.pausedSinceMs != null && t0 != null ? Math.max(0, (state.pausedSinceMs - t0) / 1000) : headS);
  const inputs = chartInputs({ plan: planOf(live, baseline, usualRecipe(recipes)), baseline, cup, water, extraS: headS });
  const left = secondsLeft(state.etaMs, nowMs);
  const banded = hasBand(baseline);
  const fault = faultView(state.fault);
  const at = stale ?? lastValidS(cup) ?? 0;
  return (
    <>
      <div className='cc-live-top'>
        <div>
          <span className='coffee-lab'>{paused ? 'Paused' : 'Time left'}</span>
          <div className='cc-left'>
            {paused
              ? state.pausedSinceMs != null
                ? formatMinSec(Math.max(0, (nowMs - state.pausedSinceMs) / 1000))
                : '—'
              : stale != null || left == null
                ? '—'
                : left > 0
                  ? `≈ ${formatMinSec(left)}`
                  : 'Any second'}
          </div>
        </div>
        <span className='cc-left-sub'>
          {paused ? 'ETA after resume' : stale != null ? 'no link' : state.etaMs != null ? `ready ≈ ${formatHomeClock(state.etaMs)}` : ''}
        </span>
        {stale != null ? (
          <StoryPill tone='up' icon='mdi:bluetooth-off'>
            No data · {formatMinSec(Math.max(0, realNowS - stale))}
          </StoryPill>
        ) : paused ? (
          <StoryPill tone='up' icon={state.fault === 'no_water' ? 'mdi:water-off-outline' : 'mdi:pause'}>
            {fault ? fault.text : 'Paused'}
          </StoryPill>
        ) : (
          <VerdictPill verdict={liveVerdict(banded ? state.verdict : 'building', baseline?.n ?? null)} />
        )}
      </div>
      <ChartBox
        look={LOOK_CARD}
        mode='live'
        height={170}
        className='cc-chart'
        label='This brew against the plan and your usual'
        {...inputs}
        nowS={headS}
        pour={state.pour}
        pourStartS={pourStartS(live, state.pour)}
        laneAtS={laneAtS}
        staleFromS={stale}
        frozen={paused}
      />
      <div className='coffee-chips cc-chips'>
        {power ? (
          <Chip icon='mdi:power-plug-outline' tone='mute'>
            seen by the plug only
          </Chip>
        ) : (
          <>
            <Chip icon='mdi:cup-outline' tone={stale != null ? 'mute' : 'cof'}>
              {Math.round(valueAt(cup, at) ?? 0)} g
            </Chip>
            <Chip icon='mdi:water-outline' tone={stale != null ? 'mute' : 'sky'}>
              {Math.round(valueAt(water, at) ?? 0)} ml
            </Chip>
          </>
        )}
        <NotifyChip state={state} variant='small' />
      </div>
      <div className='cc-ctrls'>
        {stale != null || power ? (
          <button
            type='button'
            className='coffee-btn is-ghost is-grow'
            onClick={() => void sendCoffeeCommand('connect', {}).catch(() => {})}
          >
            <Icon icon='mdi:bluetooth' aria-hidden='true' />
            Reconnect
          </button>
        ) : paused ? (
          <HoldButton
            kind='resume'
            label='Hold to resume'
            className='cc-wide'
            onConfirm={() => void sendCoffeeCommand('resume', {}).catch(() => {})}
          />
        ) : (
          <button type='button' className='coffee-btn is-ghost is-grow' onClick={() => void sendCoffeeCommand('pause', {}).catch(() => {})}>
            <Icon icon='mdi:pause' aria-hidden='true' />
            Pause
          </button>
        )}
        <HoldButton
          kind='wide-stop'
          label='Hold to stop'
          className='cc-wide'
          disabled={stale != null || power}
          onConfirm={() => void sendCoffeeCommand('stop', {}).catch(() => {})}
        />
      </div>
    </>
  );
}

function deltaChip(label: string, value: string, delta: number | null, unit: string, near: number) {
  const tone: Tone = deltaTone(delta, near);
  return (
    <span className='coffee-chip'>
      {label === 'time' ? <Icon icon='mdi:clock-outline' aria-hidden='true' /> : <Icon icon='mdi:cup-outline' aria-hidden='true' />}
      {value}
      {delta != null && <span className={`cc-d is-${tone}`}>{`${signed(delta)}${unit}`}</span>}
    </span>
  );
}

function ReadyBrew({ data }: { data: CardData }) {
  const { state, live, baseline, brews, advice, beans } = data;
  const record = brews?.brews.find(brew => brew.id === state.brewId) ?? null;
  const cup = live ? series(live.cup, live.stepS) : null;
  const water = live ? series(live.water, live.stepS) : null;
  const readyS = live?.endS ?? state.totalS ?? lastValidS(cup);
  const inputs = chartInputs({
    plan: planOf(live, baseline, null),
    baseline,
    cup,
    water,
    readyS,
    cupEndG: state.cupG,
    waterEndMl: state.waterMl,
  });
  const banded = hasBand(baseline);
  const dTotal =
    record?.dTotalS ?? (banded && state.totalS != null && baseline?.totalSMedian != null ? state.totalS - baseline.totalSMedian : null);
  const dCup = record?.dCupG ?? (banded && state.cupG != null && baseline?.cupGMedian != null ? state.cupG - baseline.cupGMedian : null);
  const shownAdvice = advisorShown(advice) ? advice : null;
  return (
    <>
      <div className='cc-live-top'>
        <div>
          <span className='coffee-lab'>Ready</span>
          <div className='cc-left is-ok'>{state.readyAtMs != null ? formatHomeClock(state.readyAtMs) : 'Ready'}</div>
        </div>
        <span className='cc-left-sub' />
        <VerdictPill verdict={bandVerdict(banded ? state.inBand : 'building', baseline?.n ?? null)} />
      </div>
      <ChartBox
        look={LOOK_CARD}
        mode='ready'
        height={150}
        className='cc-chart'
        label='This brew against your usual'
        {...inputs}
        readyS={readyS}
      />
      <div className='coffee-chips cc-chips'>
        {state.totalS != null && deltaChip('time', formatMinSec(state.totalS), dTotal, ' s', 2)}
        {state.cupG != null && deltaChip('cup', `${Math.round(state.cupG)} g`, dCup, '', 3)}
        <NotifyChip state={state} variant='small' />
      </div>
      <div className='cc-rate'>
        <span className='cc-rate-q'>How is it?</span>
        <TasteRow brewId={state.brewId} rating={record?.rating ?? null} size='sm' />
      </div>
      {shownAdvice && (
        <AdviceCard advice={shownAdvice} brews={brews} beanName={beans?.beanName ?? state.beanName} forBrewId={state.brewId} size='sm' />
      )}
      {state.phase === 'ready' && (
        <button
          type='button'
          className='coffee-btn is-green cc-picked'
          onClick={() => state.brewId && void sendCoffeeCommand('picked_up', { brew_id: state.brewId }).catch(() => {})}
        >
          <Icon icon='mdi:check' aria-hidden='true' />
          Picked up
        </button>
      )}
    </>
  );
}

function HistoryTab({ data, nowMs }: { data: CardData; nowMs: number }) {
  const { brews } = data;
  const list = brews?.brews ?? [];
  const { data: recent, status } = useCoffeeRecent(true, list[0]?.id ?? null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = list.find(brew => brew.id === openId) ?? list.find(brew => brew.outcome === 'complete') ?? list[0] ?? null;
  const curve = open ? recent?.curves[open.id] : undefined;
  const band = curve?.baselineId ? recent?.bands[curve.baselineId] : undefined;
  const inputs = chartInputs({
    plan: { planWater: null, planPours: [] },
    baseline: band
      ? {
          status: 'ready',
          cupLo: band.cupLo,
          cupHi: band.cupHi,
          stepS: band.stepS,
          totalSMedian: null,
          cupGMedian: null,
          drawdownSMedian: null,
        }
      : null,
    cup: curve ? series(curve.cup, curve.stepS) : null,
    water: curve ? series(curve.water, curve.stepS) : null,
    readyS: curve?.endS ?? null,
  });
  const groups: { day: string; brews: BrewRecord[] }[] = [];
  for (const brew of list) {
    const day = brew.atMs != null ? dayLabel(brew.atMs, nowMs) : 'Earlier';
    if (groups.length === 0 || groups[groups.length - 1].day !== day) groups.push({ day, brews: [] });
    groups[groups.length - 1].brews.push(brew);
  }
  if (list.length === 0) return <p className='coffee-sheet-note'>No brews yet. Every brew from here on lands here with its curve.</p>;
  return (
    <div className='cc-history'>
      <BrewStrip brews={list} nowMs={nowMs} selectedId={open?.id ?? null} onSelect={setOpenId} />
      {open && (
        <div className='coffee-tile cc-open'>
          <h4>
            {open.atMs != null ? brewWhen(open.atMs, nowMs) : 'Brew'}
            <span className='coffee-mute cc-open-name'>
              {brewName({ variant: open.variant, recipeName: open.recipeName }, data.recipes?.usualName ?? null).replace(
                'The usual',
                'the usual'
              )}
            </span>
            <span className='coffee-tile-r'>
              <PersonFace person={open.who} size='sm' />
            </span>
          </h4>
          {curve ? (
            <ChartBox
              look={LOOK_HIST}
              mode='hist'
              height={150}
              className='cc-chart'
              label='This brew over the band it was compared with'
              {...inputs}
            />
          ) : (
            <p className='coffee-sheet-note'>{status === 'loading' ? 'Loading the curve…' : 'No curve for this brew.'}</p>
          )}
          <div className='coffee-chips'>
            {open.totalS != null && deltaChip('time', formatMinSec(open.totalS), open.dTotalS, ' s', 2)}
            {open.cupG != null && deltaChip('cup', `${Math.round(open.cupG)} g`, open.dCupG, '', 3)}
            <TasteDot taste={open.rating} long />
          </div>
        </div>
      )}
      {groups.map(group => (
        <div key={group.day} className='cc-hgroup'>
          <div className='cc-hday'>{group.day}</div>
          {group.brews.map(brew => {
            const stopped = brew.outcome === 'stopped' || brew.outcome === 'failed';
            const c = recent?.curves[brew.id];
            return (
              <button
                key={brew.id}
                type='button'
                className={`coffee-hrow ${open?.id === brew.id ? 'is-open' : ''}`}
                onClick={() => setOpenId(brew.id)}
              >
                <span className='coffee-hrow-w'>{brew.atMs != null ? formatHomeClock(brew.atMs) : '—'}</span>
                <Spark cup={c ? series(c.cup, c.stepS) : null} width={50} height={22} />
                <span className='coffee-hrow-nm'>
                  {brew.variant === 'usual' || brew.variant === 'base' || brew.variant === 'trial'
                    ? 'The usual'
                    : (brew.recipeName ?? 'Coffee')}
                  {stopped && <small>stopped{brew.doseG != null ? ` · ${brew.doseG} g` : ''}</small>}
                  {brew.outcome === 'unobserved' && <small>seen by power only</small>}
                </span>
                <TasteDot taste={brew.rating} />
                <PersonFace person={brew.who} size='xs' />
                <span className={`coffee-hrow-v ${stopped ? 'is-stopped' : ''}`}>
                  {brew.cupG != null ? `${Math.round(brew.cupG)} g` : '—'}
                  <small>{brew.totalS != null ? formatMinSec(brew.totalS) : ''}</small>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function RecipesTab({
  data,
  isAdmin,
  hassUrl,
  onTweak,
}: {
  data: CardData;
  isAdmin: boolean;
  hassUrl: string | null;
  onTweak: () => void;
}) {
  const { recipes, state, baseline } = data;
  const usual = usualRecipe(recipes);
  const others = (recipes?.recipes ?? []).filter(recipe => recipe.id !== usual?.id);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = others.find(recipe => recipe.id === openId) ?? null;
  const inputs = chartInputs({ plan: planOf(null, baseline, usual), baseline: null });
  if (open) {
    return (
      <div className='cc-recipes'>
        <button type='button' className='coffee-btn is-ghost is-small' onClick={() => setOpenId(null)}>
          <Icon icon='mdi:chevron-left' aria-hidden='true' />
          Recipes
        </button>
        <div className='cc-recipe-name'>{open.name}</div>
        <RecipeDetail recipe={open} isUsual={false} state={state} onDone={() => setOpenId(null)} />
      </div>
    );
  }
  return (
    <div className='cc-recipes'>
      {usual ? (
        <div className='cc-usual'>
          <div className='cc-usual-h'>
            <Icon icon='mdi:check' aria-hidden='true' />
            <b>The usual</b>
            <span>
              {[`${usual.pours.length} pours`, usual.pours[0]?.tempC != null ? `${Math.round(usual.pours[0].tempC)}°` : null]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <span className='cc-sp' />
            {usual.grind != null && <Chip className='is-small'>Grind {usual.grind}</Chip>}
          </div>
          <ChartBox
            look={{ ...LOOK_CARD, lane: 40, blockH: 18, blockFont: 10.5 }}
            mode='plan'
            height={118}
            label='The usual: its pours over time'
            {...inputs}
          />
          <div className='coffee-chips'>
            {usual.doseG != null && <Chip glyph={<Glyph name='bean' />}>{usual.doseG} g</Chip>}
            {usual.ratio && <Chip>{usual.ratio}</Chip>}
            {usual.totalMl != null && <Chip icon='mdi:water-outline'>{Math.round(usual.totalMl)}</Chip>}
            <button type='button' className='coffee-chip is-mute cc-tweak' onClick={onTweak}>
              <Icon icon='mdi:tune-variant' aria-hidden='true' />
              Tweak
            </button>
          </div>
        </div>
      ) : (
        <p className='coffee-sheet-note'>No usual yet. Make a recipe the usual below.</p>
      )}
      {others.length > 0 && <div className='coffee-lab cc-others'>Others</div>}
      {others.map((recipe, index) => (
        <RecipeRow key={recipe.id} recipe={recipe} index={index} onOpen={() => setOpenId(recipe.id)} />
      ))}
      {isAdmin && (
        <a className='coffee-rrow is-import' href={`${hassUrl ?? ''}${XBLOOM_INTEGRATION_PATH}`} target='_top'>
          <span className='coffee-rrow-num'>
            <Icon icon='mdi:link-variant' aria-hidden='true' />
          </span>
          <span className='coffee-rrow-tx'>
            <b>Import a share link</b>
          </span>
        </a>
      )}
    </div>
  );
}

export interface CoffeeCardProps {
  /** On the wine-fridge tablet the Coffee entry opens the stage instead of expanding. */
  onOpenStage?: () => void;
}

/** Coffee in the Kitchen: one collapsed row on an ordinary day, first and open while a brew runs or waits. */
export function CoffeeCard({ onOpenStage }: CoffeeCardProps) {
  const state = useCoffeeState();
  const live = useCoffeeLive();
  const baseline = useCoffeeBaseline();
  const beans = useCoffeeBeans();
  const brews = useCoffeeBrews();
  const recipes = useCoffeeRecipes();
  const advice = useCoffeeAdvice();
  const viewer = useViewer();
  const hassUrl = useHass(s => s.hassUrl);
  const upAttributes = useHass(s => s.entities[HOUSE_UPCOMING_ENTITY]?.attributes);
  const slowNow = useNowMs();
  const [storedCollapsed, setStoredCollapsed] = useLocalStorageBoolean('coffeecard-collapsed', true);
  const [collapsedBrew, setCollapsedBrew] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('brew');
  const [sheet, setSheet] = useState<Sheet>(null);
  const eventful = state != null && isEventful(state.phase);
  const brewKey = state?.brewId ?? 'brew';
  const collapsed = eventful ? collapsedBrew === brewKey : storedCollapsed;
  const ticking = !collapsed && state != null && (isBrewing(state.phase) || state.phase === 'starting');
  const fastNow = useClock(1000, ticking);
  const nowMs = ticking ? fastNow : slowNow;
  const { data: recent } = useCoffeeRecent(sheet === 'stats', brews?.brews[0]?.id ?? null);
  const tablet = viewer.name === COFFEE_TABLET_VIEWER;

  const connected = useRef<string | null>(null);
  const awake = state?.machine === 'awake' || state?.machine === 'working';
  const linkDown = state != null && state.link !== 'connected';
  useEffect(() => {
    if (collapsed || !awake || !linkDown || connected.current === brewKey) return;
    connected.current = brewKey;
    void sendCoffeeCommand('connect', {}).catch(() => {});
  }, [collapsed, awake, linkDown, brewKey]);

  const maintWord = useMemo(() => {
    const rows = parseHouseUpcoming(upAttributes, slowNow).filter(row => canViewerSeeUpcoming(row, viewer));
    return maintenanceWord(rows);
  }, [upAttributes, slowNow, viewer]);

  if (!state) return null;
  const data: CardData = { state, live, baseline, beans, brews, recipes, advice };
  const last = brews?.brews.find(brew => brew.outcome === 'complete' || brew.outcome === 'stopped') ?? null;
  const lastAtMs = last?.atMs ?? null;
  const { word, tone } = headerWord(state, beans, lastAtMs, nowMs);
  const toggle = () => {
    if (tablet && onOpenStage) {
      onOpenStage();
      return;
    }
    if (eventful) setCollapsedBrew(collapsed ? null : brewKey);
    else setStoredCollapsed(!storedCollapsed);
  };
  const brewing = isBrewing(state.phase);
  const ready = state.phase === 'ready' || state.phase === 'picked_up';

  return (
    <div className='coffee-card'>
      <ApplianceCard
        accentClassName='appliance-accent-coffee'
        glyphIcon='mdi:coffee'
        title='Coffee'
        collapsed={collapsed}
        onToggleCollapsed={toggle}
        quickButton={
          collapsed && !brewing && !ready && last && lastBrewCurve(brews, null, last.id) ? (
            <button type='button' className='cc-spark-btn' onClick={toggle} aria-label='Coffee, the last brew'>
              <Spark cup={lastBrewCurve(brews, null, last.id)} width={60} height={24} />
            </button>
          ) : undefined
        }
        stateWord={word}
        stateWordClass={tone}
        showCollapsedStrip={brewing}
        progressPct={Math.round(
          (state.firstBloomAtMs != null && state.etaMs != null
            ? Math.min(1, Math.max(0, (nowMs - state.firstBloomAtMs) / (state.etaMs - state.firstBloomAtMs)))
            : 0) * 100
        )}
      >
        <div className='cc-tabs' role='tablist'>
          {(['brew', 'history', 'recipes'] as const).map(name => (
            <button
              key={name}
              type='button'
              role='tab'
              aria-selected={tab === name}
              className={tab === name ? 'is-on' : ''}
              onClick={() => setTab(name)}
            >
              {name === 'brew' ? 'Brew' : name === 'history' ? 'History' : 'Recipes'}
            </button>
          ))}
        </div>
        <div className='cc-body'>
          {tab === 'brew' &&
            (brewing ? (
              <LiveBrew data={data} nowMs={nowMs} />
            ) : ready ? (
              <ReadyBrew data={data} />
            ) : (
              <IdleBrew data={data} nowMs={nowMs} onSheet={setSheet} />
            ))}
          {tab === 'history' && <HistoryTab data={data} nowMs={nowMs} />}
          {tab === 'recipes' && (
            <RecipesTab data={data} isAdmin={viewer.isAdmin === true} hassUrl={hassUrl} onTweak={() => setSheet('tweak')} />
          )}
          <div className='cc-foot'>
            {maintWord && (
              <span className='cc-foot-it'>
                <Icon icon='mdi:wrench-outline' aria-hidden='true' />
                {maintWord}
              </span>
            )}
            {state.powerW != null && (
              <span className='cc-foot-it'>
                <Icon icon='mdi:flash-outline' aria-hidden='true' />
                {state.powerW >= 10 ? Math.round(state.powerW) : Math.round(state.powerW * 10) / 10} W
              </span>
            )}
            <span className='cc-sp' />
            <button type='button' className='cc-ibtn' onClick={() => setSheet('stats')} aria-label='Coffee statistics'>
              <Icon icon='mdi:chart-bar' />
            </button>
            <button type='button' className='cc-ibtn' onClick={() => setSheet('tweak')} aria-label='Tweak once'>
              <Icon icon='mdi:tune-variant' />
            </button>
          </div>
        </div>
      </ApplianceCard>
      {sheet === 'stats' && (
        <StatsSheet
          brews={brews}
          beans={beans}
          baseline={baseline}
          advice={advice}
          recent={recent}
          nowMs={nowMs}
          onBeans={() => setSheet('beans')}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'beans' && <BeansSheet beans={beans} onClose={() => setSheet(null)} />}
      {sheet === 'tweak' && <TweakSheet recipe={usualRecipe(recipes)} state={state} onClose={() => setSheet(null)} />}
    </div>
  );
}
