import { describe, expect, it } from 'vitest';
import { plantPhoto } from '../plantPhotos';

/** The keys the publisher names as the `photo` of a plant. */
const KEYS = [
  'strelitzia',
  'philodendron',
  'pothos',
  'ivy',
  'monstera',
  'peace_lily_kitchen',
  'peace_lily_tv',
  'fiddle_leaf_fig_dining',
  'fiddle_leaf_fig_bedroom',
  'satin_pothos',
  'snake_plant_dining',
  'snake_plant_living',
  'snake_plant_bathroom',
  'aloe',
  'alocasia',
  'cactus',
  'pineapple',
];

describe('plantPhoto', () => {
  it('gives the file named for a key when there is one, and no photo, never an error, when there is none', () => {
    for (const key of KEYS) {
      const url = plantPhoto(key);
      if (url !== undefined) expect(url.endsWith(`/${key}.webp`), key).toBe(true);
    }
  });

  it('knows no photo for anything that is not the name of a file', () => {
    for (const key of ['', 'no_such_plant', 'constructor', '__proto__', 'toString', 'monstera.webp', './plantPhotos/monstera.webp']) {
      expect(plantPhoto(key), key).toBeUndefined();
    }
  });
});
