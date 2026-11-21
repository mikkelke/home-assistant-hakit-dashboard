import { describe, expect, it } from 'vitest';
import { washerSupportsShort } from '../washerOptions';

describe('washerSupportsShort', () => {
  it('is offered for the programmes the machine has Kort on', () => {
    for (const label of ['Bomuld', 'Strygelet', 'Finvask', 'Mørkt/Denim', 'Outdoor']) {
      expect(washerSupportsShort(label)).toBe(true);
    }
  });

  it('is not offered where Kort is built in or not available', () => {
    for (const label of ['Ekspres', 'ECO', 'Uld', 'Imprægnering', 'Pumpe/Centrifugering', 'Kun skyl/stivelse', 'Drum clean']) {
      expect(washerSupportsShort(label)).toBe(false);
    }
  });

  it('is not offered until a programme is confirmed', () => {
    for (const label of ['Auto (unconfirmed)', '—', '', undefined, null]) {
      expect(washerSupportsShort(label)).toBe(false);
    }
  });
});
