import { describe, expect, it } from 'vitest';
import { formatApplianceEta, parseEta, readApplianceCycle, readApplianceRun } from '../applianceRun';
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

describe('readApplianceCycle and formatApplianceEta', () => {
  const nowMs = home(2026, 10, 9, 21);

  it('reads a running washer with an HH:MM ETA', () => {
    const cycle = readApplianceCycle(
      {
        state: 'Running',
        attributes: {
          progress_pct: 62,
          estimated_end_time: '21:40',
          energy_used: 0.41,
          programme_label: 'Bomuld 40',
          cycle_start_time: '2026-10-09T17:10:00Z',
        },
      },
      'hhmm',
      nowMs
    );
    expect(cycle).toEqual({
      status: 'running',
      progressPct: 62,
      etaMs: home(2026, 10, 9, 21, 40),
      overrun: false,
      energyKwh: 0.41,
      programme: 'Bomuld 40',
      startMs: Date.parse('2026-10-09T17:10:00Z'),
    });
    expect(formatApplianceEta(cycle)).toBe('≈ 21:40');
  });

  it('shows a dishwasher UTC ETA on the house clock', () => {
    const cycle = readApplianceCycle({ state: 'Running', attributes: { estimated_end_time: '2026-10-10T03:10:00Z' } }, 'iso', nowMs);
    expect(cycle.etaMs).toBe(home(2026, 10, 10, 5, 10));
    expect(formatApplianceEta(cycle)).toBe('≈ 05:10');
  });

  it('reads the zeros the monitors drop as 0 while a cycle is on', () => {
    const cycle = readApplianceCycle({ state: 'Running', attributes: { estimated_end_time: '23:15' } }, 'hhmm', nowMs);
    expect(cycle).toMatchObject({ progressPct: 0, energyKwh: 0, programme: null, startMs: null });
    expect(formatApplianceEta(cycle)).toBe('≈ 23:15');
  });

  it('gives no ETA when it is missing or blank', () => {
    for (const attributes of [{}, { estimated_end_time: '' }, { estimated_end_time: null }, { estimated_end_time: '25:61' }]) {
      const cycle = readApplianceCycle({ state: 'Running', attributes }, 'hhmm', nowMs);
      expect(cycle).toMatchObject({ status: 'running', etaMs: null, overrun: false });
      expect(formatApplianceEta(cycle)).toBeNull();
    }
  });

  it('says almost done once a running cycle reaches its ETA', () => {
    const zeroLeft = { state: 'Running', attributes: { estimated_end_time: '21:40', estimated_remaining_min: '0', progress_pct: 100 } };
    expect(formatApplianceEta(readApplianceCycle(zeroLeft, 'hhmm', home(2026, 10, 9, 21, 39)))).toBe('≈ 21:40');
    expect(readApplianceCycle(zeroLeft, 'hhmm', home(2026, 10, 9, 21, 40))).toMatchObject({ overrun: true, progressPct: 100 });
    expect(formatApplianceEta(readApplianceCycle(zeroLeft, 'hhmm', home(2026, 10, 9, 21, 52)))).toBe('Almost done');
    const lateDryer = readApplianceCycle({ state: 'Running', attributes: { estimated_end_time: '2026-10-09T18:55:00Z' } }, 'iso', nowMs);
    expect(formatApplianceEta(lateDryer)).toBe('Almost done');
  });

  it('keeps progress but no ETA while paused', () => {
    const cycle = readApplianceCycle(
      { state: 'Paused', attributes: { progress_pct: 40, estimated_end_time: '21:40', cycle_start_time: '2026-10-09T18:00:00Z' } },
      'hhmm',
      nowMs
    );
    expect(cycle).toMatchObject({
      status: 'paused',
      progressPct: 40,
      etaMs: null,
      overrun: false,
      startMs: Date.parse('2026-10-09T18:00:00Z'),
    });
    expect(formatApplianceEta(cycle)).toBe('Paused');
  });

  it('reports a finished cycle until it is emptied', () => {
    const cycle = readApplianceCycle(
      { state: 'Unemptied', attributes: { energy_used: 0.99, programme_label: ' Bomuld 40 ' } },
      'hhmm',
      nowMs
    );
    expect(cycle).toEqual({
      status: 'ready',
      progressPct: null,
      etaMs: null,
      overrun: false,
      energyKwh: 0.99,
      programme: 'Bomuld 40',
      startMs: null,
    });
    expect(formatApplianceEta(cycle)).toBe('Done');
  });

  it('reads everything else as idle', () => {
    for (const entity of [
      undefined,
      { state: 'Off', attributes: { energy_used: 0.99 } },
      { state: 'Emptied', attributes: {} },
      { state: 'unavailable', attributes: {} },
    ]) {
      const cycle = readApplianceCycle(entity, 'iso', nowMs);
      expect(cycle).toEqual({
        status: 'idle',
        progressPct: null,
        etaMs: null,
        overrun: false,
        energyKwh: null,
        programme: null,
        startMs: null,
      });
      expect(formatApplianceEta(cycle)).toBeNull();
    }
  });

  it('clamps a stray progress value', () => {
    const progress = (value: unknown) =>
      readApplianceCycle({ state: 'Running', attributes: { progress_pct: value } }, 'iso', nowMs).progressPct;
    expect(progress(140)).toBe(100);
    expect(progress('-5')).toBe(0);
    expect(progress('abc')).toBe(0);
    expect(progress('37')).toBe(37);
  });

  it('shows the second 02:45 of the autumn fall-back on the house clock', () => {
    const second = home(2026, 10, 25, 2, 30) + HOUR_MS;
    const cycle = readApplianceCycle({ state: 'Running', attributes: { estimated_end_time: '02:45' } }, 'hhmm', second);
    expect(cycle.etaMs).toBe(home(2026, 10, 25, 2, 45) + HOUR_MS);
    expect(formatApplianceEta(cycle)).toBe('≈ 02:45');
  });
});
