import type { VentKind } from '../../sensorMap/mapDoc';

/** Marker glyphs on a 24 by 24 grid, one per device type; drawn with a round 2 unit stroke. */
export const GLYPHS: Record<string, string> = {
  ble: 'M6.5 7.5l11 9-5.5 4.5V3l5.5 4.5-11 9',
  presence:
    'M12 10.4a1.6 1.6 0 1 0 0 3.2a1.6 1.6 0 1 0 0-3.2M8.3 8.3a5.2 5.2 0 0 0 0 7.4M15.7 8.3a5.2 5.2 0 0 1 0 7.4M5 5a9.9 9.9 0 0 0 0 14M19 5a9.9 9.9 0 0 1 0 14',
  contact: 'M5 21V3h11v18M3 21h18M12.5 12h.5',
  bed: 'M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-8v6M6.5 11.5h.5',
  thermo: 'M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0zM12 9v7',
  plug: 'M9 2.5v5M15 2.5v5M6 7.5h12v3.5a6 6 0 0 1-12 0zM12 17v4.5',
  speaker: 'M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.6 5.4a9.3 9.3 0 0 1 0 13.2',
  wifi: 'M12 18h.01M9.17 15.17a4 4 0 0 1 5.66 0M6.34 12.34a8 8 0 0 1 11.32 0M3.51 9.51a12 12 0 0 1 16.98 0',
  other: 'M8 8h8v8H8zM12 3v5M12 16v5M3 12h5M16 12h5',
};

export const glyphOf = (type: string): string => GLYPHS[type] ?? GLYPHS.other;

/** The type class a marker takes its colour from; a type the page has no colour for reads as "other". */
export const typeClass = (type: string): string => (type in GLYPHS ? `t-${type}` : 't-other');

/** The radius of a vent's ring in marker units, where a device marker has 10. */
export const VENT_R = 7;

/** Two arrows along the ring's horizontal axis, centred on the vent: out of the ring for a supply, into it for an exhaust. */
const VENT_GLYPHS: Record<VentKind, string> = {
  supply: 'M-1.4 0H-5.2M-3.4 -2L-5.2 0L-3.4 2M1.4 0H5.2M3.4 -2L5.2 0L3.4 2',
  exhaust: 'M-5.2 0H-1.4M-3.2 -2L-1.4 0L-3.2 2M5.2 0H1.4M3.2 -2L1.4 0L3.2 2',
};

export const ventGlyph = (kind: VentKind): string => VENT_GLYPHS[kind];
