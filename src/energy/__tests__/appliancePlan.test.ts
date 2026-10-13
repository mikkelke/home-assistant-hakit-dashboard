import { describe, expect, it } from 'vitest';
import { DRYER_CHAIN, PLAN_APPLIANCES, type DoneByHour } from '../../config/plan';
import { assembleAppliancePlan, parseEta, planLabel, readApplianceRun } from '../appliancePlan';
import type { RunProfileProgramme } from '../runProfiles';
import { fixtureProgramme, fixtureTimeline, home, hourly, HOUR_MS, MINUTE_MS, programme } from './testUtils';

const washer = PLAN_APPLIANCES.find(a => a.key === 'washer')!;
const dishwasher = PLAN_APPLIANCES.find(a => a.key === 'dishwasher')!;

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

  it('resolves done-by from now, so a running cycle can make it impossible', () => {
    const morning = home(2026, 10, 10, 6);
    const run = { status: 'running' as const, etaMs: home(2026, 10, 10, 8) };
    const result = assembleAppliancePlan({ config: washer, run, programmes, timeline, nowMs: morning, doneBy: 7 });
    expect(result.doneByMs).toBe(home(2026, 10, 10, 7));
    expect(result.plan?.doneByMissed).toBe(true);
    expect(result.plan?.plan).toBeNull();
  });

  it('sets no done-by deadline for a programme whose completion is unknown', () => {
    const idle = readApplianceRun(undefined, 'hhmm', nowMs);
    const unknown = { ...programme(Array(60).fill(10), null), key: 'unknown' };
    const result = assembleAppliancePlan({ config: washer, run: idle, programmes: [unknown], timeline, nowMs, doneBy: 7 });
    expect(result.doneByMs).toBeNull();
    expect(result.plan?.doneByMissed).toBe(false);
    expect(result.plan?.plan?.doneMs).toBeNull();
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

describe('washer + dryer', () => {
  const dryerConfig = PLAN_APPLIANCES.find(a => a.key === 'dryer')!;
  const idle = { status: 'idle' as const, etaMs: null };
  // 15:00-17:00 cheap, the 17-21 peak, then middling all night.
  const timeline = hourly(home(2026, 10, 12, 15), [1, 1, 5, 5, 5, 5, ...Array(14).fill(1.5)]);
  const nowMs = home(2026, 10, 12, 15, 30);
  const washerRun = programme(Array(60).fill(10), 60);
  const dryerRun = programme(Array(60).fill(15), 60);
  const plan = (dryer: RunProfileProgramme | null, withDryer: boolean, doneBy: DoneByHour = null) =>
    assembleAppliancePlan({ config: washer, run: idle, programmes: [washerRun], dryer, withDryer, doneBy, timeline, nowMs });

  it('moves the washer start when the dryer would otherwise land in the peak', () => {
    const alone = plan(dryerRun, false);
    expect(alone.plan?.plan?.kind).toBe('now');
    expect(alone.plan?.plan?.costKr).toBeCloseTo(0.6, 9);

    const chained = plan(dryerRun, true);
    expect(chained.plan?.noDelay?.kr).toBeCloseTo(0.6 + 0.3 + 0.6 * 5, 9);
    expect(chained.plan?.plan?.startMs).toBe(home(2026, 10, 12, 21, 30));
    expect(chained.plan?.plan?.costKr).toBeCloseTo(1.5 * 1.5, 9);
    expect(chained.plan?.savingKr).toBeCloseTo(3.9 - 2.25, 9);
  });

  it('finishes when the dryer is done, and knows no finish when either completion is unknown', () => {
    const chained = plan(dryerRun, true, 7);
    expect(chained.priced?.completionMin).toBe(60 + DRYER_CHAIN.gapMin + 60);
    expect(chained.plan?.plan?.doneMs).toBe(chained.plan!.plan!.startMs + 130 * MINUTE_MS);
    expect(chained.doneByMs).toBe(home(2026, 10, 13, 7));

    const unknownDryer = plan(programme(Array(60).fill(15), null), true, 7);
    expect(unknownDryer.priced?.completionMin).toBeNull();
    expect(unknownDryer.doneByMs).toBeNull();
    expect(unknownDryer.plan?.plan?.doneMs).toBeNull();
  });

  it('offers no dryer without its profile', () => {
    const result = plan(null, true);
    expect(result.dryer).toBeNull();
    expect(result.withDryer).toBe(false);
    expect(result.priced).toBe(result.programme);
    expect(planLabel(result)).toBe('Washer');
    expect(planLabel(plan(dryerRun, true))).toBe('Washer + dryer');
  });

  it('never plans the dryer on its own', () => {
    expect(PLAN_APPLIANCES.filter(a => !a.planned).map(a => a.key)).toEqual(['dryer']);
    const result = assembleAppliancePlan({ config: dryerConfig, run: idle, programmes: [dryerRun], timeline, nowMs });
    expect(result.programme).toBe(dryerRun);
    expect(result.plan).toBeNull();
  });
});
