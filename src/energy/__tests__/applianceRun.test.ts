import { describe, expect, it } from 'vitest';
import { parseEta, readApplianceRun } from '../applianceRun';
import { home, HOUR_MS } from './testUtils';

describe('parseEta', () => {
  it('reads the washer HH:MM as Copenhagen time nearest to now', () => {
    expect(parseEta('21:40', 'hhmm', home(2026, 10, 9, 21))).toBe(home(2026, 10, 9, 21, 40));
    expect(parseEta('00:10', 'hhmm', home(2026, 10, 9, 23, 50))).toBe(home(2026, 10, 10, 0, 10));
    expect(parseEta('23:50', 'hhmm', home(2026, 10, 10, 0, 10))).toBe(home(2026, 10, 9, 23, 50));
  });

  it('takes the future occurrence of a time the autumn fall-back repeats, else gives up', () => {
    const first = (h: number, m: number) => home(2026, 10, 25, h, m);
    expect(parseEta('02:45', 'hhmm', first(1, 50))).toBeNull();
    const second = (h: number, m: number) => home(2026, 10, 25, h, m) + HOUR_MS;
    expect(parseEta('02:45', 'hhmm', second(2, 30))).toBe(second(2, 45));
    expect(parseEta('02:45', 'hhmm', first(2, 30))).toBeNull();
    expect(parseEta('02:45', 'hhmm', home(2026, 10, 25, 1, 30))).toBeNull();
    expect(parseEta('02:45', 'hhmm', home(2026, 10, 25, 3, 30))).toBe(second(2, 45));
  });

  it('reads dryer and dishwasher UTC ISO timestamps', () => {
    expect(parseEta('2026-10-09T19:40:00Z', 'iso', 0)).toBe(home(2026, 10, 9, 21, 40));
  });

  it('rejects empty or mismatched values', () => {
    for (const [value, format] of [
      ['', 'hhmm'],
      ['', 'iso'],
      ['25:00', 'hhmm'],
      ['21:40', 'iso'],
      ['2026-10-09T19:40:00Z', 'hhmm'],
      [null, 'iso'],
    ] as const) {
      expect(parseEta(value, format, home(2026, 10, 9, 21))).toBeNull();
    }
  });
});

describe('readApplianceRun', () => {
  it('reads running, paused and idle', () => {
    const nowMs = home(2026, 10, 9, 21);
    expect(readApplianceRun({ state: 'Running', attributes: { estimated_end_time: '21:40' } }, 'hhmm', nowMs)).toEqual({
      status: 'running',
      etaMs: home(2026, 10, 9, 21, 40),
    });
    expect(readApplianceRun({ state: 'Paused', attributes: { estimated_end_time: '21:40' } }, 'hhmm', nowMs)).toEqual({
      status: 'paused',
      etaMs: null,
    });
    expect(readApplianceRun({ state: 'Unemptied', attributes: {} }, 'hhmm', nowMs)).toEqual({ status: 'idle', etaMs: null });
  });
});
