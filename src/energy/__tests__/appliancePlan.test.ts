import { describe, expect, it } from 'vitest';
import { PLAN_APPLIANCES } from '../../config/plan';
import { assembleAppliancePlan, parseEta, readApplianceRun } from '../appliancePlan';
import { fixtureProgramme, fixtureTimeline, home } from './testUtils';

const washer = PLAN_APPLIANCES.find(a => a.key === 'washer')!;
const dishwasher = PLAN_APPLIANCES.find(a => a.key === 'dishwasher')!;

describe('parseEta', () => {
  it('reads the washer HH:MM as Copenhagen time nearest to now', () => {
    expect(parseEta('21:40', 'hhmm', home(2026, 10, 9, 21))).toBe(home(2026, 10, 9, 21, 40));
    expect(parseEta('00:10', 'hhmm', home(2026, 10, 9, 23, 50))).toBe(home(2026, 10, 10, 0, 10));
    expect(parseEta('23:50', 'hhmm', home(2026, 10, 10, 0, 10))).toBe(home(2026, 10, 9, 23, 50));
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

describe('assembleAppliancePlan', () => {
  const timeline = fixtureTimeline('2026-10-09', '2026-10-10');
  const nowMs = home(2026, 10, 9, 19, 10);
  const programmes = [fixtureProgramme('washer')];

  it('plans an idle appliance from now', () => {
    const result = assembleAppliancePlan({ config: washer, run: readApplianceRun(undefined, 'hhmm', nowMs), programmes, timeline, nowMs });
    expect(result.programme?.key).toBe('bomuld|60');
    expect(result.plan?.pressFromMs).toBe(nowMs);
  });

  it('plans the next run of a running appliance from its ETA', () => {
    const run = readApplianceRun({ state: 'Running', attributes: { estimated_end_time: '21:40' } }, 'hhmm', nowMs);
    expect(run).toEqual({ status: 'running', etaMs: home(2026, 10, 9, 21, 40) });
    const result = assembleAppliancePlan({ config: washer, run, programmes, timeline, nowMs, doneBy: 7 });
    expect(result.plan?.pressFromMs).toBe(home(2026, 10, 9, 21, 40));
    expect(result.doneByMs).toBe(home(2026, 10, 10, 7));
  });

  it('gives no next-run advice while paused or when the ETA is unknown', () => {
    const paused = readApplianceRun({ state: 'Paused', attributes: { estimated_end_time: '2026-10-09T19:40:00Z' } }, 'iso', nowMs);
    expect(assembleAppliancePlan({ config: dishwasher, run: paused, programmes, timeline, nowMs }).plan).toBeNull();
    const unknown = readApplianceRun({ state: 'Running', attributes: { estimated_end_time: '' } }, 'iso', nowMs);
    expect(assembleAppliancePlan({ config: dishwasher, run: unknown, programmes, timeline, nowMs }).plan).toBeNull();
  });

  it('gives no plan without a published profile, and honours the selected programme', () => {
    const idle = readApplianceRun({ state: 'Off', attributes: {} }, 'hhmm', nowMs);
    expect(assembleAppliancePlan({ config: washer, run: idle, programmes: [], timeline, nowMs }).plan).toBeNull();
    const two = [...programmes, { ...programmes[0], key: 'other' }];
    expect(
      assembleAppliancePlan({ config: washer, run: idle, programmes: two, programmeKey: 'other', timeline, nowMs }).programme?.key
    ).toBe('other');
    expect(
      assembleAppliancePlan({ config: washer, run: idle, programmes: two, programmeKey: 'gone', timeline, nowMs }).programme?.key
    ).toBe('bomuld|60');
  });
});
