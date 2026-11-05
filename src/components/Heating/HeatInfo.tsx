import { Icon } from '@iconify/react';
import { Glyph } from './ZoneGlyph';
import type { LegendRow } from './legend';
import './HeatInfo.css';

/** The (i) button that opens a legend. 44 px to tap; the legend itself is rendered by the caller where it belongs,
 * so the button needs no more than its state. */
export function InfoToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type='button' className='heat-info-btn' aria-label='What do these mean?' aria-expanded={open} onClick={onToggle}>
      <Icon icon='mdi:information-outline' aria-hidden='true' />
    </button>
  );
}

interface LegendProps {
  rows: readonly LegendRow[];
  /** The glyph the ring marks wear: the zone's own, else a radiator. */
  glyph?: { icon?: string; letter?: string };
}

function MarkView({ row, glyph }: { row: LegendRow } & Pick<LegendProps, 'glyph'>) {
  const { mark } = row;
  if (mark === 'lit' || mark === 'live' || mark === 'shadow') {
    const state = mark === 'lit' ? 'is-calling' : mark === 'live' ? 'is-live' : 'is-shadow';
    return <Glyph icon={glyph?.icon} letter={glyph?.letter} className={`is-tiny ${state}`} />;
  }
  return (
    <>
      {mark && <span className={`heat-legend-swatch is-${mark}`} />}
      {row.icon && <Icon icon={row.icon} />}
      {row.figure && <b className={`heat-legend-figure${row.tone ? ` is-${row.tone}` : ''}`}>{row.figure}</b>}
    </>
  );
}

/** What each thing on a card or sheet means, one row each: the thing as it looks on screen and a plain sentence. */
export function Legend({ rows, glyph }: LegendProps) {
  return (
    <ul className='heat-legend' aria-label='What these mean'>
      {rows.map(row => (
        <li key={row.text} className='heat-legend-row'>
          <span className='heat-legend-mark' aria-hidden='true'>
            <MarkView row={row} glyph={glyph} />
          </span>
          <span className='heat-legend-text'>{row.text}</span>
        </li>
      ))}
    </ul>
  );
}
