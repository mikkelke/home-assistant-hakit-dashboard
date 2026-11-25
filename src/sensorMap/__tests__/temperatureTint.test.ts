import { describe, expect, it } from 'vitest';
import { TEMP_AIM_C, seatedThermometerOf, temperatureTint } from '../temperatureTint';

describe('temperatureTint', () => {
  it('leaves a room near the aim untinted', () => {
    expect(temperatureTint(TEMP_AIM_C + 0.2).opacity).toBe(0);
  });

  it('tints cool below and warm above, up to the cap', () => {
    expect(temperatureTint(19.8)).toEqual({ tone: 'cool', opacity: expect.any(Number) });
    expect(temperatureTint(19.8).opacity).toBeGreaterThan(0);
    expect(temperatureTint(23).tone).toBe('warm');
    expect(temperatureTint(30).opacity).toBe(0.5);
  });

  it('names the seated thermometer of a zone', () => {
    expect(seatedThermometerOf('claudias_room')).toBe('sensor.claudias_room_seated_thermometer_temperature');
  });
});
