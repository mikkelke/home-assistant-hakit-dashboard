import { Icon } from '@iconify/react';
import { planLabel, type AppliancePlan } from '../../energy/appliancePlan';
import { formatHomeClock } from '../../energy/homeTime';
import { krValue, pressChips } from '../../energy/planView';

interface RunLaterCardProps {
  appliance: AppliancePlan;
  onOpen: () => void;
  onToggleDryer: () => void;
}

/** One appliance in "Run later": its usual programme's cost now against the plan, with the start
 * time, knob position and press window as chips; or, while it runs, its state, finish time and the
 * next plan from when it frees up. */
export function RunLaterCard({ appliance, onOpen, onToggleDryer }: RunLaterCardProps) {
  const { config, run, programme, plan, dryer, withDryer } = appliance;
  const label = planLabel(appliance);
  const busy = run.status !== 'idle';
  const choice = plan?.plan ?? null;
  const saving = !busy ? (plan?.savingKr ?? null) : null;
  const chips = choice && !busy ? pressChips(choice, formatHomeClock) : null;

  return (
    <div className={`plan-approw ${busy ? 'plan-approw--run' : ''}`}>
      <span className={`plan-atile ${busy ? 'plan-atile--run' : ''}`}>
        <Icon icon={config.icon} aria-hidden='true' />
        {busy && <span className='plan-runbadge' />}
      </span>
      <span className='plan-amid'>
        <span className='plan-aline'>
          <span className='plan-aname'>{label}</span>
          {!busy && choice && (
            <span className='plan-aprice'>
              {saving != null && plan?.noDelay ? (
                <>
                  <s>{krValue(plan.noDelay.kr)}</s>
                  <Icon icon='mdi:chevron-right' className='plan-dim' aria-hidden='true' />
                  <b>{krValue(choice.costKr)} kr</b>
                </>
              ) : (
                <span>{krValue(choice.costKr)} kr</span>
              )}
              {choice.estimated && <small className='plan-dim'>est.</small>}
            </span>
          )}
        </span>
        <span className='plan-chips'>
          {dryer && <DryerChip on={withDryer} className='plan-chip--tiny' onToggle={onToggleDryer} />}
          {busy && (
            <span className='plan-chip plan-chip--tiny plan-chip--sky'>
              {run.status === 'paused' ? 'paused' : 'running'}
              {run.etaMs != null && ` · done ${formatHomeClock(run.etaMs)}`}
            </span>
          )}
          {busy && choice && <span className='plan-chip plan-chip--tiny plan-chip--ghost'>next {formatHomeClock(choice.startMs)}</span>}
          {!busy && !programme && <span className='plan-chip plan-chip--tiny plan-chip--ghost'>no profile yet</span>}
          {!busy && programme && !choice && <span className='plan-chip plan-chip--tiny plan-chip--ghost'>no prices ahead</span>}
          {chips && !chips.start && !chips.knob && (
            <span className='plan-chip plan-chip--tiny plan-chip--ghost'>
              <Icon icon='mdi:check' aria-hidden='true' />
              now is fine
            </span>
          )}
          {chips?.start && (
            <span className='plan-chip plan-chip--tiny plan-chip--sky'>
              <Icon icon='mdi:clock-outline' aria-hidden='true' />
              {chips.start}
            </span>
          )}
          {chips?.knob && (
            <span className='plan-chip plan-chip--tiny plan-chip--ghost'>
              <Icon icon='mdi:knob' aria-hidden='true' />
              {chips.knob}
            </span>
          )}
          {chips?.press && (
            <span className='plan-chip plan-chip--tiny plan-chip--ghost'>
              <Icon icon='mdi:gesture-tap' aria-hidden='true' />
              {chips.press}
            </span>
          )}
        </span>
      </span>
      {saving != null ? (
        <span className='plan-save'>−{krValue(saving)}</span>
      ) : (
        programme && <Icon icon='mdi:chevron-right' className='plan-dim plan-chev' aria-hidden='true' />
      )}
      {programme && <button type='button' className='plan-approw-hit' aria-label={`${label} plan`} onClick={onOpen} />}
    </div>
  );
}

/** Plans the dryer straight after the washer. */
export function DryerChip({ on, className = '', onToggle }: { on: boolean; className?: string; onToggle: () => void }) {
  return (
    <button
      type='button'
      aria-pressed={on}
      className={`plan-chip plan-chip--button ${on ? 'plan-chip--sky' : 'plan-chip--ghost'} ${className}`}
      onClick={onToggle}
    >
      + dryer
    </button>
  );
}
