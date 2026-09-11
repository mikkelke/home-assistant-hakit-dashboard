export type AirBand = 'fresh' | 'good' | 'stuffy' | 'poor' | 'unknown';

export interface AirBandInfo {
  label: string;
  advice: string | null;
  cssVar: string;
}

const AIR_BANDS: Record<AirBand, AirBandInfo> = {
  fresh: { label: 'Fresh', advice: null, cssVar: '--air-fresh' },
  good: { label: 'Good', advice: null, cssVar: '--air-good' },
  stuffy: { label: 'Stuffy', advice: 'Open a window', cssVar: '--air-stuffy' },
  poor: { label: 'Poor', advice: 'Open a window and let it air out', cssVar: '--air-poor' },
  unknown: { label: 'Warming up', advice: null, cssVar: '--air-unknown' },
};

const BAND_ORDER: AirBand[] = ['unknown', 'fresh', 'good', 'stuffy', 'poor'];

export function normalizeAirBand(value: unknown): AirBand {
  const key = String(value ?? '')
    .trim()
    .toLowerCase();
  return key in AIR_BANDS ? (key as AirBand) : 'unknown';
}

export function airBandInfo(band: AirBand): AirBandInfo {
  return AIR_BANDS[band];
}

/** The worse of two bands, so one line can summarise IAQ and eCO2 together. */
export function worstAirBand(a: AirBand, b: AirBand): AirBand {
  if (a === 'unknown') return b;
  if (b === 'unknown') return a;
  return BAND_ORDER.indexOf(a) >= BAND_ORDER.indexOf(b) ? a : b;
}
