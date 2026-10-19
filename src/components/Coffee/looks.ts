/** Sizes of one chart surface, in px. */
export interface BrewChartLook {
  font: number;
  padL: number;
  padR: number;
  padT: number;
  /** Height of the pour lane under the plot; 0 for none. */
  lane: number;
  blockH: number;
  blockFont: number;
  blockText: boolean;
  names: 'full' | 'short' | null;
  pauses: boolean;
  drawdown: boolean;
  yLabels: boolean;
  /** Height of the time axis labels; 0 for none. */
  axis: number;
  xStep: number;
  thin: boolean;
  endLabels: boolean;
}

export const LOOK_STAGE: BrewChartLook = {
  font: 15,
  padL: 50,
  padR: 84,
  padT: 12,
  lane: 78,
  blockH: 44,
  blockFont: 16,
  blockText: true,
  names: 'full',
  pauses: true,
  drawdown: true,
  yLabels: true,
  axis: 29,
  xStep: 30,
  thin: false,
  endLabels: true,
};

export const LOOK_STAGE_PHONE: BrewChartLook = {
  ...LOOK_STAGE,
  font: 11,
  padL: 30,
  padR: 52,
  padT: 8,
  lane: 50,
  blockH: 24,
  blockFont: 11,
  names: 'short',
  pauses: false,
  axis: 20,
  xStep: 60,
};

export const LOOK_CARD: BrewChartLook = {
  font: 9,
  padL: 24,
  padR: 4,
  padT: 4,
  lane: 34,
  blockH: 16,
  blockFont: 10,
  blockText: true,
  names: 'short',
  pauses: false,
  drawdown: false,
  yLabels: true,
  axis: 13,
  xStep: 60,
  thin: true,
  endLabels: false,
};

export const LOOK_MINI: BrewChartLook = { ...LOOK_CARD, padL: 4, lane: 24, names: null, yLabels: false };

export const LOOK_HIST: BrewChartLook = { ...LOOK_CARD, lane: 18, blockH: 10, blockText: false, names: null };

export const LOOK_PLAN: BrewChartLook = { ...LOOK_CARD, lane: 40, blockH: 18, blockFont: 10.5 };
