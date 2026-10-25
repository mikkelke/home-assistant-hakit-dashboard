import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@iconify/react';
import { sendCoffeeCommand, type CoffeeCommands } from '../../coffee/command';
import { BEANS_TOP_UP_G } from '../../coffee/entities';
import {
  advisorShown,
  formatMinSec,
  hasBand,
  phaseWord,
  secondsLeft,
  signed,
  stageLabel,
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
import {
  useCoffeeAdvice,
  useCoffeeBaseline,
  useCoffeeBeans,
  useCoffeeBrews,
  useCoffeeLive,
  useCoffeeRecipes,
  useCoffeeState,
} from '../../coffee/useCoffee';
import {
  appHasMachine,
  bandVerdict,
  brewSubtitle,
  canStart,
  deltaTone,
  faultView,
  linkView,
  liveVerdict,
  pausedForWater,
  pourLine,
  pourStartS,
  staleFromS,
  startFailure,
  usualTitle,
  wantsConnect,
  type Tone,
} from '../../coffee/view';
import { formatHomeClock } from '../../energy/homeTime';
import { MotionScopeContext, useMotionSlot } from '../../home/motionBudget';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useSky } from '../Home/useSky';
import { AdviceCard } from './advice';
import type { BrewChartMode } from './BrewChart';
import { LOOK_STAGE, LOOK_STAGE_PHONE } from './looks';
import { chartInputs, lastValidS, planOf, series, valueAt } from './chart';
import { ChartBox } from './ChartBox';
import { CupWait } from './CupWait';
import { Glyph } from './Glyph';
import { HoldButton } from './HoldButton';
import { Chip, CupChip, Legend, LinkChip, NotifyChip, StoryPill, VerdictPill, type LegendItem } from './parts';
import { BeansSheet, RecipesSheet, TweakSheet } from './sheets';
import { TasteRow } from './taste';
import { useClock } from './useClock';
import { useWaterGuard } from './useWaterGuard';
import { PausedFill, WaterChip, WaterPrompt, WaterSheet } from './WaterTank';
import './Coffee.css';
import './CoffeeStage.css';

type StageMode = 'idle' | 'live' | 'paused' | 'stale' | 'ready' | 'stopped';

function stageMode(state: CoffeeState, stale: boolean): StageMode {
  switch (state.phase) {
    case 'grinding':
    case 'brewing':
      return stale ? 'stale' : 'live';
    case 'paused':
      return stale ? 'stale' : 'paused';
    case 'ready':
    case 'picked_up':
      return 'ready';
    case 'stopped':
      return 'stopped';
    default:
      return 'idle';
  }
}

/** The brew pending since a hold, until the coffee app answers or 50 s pass. */
const START_WAIT_MS = 50_000;

function useStart(state: CoffeeState, nowMs: number) {
  const [sent, setSent] = useState<{ atMs: number; phase: string } | null>(null);
  const pending = state.phase === 'starting' || (sent != null && sent.phase === state.phase && nowMs - sent.atMs < START_WAIT_MS);
  const start = (data: CoffeeCommands['start']) => {
    setSent({ atMs: Date.now(), phase: state.phase });
    void sendCoffeeCommand('start', data).catch(() => setSent(null));
  };
  return { pending, start };
}

function Stepper({ mode, state }: { mode: StageMode; state: CoffeeState }) {
  const brewing = mode === 'live' || mode === 'paused' || mode === 'stale';
  const grinding = state.phase === 'grinding' || (state.phase === 'brewing' && state.source !== 'power' && (state.pour ?? 0) < 1);
  const ready = mode === 'ready';
  const share = state.pour != null && state.poursTotal ? Math.min(1, state.pour / state.poursTotal) : 0;
  const step = (glyph: 'grinder' | 'brewer' | 'cup', on: boolean, now: boolean, extra = '') => (
    <span className={`cs-step ${on ? 'is-on' : ''} ${now ? 'is-now' : ''} ${extra}`}>
      <Glyph name={glyph} />
    </span>
  );
  return (
    <span className='cs-stepper' aria-hidden='true'>
      {step('grinder', brewing || ready || grinding, grinding)}
      <span className='cs-step-bar'>
        <i style={{ width: brewing && !grinding ? '100%' : ready ? '100%' : '0%' }} />
      </span>
      {step(
        'brewer',
        (brewing && !grinding) || ready,
        brewing && !grinding && mode !== 'stale',
        mode === 'paused' ? 'is-alert' : mode === 'stale' ? 'is-dim' : ''
      )}
      <span className={`cs-step-bar ${mode === 'stale' ? 'is-dim' : ''}`}>
        <i style={{ width: ready ? '100%' : brewing && !grinding ? `${Math.round(share * 100)}%` : '0%' }} />
      </span>
      {step('cup', ready, ready)}
    </span>
  );
}

