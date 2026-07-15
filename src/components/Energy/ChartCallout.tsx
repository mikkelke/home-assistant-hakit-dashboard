import './ChartCallout.css';

export interface ChartCalloutModel {
  leftPct: number;
  title: string;
  primary: string;
  secondary?: string | null;
  dot?: 'low' | 'mid' | 'high' | 'unknown' | null;
  note?: string | null;
}

/** Floating value readout above the chart, horizontally tracking the scrubbed slot — purely
 * presentational; the Usage tab builds the model. Pointer events pass through it. */
export function ChartCallout({ leftPct, title, primary, secondary, dot, note }: ChartCalloutModel) {
  const left = Math.min(88, Math.max(12, leftPct));
  return (
    <div className='chart-callout' style={{ left: `${left}%` }}>
      <span className='chart-callout-title'>{title}</span>
      <span className='chart-callout-primary'>
        {dot && <span className={`chart-callout-dot chart-callout-dot--${dot}`} />}
        {primary}
      </span>
      {secondary && <span className='chart-callout-secondary'>{secondary}</span>}
      {note && <span className='chart-callout-note'>{note}</span>}
    </div>
  );
}
