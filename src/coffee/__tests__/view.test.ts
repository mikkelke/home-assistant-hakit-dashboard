import { describe, expect, it } from 'vitest';
import { maintenanceWord, startFailure } from '../view';

const row = (id: string, detail: string | null, atMs: number | null, title = 'xBloom brewer rinse') => ({ id, title, detail, atMs });

describe('the Kitchen card footer', () => {
  it('names the next coffee maintenance by the brews left', () => {
    expect(
      maintenanceWord([
        row('maint:coffee:tank', 'empty, rinse, air-dry, 20 brews left, ~28.11', Date.parse('2026-11-28T08:00:00Z')),
        row('maint:coffee:rinse', 'dripper + shower screen, 10 brews left, ~08.11', Date.parse('2026-11-08T08:00:00Z')),
        row('maint:washer:drum', 'Bomuld 90, 2 runs left', Date.parse('2026-10-21T08:00:00Z')),
      ])
    ).toBe('Rinse in 10');
  });

  it('says due for an untimed row, and nothing without coffee rows', () => {
    expect(maintenanceWord([row('maint:coffee:tank', 'empty, rinse, air-dry, due', null)])).toBe('Tank due');
    expect(maintenanceWord([row('maint:washer:drum', 'Bomuld 90, 2 runs left', null)])).toBeNull();
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
