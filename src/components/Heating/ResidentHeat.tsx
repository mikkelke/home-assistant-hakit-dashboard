import { Icon } from '@iconify/react';
import type { ResidentHeatState } from './useResidentHeat';
import './ResidentHeat.css';

const CX = 108;
const CY = 104;
const R = 86;
const SWEEP = 135;

/** Room temperature on a 270° ring: a flame and an orange arc up to the target while the zone
 * heats, the target as a tick. Off season the ring is quiet and carries no target. */
export function HeatDial({ tempC, heat }: { tempC: number | null; heat: ResidentHeatState }) {
  const target = heat.seasonOn ? heat.target : null;
  const known = [tempC, target].filter((v): v is number => v != null);
  const lo = Math.floor(Math.min(heat.lower ?? 19, ...known));
  const hi = Math.ceil(Math.max(heat.upper ?? 24, ...known));
  const angle = (v: number) => ((-SWEEP + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * 2 * SWEEP) * Math.PI) / 180;
  const point = (v: number, r = R) => [CX + r * Math.sin(angle(v)), CY - r * Math.cos(angle(v))] as const;
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(from);
    const [x2, y2] = point(to);
    const large = angle(to) - angle(from) > Math.PI ? 1 : 0;
    return `M${x1.toFixed(1)},${y1.toFixed(1)} A${R},${R} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)}`;
  };
  const heatingArc = heat.seasonOn && heat.heating && tempC != null && target != null && target > tempC;
  const icon = !heat.seasonOn ? 'mdi:radiator-off' : heat.heating ? 'mdi:fire' : null;
  const label = [
    tempC == null ? 'Room temperature unavailable' : `Room ${tempC.toFixed(1)} °C`,
    target != null ? `target ${target.toFixed(1)} °C` : null,
    !heat.seasonOn ? 'heating season off' : heat.heating ? 'heating' : 'not heating',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className='heat-dial' role='img' aria-label={label}>
      <svg className='heat-dial-svg' viewBox='0 0 216 196' aria-hidden='true'>
        <path d={arc(lo, hi)} className='heat-dial-track' />
        {heatingArc && <path d={arc(tempC, target)} className='heat-dial-arc' />}
        {target != null && (
          <>
            <line
              className='heat-dial-tick-shadow'
              x1={point(target, R - 12)[0]}
              y1={point(target, R - 12)[1]}
              x2={point(target, R + 12)[0]}
              y2={point(target, R + 12)[1]}
            />
            <line
              className='heat-dial-tick'
              x1={point(target, R - 12)[0]}
              y1={point(target, R - 12)[1]}
              x2={point(target, R + 12)[0]}
              y2={point(target, R + 12)[1]}
            />
          </>
        )}
        {tempC != null && <circle className='heat-dial-now' cx={point(tempC)[0]} cy={point(tempC)[1]} r={7} />}
      </svg>
      <div className='heat-dial-center'>
        <span className='heat-dial-temp'>{tempC == null ? '—' : `${tempC.toFixed(1)}°`}</span>
        <span className={`heat-dial-state ${heat.seasonOn ? 'is-heating' : 'is-off'}`}>
          {icon && <Icon icon={icon} aria-hidden='true' />}
        </span>
      </div>
    </div>
  );
}

/** Colder / target with nudge pips / warmer. */
export function NudgeStepper({ heat, disabled }: { heat: ResidentHeatState; disabled: boolean }) {
  const { control, target, waiting } = heat;
  return (
    <div className='climate-stepper nudge-stepper'>
      <button
        type='button'
        className='climate-step nudge-colder'
        aria-label='Colder'
        disabled={disabled || waiting || !control.canColder}
        onClick={heat.colder}
      >
        <Icon icon='mdi:minus' aria-hidden='true' />
      </button>
      <div className='climate-target-text'>
        <output
          className='climate-target-value nudge-target'
          aria-live='polite'
          aria-label={target == null ? 'Target unknown' : `Target ${target.toFixed(1)} °C`}
        >
          <Icon icon='mdi:target' aria-hidden='true' />
          {target == null ? '—' : `${target.toFixed(1)}°`}
        </output>
        <span className='nudge-pips' aria-hidden='true'>
          {control.steps.map(step => {
            const lit = step > 0 ? control.nudge >= step : step < 0 ? control.nudge <= step : false;
            return <i key={step} className={step === 0 ? 'is-zero' : lit ? (step > 0 ? 'is-up' : 'is-down') : ''} />;
          })}
        </span>
      </div>
      <button
        type='button'
        className='climate-step nudge-warmer'
        aria-label='Warmer'
        disabled={disabled || waiting || !control.canWarmer}
        onClick={heat.warmer}
      >
        <Icon icon='mdi:plus' aria-hidden='true' />
      </button>
    </div>
  );
}