function subtitle(mode: StageMode, state: CoffeeState, usualName: string | null): string {
  if (mode === 'stale') return 'Connection lost';
  if (mode === 'paused') return state.fault ? 'Paused by the machine' : 'Paused';
  if (mode === 'live' && state.source === 'power') return 'Brewing · seen by the plug';
  if (mode === 'live' || mode === 'ready') return brewSubtitle(state, usualName);
  if (mode === 'stopped') return 'Stopped';
  if (state.phase === 'awaiting_cup') return 'Waiting for your cup';
  if (state.phase === 'starting') return 'Starting…';
  if (state.machine === 'asleep') return 'Asleep';
  if (state.machine === 'off') return 'Off';
  return linkView(state).text;
}

function Tile({ label, className = '', children }: { label?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={`cs-tile ${className}`}>
      {label && <span className='coffee-lab'>{label}</span>}
      {children}
    </div>
  );
}

function Metric({ label, value, unit, className = '' }: { label: string; value: number | null; unit: string; className?: string }) {
  return (
    <Tile label={label} className={`cs-metric ${className}`}>
      <div className='cs-mid'>
        {value == null ? '—' : Math.round(value)}
        <small>{unit}</small>
      </div>
    </Tile>
  );
}

const TONE_CLASS: Record<Tone, string> = { ok: 'is-ok', up: 'is-up', dn: 'is-dn', mute: 'is-mute', warn: 'is-up' };

function VerdictChip({ label, value, delta, tone }: { label: string; value: string; delta: string | null; tone: Tone }) {
  return (
    <div className='cs-vc'>
      <span className='coffee-lab'>{label}</span>
      <div className='cs-vc-v'>
        {value}
        {delta && <span className={`cs-d ${TONE_CLASS[tone]}`}>{delta}</span>}
      </div>
    </div>
  );
}

interface StageData {
  state: CoffeeState;
  live: CoffeeLive | null;
  baseline: CoffeeBaseline | null;
  beans: CoffeeBeans | null;
  brews: CoffeeBrews | null;
  recipes: CoffeeRecipes | null;
  advice: CoffeeAdvice | null;
}

