import { describe, expect, it } from 'vitest';
import { humidifierChip } from '../roomClimateStory';

describe('humidifierChip', () => {
  it('names what the humidifier does or cannot do', () => {
    expect(humidifierChip({ state: 'humidifying' })).toMatchObject({ label: 'Humidifying', tone: 'cool' });
    expect(humidifierChip({ state: 'drying' })).toMatchObject({ label: 'Drying the wick', tone: 'neutral' });
    expect(humidifierChip({ state: 'manual' })).toMatchObject({ label: 'Humidifier by hand' });
    expect(humidifierChip({ state: 'no_water' })).toMatchObject({ label: 'Humidifier tank empty', tone: 'alert' });
  });

  it('stays silent while it is off, unknown or absent', () => {
    for (const state of ['off', 'unknown', 'unavailable', '']) expect(humidifierChip({ state })).toBeNull();
    expect(humidifierChip(null)).toBeNull();
  });
});
