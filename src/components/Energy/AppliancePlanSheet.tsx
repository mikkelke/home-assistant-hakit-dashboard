import { useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { DONE_BY_HOURS, type DoneByHour } from '../../config/plan';
import { assembleAppliancePlan, type AppliancePlan } from '../../energy/appliancePlan';
import { formatHomeClock } from '../../energy/homeTime';
import { durationLabel, krValue, pressChips, programmeLabel } from '../../energy/planView';
import type { PricePointMs } from '../../energy/priceTimeline';
import { costCurve } from '../../energy/startPlan';
import { ApplianceSheet } from '../Appliance';
import { CostByStartChart } from './CostByStartChart';

interface AppliancePlanSheetProps {
  /** The appliance's plan as the Run later card shows it; the sheet re-plans for its own choices. */
  appliance: AppliancePlan;
  timeline: readonly PricePointMs[];
  nowMs: number;
  onClose: () => void;
}

const DONE_BY_OPTIONS: Array<{ value: DoneByHour; label: string }> = [
  ...DONE_BY_HOURS.map(hour => ({ value: hour, label: `${String(hour).padStart(2, '0')}:00` })),
  { value: null, label: 'Any' },
];

/** One appliance's start plan: programme, start now against the plan, the press window, cost by
 * start time over the next 24 hours, and a done-by limit. */
export function AppliancePlanSheet({ appliance, timeline, nowMs, onClose }: AppliancePlanSheetProps) {
  const [programmeKey, setProgrammeKey] = useState<string | null>(appliance.programme?.key ?? null);
  const [doneBy, setDoneBy] = useState<DoneByHour>(null);

  const planned = useMemo(
    () =>
      assembleAppliancePlan({
        config: appliance.config,
        run: appliance.run,
        programmes: appliance.programmes,
        programmeKey,
        doneBy,
        timeline,
        nowMs,
      }),
    [appliance.config, appliance.run, appliance.programmes, programmeKey, doneBy, timeline, nowMs]
  );
  const { config, run, programme, plan, doneByMs } = planned;

  const curve = useMemo(
    () =>
      programme && plan
        ? costCurve(programme, timeline, { pressFromMs: plan.pressFromMs, knobStepsMin: config.knobStepsMin, doneByMs })
        : null,
    [programme, plan, timeline, config.knobStepsMin, doneByMs]
  );

  if (!programme) return null;

  const choice = plan?.plan ?? null;
  const chips = choice ? pressChips(choice, formatHomeClock) : null;
  const pressLater = plan != null && plan.pressFromMs > nowMs + 60_000;
  const showPlanTile = choice != null && choice.kind !== 'now';
  const doneByLabel = DONE_BY_OPTIONS.find(o => o.value === doneBy)?.label ?? '';

  return (
    <ApplianceSheet
      accentClassName={`appliance-accent-${config.key}`}
      glyphIcon={config.icon}
      title={config.label}
      historyKey={`plan-${config.key}`}
      onClose={onClose}
    >
      <div className='plan-sheet'>
        {appliance.programmes.length > 1 && (
          <div className='plan-chips' role='group' aria-label='Programme'>
            {appliance.programmes.map(p => (
              <button
                key={p.key}
                type='button'
                aria-pressed={p.key === programme.key}
                className={`plan-chip plan-chip--button ${p.key === programme.key ? 'plan-chip--sky' : 'plan-chip--ghost'}`}
                onClick={() => setProgrammeKey(p.key)}
              >
                {programmeLabel(p)}
              </button>
            ))}
          </div>
        )}
        <div className='plan-chips'>
          {appliance.programmes.length <= 1 && <span className='plan-chip plan-chip--ghost'>{programmeLabel(programme)}</span>}
          <span className='plan-chip plan-chip--ghost'>
            <Icon icon='mdi:flash-outline' aria-hidden='true' />≈ {krValue(programme.kwh)} kWh
          </span>
          {programme.completionMin != null && (
            <span className='plan-chip plan-chip--ghost'>
              <Icon icon='mdi:clock-outline' aria-hidden='true' />
              {durationLabel(programme.completionMin)}
            </span>
          )}
          <span className='plan-chip plan-chip--ghost'>{programme.n} runs</span>
        </div>

        {run.status !== 'idle' && (
          <div className='plan-chips'>
            <span className='plan-chip plan-chip--sky'>
              {run.status === 'paused' ? 'paused' : 'running'}
              {run.etaMs != null && ` · done ${formatHomeClock(run.etaMs)}`}
            </span>
            {!plan && <span className='plan-chip plan-chip--ghost'>next run once it is done</span>}
          </div>
        )}

        {plan && (
          <div className='plan-cmp'>
            <div className={`plan-cmp-t ${showPlanTile ? '' : 'plan-cmp-t--best'}`}>
              <span className='plan-k'>{pressLater ? `Start ${formatHomeClock(plan.pressFromMs)}` : 'Start now'}</span>
              <span className='plan-cmp-v'>
                {plan.noDelay ? krValue(plan.noDelay.kr) : '—'}
                <small> kr</small>
              </span>
              {programme.completionMin != null && (
                <span className='plan-cmp-s'>done {formatHomeClock(plan.pressFromMs + programme.completionMin * 60_000)}</span>
              )}
            </div>
            {showPlanTile && choice && (
              <>
                <Icon icon='mdi:chevron-right' className='plan-dim' aria-hidden='true' />
                <div className={`plan-cmp-t ${plan.savingKr != null ? 'plan-cmp-t--best' : ''}`}>
                  <span className='plan-k'>{formatHomeClock(choice.startMs)}</span>
                  <span className={`plan-cmp-v ${plan.savingKr != null ? 'band--cheap plan-cmp-v--band' : ''}`}>
                    {krValue(choice.costKr)}
                    <small> kr{choice.estimated ? ' est.' : ''}</small>
                  </span>
                  <span className='plan-cmp-s'>
                    {chips?.knob ? (
                      <>
                        <Icon icon='mdi:knob' aria-hidden='true' />
                        {chips.knob}
                      </>
                    ) : (
                      choice.doneMs != null && `done ${formatHomeClock(choice.doneMs)}`
                    )}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {chips?.press && (
          <div className='plan-chips'>
            <span className='plan-chip plan-chip--sky'>
              <Icon icon='mdi:gesture-tap' aria-hidden='true' />
              {chips.press}
            </span>
          </div>
        )}
        {plan?.doneByMissed && (
          <div className='plan-chips'>
            <span className='plan-chip band--expensive plan-chip--band'>
              <Icon icon='mdi:alert-outline' aria-hidden='true' />
              Can't finish by {doneByLabel}
            </span>
          </div>
        )}

        {curve && plan && (
          <>
            <div className='plan-row-head plan-row-head--in'>
              <span>Cost by start time</span>
              {plan.savingKr != null && <span className='plan-chip plan-chip--band band--cheap'>save {krValue(plan.savingKr)} kr</span>}
            </div>
            <div className='plan-card plan-card--chart plan-card--inset'>
              <CostByStartChart
                curve={curve}
                plan={choice}
                startLabel={pressLater ? formatHomeClock(plan.pressFromMs) : 'now'}
                doneByLabel={doneBy == null ? null : doneByLabel}
              />
            </div>
          </>
        )}

        {run.status !== 'paused' && (
          <div className='plan-row-head plan-row-head--in'>
            <span>Done by</span>
            {programme.completionMin == null ? (
              <span className='plan-chip plan-chip--ghost'>finish time unknown</span>
            ) : (
              <span className='plan-toggle' role='group' aria-label='Done by'>
                {DONE_BY_OPTIONS.map(option => (
                  <button
                    key={option.label}
                    type='button'
                    aria-pressed={doneBy === option.value}
                    className={doneBy === option.value ? 'plan-toggle-on' : ''}
                    onClick={() => setDoneBy(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </span>
            )}
          </div>
        )}
      </div>
    </ApplianceSheet>
  );
}