function IdleSide({ data, nowMs }: { data: StageData; nowMs: number }) {
  const { state, beans, recipes, advice, brews } = data;
  const usual = usualRecipe(recipes);
  const [sheet, setSheet] = useState<'tweak' | 'recipes' | 'beans' | 'water' | null>(null);
  const [base, setBase] = useState(false);
  const { pending, start } = useStart(state, nowMs);
  const water = useWaterGuard(state, usual);
  const shownAdvice = advisorShown(advice) ? advice : null;
  const trial = shownAdvice?.status === 'trial_queued' ? shownAdvice : null;
  const failure = startFailure(state);
  const brewsLeft = beans?.brewsLeft;
  const total = data.baseline?.status === 'ready' ? data.baseline.totalSMedian : null;
  const plannedS = total ?? usual?.planS ?? null;
  const share = beans?.remainingG != null ? Math.min(1, beans.remainingG / Math.max(BEANS_TOP_UP_G, beans.remainingG)) : 0;
  const begin = () => start({ variant: trial && base ? 'base' : 'usual' });
  return (
    <>
      <Tile className='cs-usual'>
        <span className='coffee-lab'>The usual</span>
        <h3>{usualTitle(usual, beans)}</h3>
        <div className='cs-chips'>
          {usual?.doseG != null && <Chip glyph={<Glyph name='bean' />}>{usual.doseG} g</Chip>}
          {usual?.ratio && <Chip>{usual.ratio}</Chip>}
          {usual?.totalMl != null && <Chip icon='mdi:water-outline'>{Math.round(usual.totalMl)} ml</Chip>}
          {usual?.pours[0]?.tempC != null && <Chip icon='mdi:thermometer'>{Math.round(usual.pours[0].tempC)}°</Chip>}
          {trial && !base ? (
            <Chip icon='mdi:creation' tone='pur'>
              Grind {trial.to}
            </Chip>
          ) : (
            usual?.grind != null && <Chip>Grind {usual.grind}</Chip>
          )}
          {!trial && plannedS != null && <Chip icon='mdi:clock-outline'>≈ {formatMinSec(plannedS)}</Chip>}
        </div>
      </Tile>
      {beans && beans.remainingG == null && (
        <button type='button' className='cs-tile cs-beans' onClick={() => setSheet('beans')} aria-label='Beans, added some'>
          <span className='cs-beans-disc'>
            <Glyph name='jar' />
          </span>
          <span className='cs-beans-tx'>
            <span className='cs-beans-line'>Beans</span>
            <span className='cs-beans-hint'>tap when you fill the container</span>
          </span>
          <Chip icon='mdi:plus' tone='cof' className='is-mid'>
            Added
          </Chip>
        </button>
      )}
      {beans && beans.remainingG != null && (
        <button type='button' className='cs-tile cs-beans' onClick={() => setSheet('beans')} aria-label='Beans, added some'>
          <span className='cs-beans-disc'>
            <Glyph name='jar' />
          </span>
          <span className='cs-beans-tx'>
            <span className='cs-beans-line'>
              ≈{Math.round(beans.remainingG)} g <span>{beans.beanName}</span>
            </span>
            <span className='cs-bar'>
              <i style={{ width: `${Math.round(share * 100)}%` }} />
            </span>
          </span>
          {brewsLeft != null && (
            <Chip tone={beans.low ? 'warn' : 'cof'} className='is-mid'>
              ≈ {brewsLeft} brew{brewsLeft === 1 ? '' : 's'}
            </Chip>
          )}
        </button>
      )}
      {shownAdvice && <AdviceCard advice={shownAdvice} brews={brews} beanName={beans?.beanName ?? state.beanName} size='lg' />}
      <div className='cs-status'>
        <LinkChip state={state} big />
        <CupChip state={state} big />
        <WaterChip state={state} usual={usual} big onOpen={() => setSheet('water')} />
        <NotifyChip state={state} variant='chip' />
      </div>
      {appHasMachine(state) && (
        <p className='cs-note'>Close the xBloom app on the phone or tablet that has the machine, then hold again.</p>
      )}
      {state.phase === 'awaiting_cup' ? (
        <div className='cs-go'>
          <CupWait state={state} size='xl' />
        </div>
      ) : (
        <>
          {water.short ? (
            <div className='cs-go'>
              <WaterPrompt
                short={water.short}
                size='xl'
                busy={water.busy}
                onFilled={() => water.filled(begin)}
                onAnyway={() => water.startAnyway(begin)}
              />
            </div>
          ) : (
            <HoldButton
              kind='brew'
              size='xl'
              className='cs-go'
              label={trial ? (base ? `Hold 1 s · grind ${trial.from ?? usual?.grind ?? ''}` : 'Hold 1 s · trial') : 'Hold 1 s to brew'}
              pending={pending}
              failed={pending ? null : failure}
              disabled={!pending && !canStart(state)}
              onConfirm={() => water.guard(begin)}
            />
          )}
          {!water.short && (
            <div className='cs-lowlinks'>
              {trial ? (
                <button type='button' onClick={() => setBase(value => !value)}>
                  {base ? <Icon icon='mdi:creation' aria-hidden='true' /> : <Glyph name='cup' />}
                  {base ? `Trial, grind ${trial.to}` : `Usual, grind ${trial.from ?? usual?.grind ?? ''}`}
                </button>
              ) : (
                <button type='button' onClick={() => setSheet('tweak')}>
                  <Icon icon='mdi:tune-variant' aria-hidden='true' />
                  Tweak once
                </button>
              )}
              <button type='button' onClick={() => setSheet('recipes')}>
                <Icon icon='mdi:book-open-variant' aria-hidden='true' />
                Other recipe
              </button>
            </div>
          )}
        </>
      )}
      {sheet === 'tweak' && <TweakSheet recipe={usual} state={state} onClose={() => setSheet(null)} />}
      {sheet === 'recipes' && (
        <RecipesSheet recipes={recipes?.recipes ?? []} usualId={recipes?.usualId ?? null} state={state} onClose={() => setSheet(null)} />
      )}
      {sheet === 'beans' && <BeansSheet beans={beans} onClose={() => setSheet(null)} />}
      {sheet === 'water' && <WaterSheet state={state} usual={usual} nowMs={nowMs} onClose={() => setSheet(null)} />}
    </>
  );
}

