import { formatDecimal } from '../../utils/format';
import { signed } from '../../body/chartScale';

interface SwingGaugeProps {
  /** The latest weighing minus the trend, in kg. */
  offset: number;
  /** How far four out of five weighings sit from the trend, in kg. */
  swing: number;
}

/** Where the latest weighing sits against the trend: a dot on a track centred on the trend, over the band the weighings
 * usually stay in. */
export function SwingGauge({ offset, swing }: SwingGaugeProps) {
  const half = Math.max(1.5, Math.abs(offset) + 0.3);
  const at = (kg: number) => 50 + (kg / half) * 50;
  const band = Math.min(swing, half);
  const dot = at(offset);
  const level = Math.round(Math.abs(offset) * 10) === 0;
  const against = level ? 'on the trend' : `${formatDecimal(Math.abs(offset), 1)} kg ${offset > 0 ? 'above' : 'below'} the trend`;
  const summary = `The latest weighing is ${against}. Four in five weighings are within ${formatDecimal(swing, 1)} kg of it.`;
  return (
    <div className='body-gauge' role='img' aria-label={summary}>
      <span className='body-gauge-value' style={{ left: `${Math.min(92, Math.max(8, dot))}%` }}>
        {signed(offset)}
      </span>
      <div className='body-gauge-track'>
        <span className='body-gauge-band' style={{ left: `${at(-band)}%`, width: `${at(band) - at(-band)}%` }} />
        <span className='body-gauge-tick' />
        <span className='body-gauge-dot' style={{ left: `${dot}%` }} />
      </div>
      <span className='body-gauge-swing'>±{formatDecimal(swing, 1)}</span>
    </div>
  );
}
