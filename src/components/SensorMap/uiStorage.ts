import type { View } from '../../sensorMap/geometry';
import { DEFAULT_LAYERS, type Layers } from './types';

const KEY = 'sensormap-ui-v1';

export interface SavedUi {
  layers: Layers;
  view: View | null;
  /** The survey points the person chose to skip. */
  skipped: string[];
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The layer set and the last view, kept in this browser only: neither belongs in the shared document. */
export function loadUi(): SavedUi {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as {
      layers?: Partial<Layers>;
      view?: Partial<View>;
      skipped?: unknown;
    } | null;
    const view = raw?.view;
    return {
      layers: {
        ...DEFAULT_LAYERS,
        ...(raw?.layers ?? {}),
        hiddenTypes: Array.isArray(raw?.layers?.hiddenTypes) ? raw.layers.hiddenTypes.filter(item => typeof item === 'string') : [],
      },
      view:
        view && isNumber(view.cx) && isNumber(view.cy) && isNumber(view.s) && view.s > 0 ? { cx: view.cx, cy: view.cy, s: view.s } : null,
      skipped: Array.isArray(raw?.skipped) ? raw.skipped.filter((item): item is string => typeof item === 'string') : [],
    };
  } catch {
    return { layers: DEFAULT_LAYERS, view: null, skipped: [] };
  }
}

export function saveUi(ui: SavedUi) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ui));
  } catch {
    // Storage blocked or full: the page works the same without remembering.
  }
}