function BrewingSide({
  data,
  mode,
  nowMs,
  nowS,
  realNowS,
  staleS,
}: {
  data: StageData;
  mode: StageMode;
  nowMs: number;
  /** Where the pour stands: now, or where a pause or a lost link left it. */
  nowS: number;
  realNowS: number;
  staleS: number | null;
}) {
  const { state, live } = data;
  const plan = planOf(live, data.baseline, usualRecipe(data.recipes));
  const pourIndex = (state.pour ?? 0) - 1;
  const pour = plan.planPours[pourIndex];
  const started = pourStartS(live, state.pour) ?? pour?.start ?? null;
  const inPour = pour != null && started != null && nowS - started < pour.end - pour.start;
  const pourShare = pour && started != null ? Math.min(1, Math.max(0, (nowS - started) / Math.max(1, pour.end - pour.start))) : 0;
  const last = state.poursTotal != null && state.pour === state.poursTotal;
  const power = state.source === 'power';
  const grinding = state.phase === 'grinding';
  const beforeBloom = grinding || power || (state.pour ?? 0) < 1;
  const cupSeries = live && !power ? series(live.cup, live.stepS) : null;
  const waterSeries = live && !power ? series(live.water, live.stepS) : null;
  const at = staleS ?? lastValidS(cupSeries) ?? nowS;
  const cup = valueAt(cupSeries, at);
  const water = valueAt(waterSeries, at);
  const left = secondsLeft(state.etaMs, nowMs);
  const sinceBloom = state.firstBloomAtMs != null ? Math.max(0, (nowMs - state.firstBloomAtMs) / 1000) : null;
  const stageText = grinding ? 'Grinding' : (stageLabel(state.pour, state.poursTotal) ?? phaseWord(state) ?? 'Brewing');
  const fault = faultView(state.fault);
  const stale = mode === 'stale';
  const noLink = stale || power;

  return (
    <>
      {mode === 'paused' && fault ? (
        <Tile label='Machine says' className='cs-alert'>
          <div className='cs-cue is-alert'>
            <Icon icon='mdi:water-off-outline' aria-hidden='true' />
            {fault.text}
          </div>
          <div className='cs-sub'>
            {fault.hint} The brew is waiting at {stageText}.
          </div>
          {pausedForWater(state) && <PausedFill state={state} size='xl' />}
        </Tile>
      ) : (
        <Tile label={stale && staleS != null ? `Last seen ${formatMinSec(staleS)}` : 'Stage'}>
          <div className={`cs-cue ${stale ? 'is-stale' : ''}`}>{stageText}</div>
          <div className='cs-sub'>
            {stale
              ? `stale ${formatMinSec(Math.max(0, realNowS - (staleS ?? realNowS)))} · the machine carries on by itself`
              : power
                ? 'seen by the plug only, so no curve'
                : grinding
                  ? 'the clock starts at the first bloom'
                  : beforeBloom
                    ? ''
                    : inPour
                      ? pourLine(pour)
                      : last
                        ? 'drawdown'
                        : 'pause'}
          </div>
          {!stale && !beforeBloom && (
            <div className='cs-pbar'>
              <i style={{ width: `${Math.round((inPour ? pourShare : 1) * 100)}%` }} />
            </div>
          )}
        </Tile>
      )}
      {mode === 'paused' ? (
        <Tile label='Paused'>
          <div className='cs-cue'>
            {state.pausedSinceMs != null ? formatMinSec(Math.max(0, (nowMs - state.pausedSinceMs) / 1000)) : '—'}
          </div>
          <div className='cs-sub'>
            {sinceBloom != null ? `${formatMinSec(sinceBloom)} since bloom · ETA after resume` : 'ETA after resume'}
          </div>
        </Tile>
      ) : (
        <Tile label='Time left'>
          <div className={`cs-cue ${stale || left == null ? 'is-stale' : ''}`}>
            {stale || left == null ? '—' : left > 0 ? `≈ ${formatMinSec(left)}` : 'Any second'}
          </div>
          <div className='cs-sub'>
            {stale
              ? 'unknown while disconnected'
              : power && state.etaMs == null
                ? 'known when it ends'
                : state.etaMs != null
                  ? `ready ≈ ${formatHomeClock(state.etaMs)}${sinceBloom != null ? ` · ${formatMinSec(sinceBloom)} since bloom` : ''}`
                  : 'known at the first bloom'}
          </div>
        </Tile>
      )}
      <div className='cs-pair'>
        <Metric label={stale ? 'Cup · stale' : 'Cup'} value={cup} unit='g' className={noLink ? 'is-stale' : 'is-cup'} />
        <Metric label={stale ? 'Water · stale' : 'Water'} value={water} unit='ml' className={noLink ? 'is-stale' : 'is-water'} />
      </div>
      <div className='cs-ctrls'>
        {noLink ? (
          <>
            <button type='button' className='cs-wide is-sky' onClick={() => void sendCoffeeCommand('connect', {}).catch(() => {})}>
              <Icon icon='mdi:bluetooth' aria-hidden='true' />
              Reconnect
            </button>
            <HoldButton kind='stop' label='Needs link' disabled onConfirm={() => {}} />
          </>
        ) : mode === 'paused' ? (
          <>
            <HoldButton
              kind='resume'
              label='Hold to resume'
              className='cs-wide-hold'
              onConfirm={() => void sendCoffeeCommand('resume', {}).catch(() => {})}
            />
            <HoldButton kind='stop' label='Hold to stop' onConfirm={() => void sendCoffeeCommand('stop', {}).catch(() => {})} />
          </>
        ) : (
          <>
            <span className='cs-cwrap'>
              <button
                type='button'
                className='cs-pause'
                onClick={() => void sendCoffeeCommand('pause', {}).catch(() => {})}
                aria-label='Pause'
              >
                <Icon icon='mdi:pause' />
              </button>
              <b>Pause</b>
            </span>
            <HoldButton kind='stop' label='Hold to stop' onConfirm={() => void sendCoffeeCommand('stop', {}).catch(() => {})} />
          </>
        )}
      </div>
    </>
  );
}

