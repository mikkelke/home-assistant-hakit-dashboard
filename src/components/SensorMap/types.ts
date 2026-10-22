import type { Facing, Point, SuggestItem } from '../../sensorMap/mapDoc';

export interface Layers {
  /** Type keys that are switched off; every other type shows. */
  hiddenTypes: string[];
  names: boolean;
  grid: boolean;
  footprints: boolean;
  phones: boolean;
  fingerprints: boolean;
  survey: boolean;
  coverage: boolean;
  suggestions: boolean;
  light: boolean;
}

/** What the map is for right now: looking at it, changing it, or walking a Wi-Fi survey. */
export type Mode = 'view' | 'edit' | 'survey';

/** The layers the Layers sheet offers as switches. `survey` is a mode, not a switch. */
export const SWITCHES = ['names', 'grid', 'footprints', 'phones', 'fingerprints', 'coverage', 'suggestions', 'light'] as const;
export type Switch = (typeof SWITCHES)[number];

export const DEFAULT_LAYERS: Layers = {
  hiddenTypes: [],
  names: false,
  grid: true,
  footprints: true,
  phones: false,
  fingerprints: true,
  survey: false,
  coverage: false,
  suggestions: true,
  light: false,
};

export type Selection =
  | { kind: 'device'; key: string }
  | { kind: 'ghost'; id: string }
  | { kind: 'zone'; id: string; at?: Point }
  | { kind: 'fingerprint'; id: string }
  | { kind: 'tray'; id: string }
  | { kind: 'vent'; id: string }
  | { kind: 'point'; at: Point };

/** What the pointer shows while a marker, a handle, a vent or a suggested marker is being dragged, before anything is committed. */
export type DragPreview =
  | { kind: 'move'; key: string; x: number; y: number }
  | { kind: 'facing'; key: string; deg: number }
  | { kind: 'ghost'; id: string; x: number; y: number }
  | { kind: 'vent'; id: string; x: number; y: number };

export function typeVisible(layers: Layers, type: string, roles: readonly string[]): boolean {
  const hidden = layers.hiddenTypes;
  return !hidden.includes(type) || roles.some(role => !hidden.includes(role));
}

/** How many of the document's device types are switched off. */
export const hiddenTypeCount = (layers: Layers, types: readonly { key: string }[]): number =>
  types.filter(type => layers.hiddenTypes.includes(type.key)).length;

/** The id of the clip path for a zone (`z`) or an open region (`c`). */
export const clipIdOf = (kind: 'z' | 'c', id: string) => `sm-clip-${kind}-${id}`;

/** What the device sheet can ask the page to do; the page turns each into a stamped, queued operation. */
export interface DeviceActions {
  move: (key: string, x: number, y: number) => void;
  facing: (key: string, facing: Facing) => void;
  height: (key: string, h: number | null) => void;
  confirm: (key: string, confirmed: boolean) => void;
  undo: (key: string) => void;
  unplace: (key: string) => void;
  setType: (key: string, type: string) => void;
  accept: (item: SuggestItem) => void;
  reject: (id: string) => void;
  openRef: (id: string) => void;
}

export type Capture =
  | { phase: 'idle' }
  | { phase: 'aim' }
  /** `address` is empty when no phone is tracked; `surveyId` names the survey point being captured. */
  | { phase: 'confirm'; at: Point; hCm: number; note: string; address: string; surveyId?: string }
  /** `waitS` is set once the window is over and Wi-Fi is still awaited: the whole seconds since the start. */
  | { phase: 'running'; at: Point; elapsedS: number; surveyId?: string; waitS?: number };
