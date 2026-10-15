import type { Facing, Point, SuggestItem } from '../../sensorMap/mapDoc';

export interface Layers {
  /** Type keys that are switched off; every other type shows. */
  hiddenTypes: string[];
  names: boolean;
  grid: boolean;
  footprints: boolean;
  phones: boolean;
  fingerprints: boolean;
  suggestions: boolean;
  light: boolean;
}

export const DEFAULT_LAYERS: Layers = {
  hiddenTypes: [],
  names: false,
  grid: true,
  footprints: true,
  phones: false,
  fingerprints: true,
  suggestions: true,
  light: false,
};

export type Selection =
  | { kind: 'device'; key: string }
  | { kind: 'ghost'; id: string }
  | { kind: 'zone'; id: string; at?: Point }
  | { kind: 'fingerprint'; id: string }
  | { kind: 'tray'; id: string }
  | { kind: 'point'; at: Point };

/** What the pointer shows while a marker or a handle is being dragged, before anything is committed. */
export type DragPreview = { kind: 'move'; key: string; x: number; y: number } | { kind: 'facing'; key: string; deg: number };

export function typeVisible(layers: Layers, type: string, roles: readonly string[]): boolean {
  const hidden = layers.hiddenTypes;
  return !hidden.includes(type) || roles.some(role => !hidden.includes(role));
}

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
  | { phase: 'confirm'; at: Point; hCm: number; note: string; address: string }
  | { phase: 'running'; at: Point; elapsedS: number };
