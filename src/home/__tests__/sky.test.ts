import { describe, expect, it } from 'vitest';
import { arcPoint, celestialPosition, cloudCount, skyPhase, windArrowDeg, windMs } from '../sky';

/** `sun.sun` on 13.10 at 16:00 home time: the sun is up and sets at 18:15:59. */
const NEXT_RISING = Date.parse('2026-10-14T05:37:14Z');
const NEXT_SETTING = Date.parse('2026-10-13T16:15:59Z');

describe('skyPhase', () => {
  it('reads night, twilight, low sun and day from the elevation and its direction', () => {
    expect(skyPhase(-20, false)).toBe('night');
    expect(skyPhase(-6.1, true)).toBe('night');
    expect(skyPhase(-3, true)).toBe('dawn');
    expect(skyPhase(-3, false)).toBe('dusk');
    expect(skyPhase(4, true)).toBe('morning');
    expect(skyPhase(4, false)).toBe('evening');
    expect(skyPhase(15.1, false)).toBe('day');
    expect(skyPhase(null, false)).toBe('day');
  });
});

describe('arcPoint', () => {
  it('runs from the left horizon over the top to the right horizon', () => {
    expect(arcPoint(0)).toEqual({ x: 20 / 358, y: 104 });
    expect(arcPoint(0.5)).toEqual({ x: 0.5, y: 22 });
    expect(arcPoint(1)).toEqual({ x: 338 / 358, y: 104 });
    expect(arcPoint(-1)).toEqual(arcPoint(0));
    expect(arcPoint(2)).toEqual(arcPoint(1));
  });
});

describe('celestialPosition', () => {
  it('puts the sun between the last rising and the next setting', () => {
    const afternoon = celestialPosition(true, NEXT_RISING, NEXT_SETTING, Date.parse('2026-10-13T14:00:00Z'));
    expect(afternoon?.body).toBe('sun');
    expect(afternoon?.t).toBeCloseTo(0.788, 2);
    expect(celestialPosition(true, NEXT_RISING, NEXT_SETTING, NEXT_SETTING)?.t).toBe(1);
  });

  it('puts the moon between the last setting and the next rising', () => {
    const lastSetting = NEXT_SETTING;
    const nextSetting = NEXT_SETTING + 86_400_000;
    const midnight = celestialPosition(false, NEXT_RISING, nextSetting, Date.parse('2026-10-13T22:56:00Z'));
    expect(midnight?.body).toBe('moon');
    expect(midnight?.t).toBeCloseTo((Date.parse('2026-10-13T22:56:00Z') - lastSetting) / (NEXT_RISING - lastSetting), 6);
  });

  it('gives up without both times', () => {
    expect(celestialPosition(true, null, NEXT_SETTING, 0)).toBeNull();
    expect(celestialPosition(false, NEXT_RISING, null, 0)).toBeNull();
  });
});

describe('weather marks', () => {
  it('draws more clouds for more cover', () => {
    expect([null, 0, 19, 20, 49, 50, 79, 80, 100].map(cloudCount)).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('turns the roof station km/h into whole m/s', () => {
    expect(windMs(5.04)).toBe(1);
    expect(windMs(21.6)).toBe(6);
    expect(windMs(null)).toBeNull();
  });

  it('points the arrow where the wind blows to', () => {
    expect(windArrowDeg(45)).toBe(225);
    expect(windArrowDeg(208)).toBe(28);
    expect(windArrowDeg(-90)).toBe(90);
  });
});
