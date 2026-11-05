/** A drawn mark for something on screen that has no icon of its own: the strip's plan block, call mark and now line,
 * the faint bands behind the calls, the bar of a scale, and a zone glyph lit, solid or with its dashed shadow ring. */
export type LegendMark = 'plan' | 'call' | 'now' | 'band' | 'bar' | 'lit' | 'live' | 'shadow';

export interface LegendRow {
  /** The icon the element carries on screen. */
  icon?: string;
  /** A figure the element shows on screen, such as "kWh" or "+0.6". */
  figure?: string;
  /** Colours the figure like the element on screen. */
  tone?: 'warm' | 'cold';
  mark?: LegendMark;
  text: string;
}

/** What the ring around a zone's glyph says, wherever a glyph is shown. */
export const RING_ROWS: readonly LegendRow[] = [
  { mark: 'live', text: 'Solid: the controller steers this thermostat.' },
  { mark: 'shadow', text: 'Dashed ring: shadow, it only calculates and the thermostat keeps its own setting.' },
];