function deltasFor(state: CoffeeState, record: BrewRecord | null, baseline: CoffeeBaseline | null) {
  const banded = hasBand(baseline);
  const diff = (value: number | null, median: number | null | undefined) =>
    value != null && median != null && banded ? value - median : null;
  return {
    total: record?.dTotalS ?? diff(state.totalS, baseline?.totalSMedian),
    cup: record?.dCupG ?? diff(state.cupG, baseline?.cupGMedian),
    drawdown: record?.dDrawdownS ?? diff(state.drawdownS, baseline?.drawdownSMedian),
  };
}

function ReadySide({ data, nowMs }: { data: StageData; nowMs: number }) {
  const { state, brews, advice, beans } = data;
  const record = brews?.brews.find(brew => brew.id === state.brewId) ?? null;
  const delta = deltasFor(state, record, data.baseline);
  const planMl = usualRecipe(data.recipes)?.totalMl ?? null;
  const shownAdvice = advisorShown(advice) ? advice : null;
  const readyAt = state.readyAtMs;
  const waterOk = state.waterMl != null && planMl != null && Math.abs(state.waterMl - planMl) <= 5;
  return (
    <>
      <Tile className='cs-ready'>
        <span className='cs-ready-disc'>
          <Icon icon='mdi:check' aria-hidden='true' />
        </span>
        <div>
          <div className='cs-cue is-ok'>Ready</div>
          <div className='cs-sub'>
            {[readyAt != null ? formatHomeClock(readyAt) : null, state.totalS != null ? `${formatMinSec(state.totalS)} since bloom` : null]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      </Tile>
      <div className='cs-vchips'>
        <VerdictChip
          label='Time'
          value={state.totalS != null ? formatMinSec(state.totalS) : '—'}
          delta={delta.total != null ? `${signed(delta.total)} s` : null}
          tone={deltaTone(delta.total, 2)}
        />
        <VerdictChip
          label='Cup'
          value={state.cupG != null ? `${Math.round(state.cupG)} g` : '—'}
          delta={delta.cup != null ? signed(delta.cup) : null}
          tone={deltaTone(delta.cup, 3)}
        />
        <VerdictChip
          label='Water'
          value={state.waterMl != null ? `${Math.round(state.waterMl)} ml` : '—'}
          delta={waterOk ? '✓' : state.waterMl != null && planMl != null ? signed(state.waterMl - planMl) : null}
          tone={waterOk ? 'ok' : deltaTone(state.waterMl != null && planMl != null ? state.waterMl - planMl : null, 5)}
        />
        <VerdictChip
          label='Drawdown'
          value={state.drawdownS != null ? formatMinSec(state.drawdownS) : '—'}
          delta={delta.drawdown != null ? `${signed(delta.drawdown)} s` : null}
          tone={deltaTone(delta.drawdown, 2)}
        />
      </div>
      <Tile label='How is it?' className='cs-taste'>
        <TasteRow brewId={state.brewId} rating={record?.rating ?? null} />
      </Tile>
      {shownAdvice && (
        <AdviceCard advice={shownAdvice} brews={brews} beanName={beans?.beanName ?? state.beanName} forBrewId={state.brewId} size='lg' />
      )}
      <div className='cs-bottom'>
        {state.phase === 'ready' ? (
          <button
            type='button'
            className='cs-wide is-green'
            onClick={() => state.brewId && void sendCoffeeCommand('picked_up', { brew_id: state.brewId }).catch(() => {})}
          >
            <Icon icon='mdi:check' aria-hidden='true' />
            Picked up
          </button>
        ) : (
          <span className='cs-note is-center'>
            Picked up{state.pickedUpAtMs != null ? ` ${formatHomeClock(state.pickedUpAtMs)}` : ''} ·{' '}
            {formatMinSec(Math.max(0, (nowMs - (state.readyAtMs ?? nowMs)) / 1000))} after ready
          </span>
        )}
      </div>
    </>
  );
}

const STOP_REASONS: Record<string, string> = {
  home_assistant: 'from Home Assistant',
  machine: 'on the machine',
  fault: 'by a machine fault',
  abandoned: 'it never finished',
};

function StoppedSide({ data }: { data: StageData }) {
  const { state, live } = data;
  const cupSeries = live ? series(live.cup, live.stepS) : null;
  const at = lastValidS(cupSeries);
  return (
    <>
      <Tile label='Stopped'>
        <div className='cs-cue'>Stopped</div>
        <div className='cs-sub'>
          {[state.stopReason ? STOP_REASONS[state.stopReason] : null, state.stoppedAtMs != null ? formatHomeClock(state.stoppedAtMs) : null]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </Tile>
      <div className='cs-pair'>
        <Metric label='Cup' value={at != null ? valueAt(cupSeries, at) : null} unit='g' className='is-cup' />
        <Metric
          label='Water'
          value={live && at != null ? valueAt(series(live.water, live.stepS), at) : null}
          unit='ml'
          className='is-water'
        />
      </div>
    </>
  );
}

function legendFor(mode: StageMode, banded: boolean, n: number): LegendItem[] {
  const band: LegendItem[] = banded ? [{ kind: 'band', label: mode === 'idle' ? `Your usual · n=${n}` : `Usual · n=${n}` }] : [];
  if (mode === 'idle') return [...band, { kind: 'plan', label: 'Plan' }];
  const measured: LegendItem[] = [
    { kind: 'cup', label: 'Cup g' },
    { kind: 'water', label: 'Water ml' },
  ];
  if (mode === 'ready' || mode === 'stopped') return [...measured, ...band];
  return [...measured, { kind: 'plan', label: 'Plan' }, ...band];
}

function StageBody({ data, nowMs, phone }: { data: StageData; nowMs: number; phone: boolean }) {
  const { state, live, baseline } = data;
  const stale = staleFromS(live, state, nowMs);
  const mode = stageMode(state, stale != null);
  const usual = usualRecipe(data.recipes);
  const t0 = live?.t0Ms ?? state.firstBloomAtMs;
  const realNowS = t0 != null ? Math.max(0, (nowMs - t0) / 1000) : 0;
  const flowing = mode === 'live' && state.phase === 'brewing' && (state.pour ?? 0) >= 1;
  const glow = useMotionSlot('stage:head', 'appliance', flowing);
  const breathe = useMotionSlot('stage:pour', 'appliance', flowing);
  const plan = planOf(mode === 'idle' ? null : live, baseline, usual);
  const measuredLive =
    mode !== 'idle' &&
    state.source !== 'power' &&
    live != null &&
    (live.brewId == null || state.brewId == null || live.brewId === state.brewId);
  const cup = measuredLive ? series(live.cup, live.stepS) : null;
  const water = measuredLive ? series(live.water, live.stepS) : null;
  const dataEnd = lastValidS(cup);
  const headS = mode === 'stale' ? realNowS : (dataEnd ?? realNowS);
  const laneAtS =
    mode === 'stale'
      ? stale
      : mode === 'paused' && state.pausedSinceMs != null && t0 != null
        ? Math.max(0, (state.pausedSinceMs - t0) / 1000)
        : headS;
  const readyS = mode === 'ready' ? (live?.endS ?? state.totalS ?? dataEnd) : null;
  const inputs = chartInputs({
    plan,
    baseline,
    cup,
    water,
    readyS,
    cupEndG: mode === 'ready' ? state.cupG : null,
    waterEndMl: mode === 'ready' ? state.waterMl : null,
    extraS: mode === 'live' || mode === 'paused' || mode === 'stale' ? headS : null,
  });
  const chartMode: BrewChartMode = mode === 'idle' ? 'idle' : mode === 'ready' ? 'ready' : mode === 'stopped' ? 'hist' : 'live';
  const banded = hasBand(baseline);
  const n = baseline?.n ?? 0;
  const verdict =
    mode === 'live'
      ? liveVerdict(banded ? state.verdict : 'building', n)
      : mode === 'ready'
        ? bandVerdict(banded ? state.inBand : 'building', n)
        : mode === 'idle' && !banded && baseline?.status === 'building'
          ? liveVerdict('building', n)
          : null;
  const fault = faultView(state.fault);

  return (
    <div className='cs-body'>
      <div className='cs-chartcard'>
        <div className='cs-top'>
          <Legend items={legendFor(mode, banded, n)} />
          <span className='cs-sp' />
          {mode === 'stale' ? (
            <StoryPill tone='up' icon='mdi:bluetooth-off'>
              No data · {formatMinSec(Math.max(0, realNowS - (stale ?? realNowS)))}
            </StoryPill>
          ) : mode === 'paused' ? (
            <StoryPill tone='up' icon={state.fault === 'no_water' ? 'mdi:water-off-outline' : 'mdi:pause'}>
              {fault ? `Paused · ${fault.text.toLowerCase()}` : 'Paused'}
            </StoryPill>
          ) : (
            <VerdictPill verdict={verdict} />
          )}
        </div>
        <ChartBox
          className='cs-chartbox'
          look={phone ? LOOK_STAGE_PHONE : LOOK_STAGE}
          mode={chartMode}
          label={`Brew chart, ${phaseWord(state) ?? 'the usual'}`}
          {...inputs}
          nowS={headS}
          pour={state.pour}
          pourStartS={pourStartS(live, state.pour)}
          laneAtS={laneAtS}
          staleFromS={mode === 'stale' ? stale : null}
          frozen={mode === 'paused'}
          glow={glow}
          breathe={breathe}
          readyS={readyS}
          cupEndG={inputs.cupEndG}
          waterEndMl={inputs.waterEndMl}
        />
      </div>
      <aside className={`cs-side is-${mode}`}>
        {mode === 'idle' && <IdleSide data={data} nowMs={nowMs} />}
        {(mode === 'live' || mode === 'paused' || mode === 'stale') && (
          <BrewingSide
            data={data}
            mode={mode}
            nowMs={nowMs}
            nowS={laneAtS ?? headS}
            realNowS={realNowS}
            staleS={mode === 'stale' ? stale : null}
          />
        )}
        {mode === 'ready' && <ReadySide data={data} nowMs={nowMs} />}
        {mode === 'stopped' && <StoppedSide data={data} />}
        {phone && mode !== 'idle' && (
          <div className='cs-status'>
            <NotifyChip state={state} variant='chip' />
          </div>
        )}
      </aside>
    </div>
  );
}

export interface CoffeeStageProps {
  onClose: () => void;
}

/** The brew screen for the tablet on the wine fridge: the usual's plan and band before a brew, the curve growing
 * through them while it runs, then Ready with a taste tap. */
export default function CoffeeStage({ onClose }: CoffeeStageProps) {
  const state = useCoffeeState();
  const live = useCoffeeLive();
  const baseline = useCoffeeBaseline();
  const beans = useCoffeeBeans();
  const brews = useCoffeeBrews();
  const recipes = useCoffeeRecipes();
  const advice = useCoffeeAdvice();
  const busy = state != null && state.phase !== 'idle' && state.phase !== 'asleep';
  const nowMs = useClock(busy ? 1000 : 15_000);
  const sky = useSky();
  const phone = useIsMobile();

  const connected = useRef(false);
  const connectWanted = state != null && wantsConnect(state);
  useEffect(() => {
    if (connected.current || !connectWanted) return;
    connected.current = true;
    void sendCoffeeCommand('connect', {}).catch(() => {});
  }, [connectWanted]);

  const staleS = state ? staleFromS(live, state, nowMs) : null;
  const mode = state ? stageMode(state, staleS != null) : 'idle';
  const usualName = recipes?.usualName ?? null;
  const showWho = state != null && !phone && mode !== 'idle';

  return (
    <MotionScopeContext.Provider value='stage'>
      <section className={`coffee-stage ${phone ? 'is-phone' : ''}`} aria-label='Coffee'>
        <header className={`cs-head sky--${sky.phase}`}>
          <button type='button' className='cs-back' onClick={onClose}>
            <Icon icon='mdi:chevron-left' aria-hidden='true' />
            Kitchen
          </button>
          <span className='cs-title'>
            <b>Coffee</b>
            <span>{state ? subtitle(mode, state, usualName) : 'Not reporting'}</span>
          </span>
          <span className='cs-sp' />
          {state && !phone && <Stepper mode={mode} state={state} />}
          <span className='cs-sp' />
          {showWho && <NotifyChip state={state} variant='head' />}
          <span className='cs-clock'>{formatHomeClock(nowMs)}</span>
        </header>
        {state ? (
          <StageBody data={{ state, live, baseline, beans, brews, recipes, advice }} nowMs={nowMs} phone={phone} />
        ) : (
          <div className='cs-empty'>
            <Icon icon='mdi:coffee-off-outline' aria-hidden='true' />
            The coffee machine is not reporting right now.
          </div>
        )}
      </section>
    </MotionScopeContext.Provider>
  );
}
