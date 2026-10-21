import type { HouseOptions } from './fixtures/house';
import type { OpenOptions } from './session';
import type { Shots } from './shots';

/** One page load and the pictures taken from it. */
export interface Flow {
  /** Names the test; the PNGs carry their own names. */
  name: string;
  house?: HouseOptions;
  open?: OpenOptions;
  /** A selector that is only on the page when the screen has drawn its content. */
  ready: string;
  /** Skips the other viewport. */
  only?: 'phone' | 'tablet';
  run: (shots: Shots) => Promise<void>;
}
