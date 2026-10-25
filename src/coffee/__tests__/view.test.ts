import { describe, expect, it } from 'vitest';
import { maintenanceWord, pausedForWater, startFailure, waterCups, waterLine, waterShort, wantsConnect } from '../view';

const row = (id: string, detail: string | null, atMs: number | null, title = 'xBloom brewer rinse') => ({ id, title, detail, atMs });

describe('the Kitchen card footer', () => {
  it('names the next coffee maintenance by the brews left', () => {
    expect(
      maintenanceWord([
        row('maint:coffee:tank', 'empty, rinse, air-dry, 20 brews left, ~28.11', Date.parse('2026-11-28T08:00:00Z')),
        row('maint:coffee:rinse', 'dripper + shower screen, 10 brews left, ~08.11', Date.parse('2026-11-08T08:00:00Z')),
        row('maint:washer:drum', 'Bomuld 90, 2 runs left', Date.parse('2026-10-21T08:00:00Z')),
      ])
    ).toBe('Brew head in 10');
  });

  it('says due for an untimed row, and nothing without coffee rows', () => {
    expect(maintenanceWord([row('maint:coffee:tank', 'empty, rinse, air-dry, due', null)])).toBe('Tank due');
    expect(maintenanceWord([row('maint:washer:drum', 'Bomuld 90, 2 runs left', null)])).toBeNull();
  });
});

describe('opening the stage or the card', () => {
  it('connects to an awake machine without a link, and wakes a sleeping one', () => {
    expect(wantsConnect({ machine: 'awake', link: 'not_connected' })).toBe(true);
    expect(wantsConnect({ machine: 'working', link: 'connecting' })).toBe(true);
    expect(wantsConnect({ machine: 'awake', link: 'connected' })).toBe(false);
    expect(wantsConnect({ machine: 'asleep', link: 'not_connected' })).toBe(true);
    expect(wantsConnect({ machine: 'asleep', link: 'connected' })).toBe(true);
    expect(wantsConnect({ machine: 'off', link: 'not_connected' })).toBe(false);
    expect(wantsConnect({ machine: null, link: 'not_connected' })).toBe(false);
  });
});

describe('a refused start', () => {
  it('gives the machine its reason, and says when the xBloom app has it', () => {
    expect(startFailure({ phase: 'start_failed', startError: 'no_water', machine: 'awake' })?.label).toBe("Didn't start · No water");
    expect(startFailure({ phase: 'start_failed', startError: 'machine_busy', machine: 'awake' })?.label).toBe('Held by the xBloom app');
    expect(startFailure({ phase: 'start_failed', startError: 'machine_not_found', machine: 'asleep' })?.label).toBe(
      "Didn't start · Machine not found"
    );
    expect(startFailure({ phase: 'idle', startError: null, machine: 'awake' })).toBeNull();
  });
});

describe('the water tank', () => {
  const usual = { totalMl: 255 };

  it('is short when what is left cannot finish the cup and its 60 ml of bypass and margin', () => {
    expect(waterShort({ tankLeftMl: 150 }, usual)).toEqual({ leftMl: 150, needMl: 315 });
    expect(waterShort({ tankLeftMl: 314 }, usual)).toEqual({ leftMl: 314, needMl: 315 });
    expect(waterShort({ tankLeftMl: 315 }, usual)).toBeNull();
    expect(waterShort({ tankLeftMl: 946 }, usual)).toBeNull();
    expect(waterShort({ tankLeftMl: 0 }, { totalMl: 180 })).toEqual({ leftMl: 0, needMl: 240 });
  });

  it('judges each recipe by its own volume', () => {
    expect(waterShort({ tankLeftMl: 300 }, { totalMl: 225 })).toBeNull();
    expect(waterShort({ tankLeftMl: 300 }, { totalMl: 272 })).toEqual({ leftMl: 300, needMl: 332 });
  });

  it('is never short while the level or the recipe is unknown', () => {
    expect(waterShort({ tankLeftMl: null }, usual)).toBeNull();
    expect(waterShort({ tankLeftMl: 10 }, { totalMl: null })).toBeNull();
    expect(waterShort({ tankLeftMl: 10 }, null)).toBeNull();
    expect(waterShort(null, usual)).toBeNull();
  });

  it('counts the whole cups of the usual that are left', () => {
    expect(waterCups({ tankLeftMl: 946 }, usual)).toBe(3);
    expect(waterCups({ tankLeftMl: 640 }, usual)).toBe(2);
    expect(waterCups({ tankLeftMl: 315 }, usual)).toBe(1);
    expect(waterCups({ tankLeftMl: 314 }, usual)).toBe(0);
    expect(waterCups({ tankLeftMl: null }, usual)).toBeNull();
    expect(waterCups({ tankLeftMl: 640 }, null)).toBeNull();
  });

  it('says it on the idle line, low once the usual no longer fits', () => {
    expect(waterLine({ tankLeftMl: 640 }, usual)).toEqual({ text: '≈ 2 cups', low: false });
    expect(waterLine({ tankLeftMl: 340 }, usual)).toEqual({ text: '≈ 1 cup', low: false });
    expect(waterLine({ tankLeftMl: 150 }, usual)).toEqual({ text: 'under a cup', low: true });
    expect(waterLine({ tankLeftMl: 0 }, usual)).toEqual({ text: 'under a cup', low: true });
    expect(waterLine({ tankLeftMl: null }, usual)).toEqual({ text: 'unknown', low: false });
    expect(waterLine({ tankLeftMl: 640 }, null)).toEqual({ text: '≈ 640 ml', low: false });
  });
});

describe('a brew waiting for water', () => {
  it('is a pause on the no-water fault, and nothing else', () => {
    expect(pausedForWater({ phase: 'paused', fault: 'no_water' })).toBe(true);
    expect(pausedForWater({ phase: 'paused', fault: null })).toBe(false);
    expect(pausedForWater({ phase: 'paused', fault: 'no_beans' })).toBe(false);
    expect(pausedForWater({ phase: 'brewing', fault: 'no_water' })).toBe(false);
    expect(pausedForWater({ phase: 'idle', fault: 'no_water' })).toBe(false);
  });
});
