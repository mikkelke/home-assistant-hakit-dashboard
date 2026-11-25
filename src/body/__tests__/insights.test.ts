import { describe, expect, it } from 'vitest';
import { bodyInsights, seasonalPeak, turningPoints, weekdayOffsets, yearLines } from '../insights';
import { DAY_MS, GAP_MS, bodyModel, trend, type Weighing } from '../weighings';

const insightsOf = (weighings: Weighing[]) => bodyInsights(weighings, bodyModel(weighings).weightTrend);

/** One weighing per day at 08:00 local time, from `start`, with kg given by `kgAt(dayIndex)`. */
function daily(start: [number, number, number], days: number, kgAt: (day: number) => number): Weighing[] {
  return Array.from({ length: days }, (_, day) => ({
    ts: new Date(start[0], start[1], start[2] + day, 8).getTime(),
    kg: kgAt(day),
    fatPct: 20,
  }));
}

/** kg that follows straight lines through `[day, kg]` anchors. */
function through(anchors: [number, number][]): (day: number) => number {
  return day => {
    for (let i = 1; i < anchors.length; i++) {
      const [d0, k0] = anchors[i - 1];
      const [d1, k1] = anchors[i];
      if (day <= d1) return k0 + ((k1 - k0) * (day - d0)) / (d1 - d0);
    }
    return anchors[anchors.length - 1][1];
  };
}

describe('turningPoints', () => {
  it('finds the reversals of at least the threshold', () => {
    expect(turningPoints([70, 73, 70.5, 74, 73.5])).toEqual([0, 1, 2, 4]);
  });

  it('keeps a wiggle below the threshold as one leg', () => {
    const wiggle = Array.from({ length: 30 }, (_, i) => 70 + (i % 2 ? 0.8 : 0));
    expect(turningPoints(wiggle)).toEqual([0, 29]);
  });

  it('copes with nothing, one value and a flat series', () => {
    expect(turningPoints([])).toEqual([]);
    expect(turningPoints([70])).toEqual([0]);
    expect(turningPoints([70, 70, 70])).toEqual([0, 2]);
  });
});

describe('legs', () => {
  const path = through([
    [0, 80],
    [60, 84],
    [120, 80.5],
    [200, 86],
    [260, 82],
    [320, 85],
    [380, 79],
  ]);
  const legs = insightsOf(daily([2024, 0, 1], 381, path)).legs;

  it('splits the trend into up and down legs in time order', () => {
    expect(legs.map(leg => leg.direction)).toEqual(['up', 'down', 'up', 'down', 'up', 'down']);
    expect(legs.every(leg => Math.abs(leg.delta) >= 2)).toBe(true);
    expect(legs[legs.length - 1].delta).toBeLessThan(-5);
  });

  it('flags only the biggest move of each direction', () => {
    expect(legs.map(leg => leg.largest)).toEqual([false, false, true, false, false, true]);
  });

  it('reads a wiggle as one steady leg and flags nothing', () => {
    const steady = insightsOf(daily([2025, 0, 1], 120, day => 80 + (day % 2 ? 0.8 : 0))).legs;
    expect(steady).toHaveLength(1);
    expect(steady[0].direction).toBe('steady');
    expect(steady[0].largest).toBe(false);
  });

  it('does not call a lone leg the largest', () => {
    const lone = insightsOf(
      daily(
        [2025, 0, 1],
        100,
        through([
          [0, 80],
          [99, 85],
        ])
      )
    ).legs;
    expect(lone.map(leg => [leg.direction, leg.largest])).toEqual([['up', false]]);
  });
});

describe('since', () => {
  it('names when the trend last stood this low before the current fall', () => {
    const w = daily(
      [2022, 0, 1],
      900,
      through([
        [0, 80],
        [200, 76],
        [300, 82],
        [500, 84],
        [899, 77.5],
      ])
    );
    const since = insightsOf(w).since;
    expect(since?.direction).toBe('down');
    const date = new Date(since?.ts ?? 0);
    expect([date.getFullYear(), date.getMonth()]).toEqual([2022, 7]);
  });

  it('is a record when the trend was never this low', () => {
    const w = daily(
      [2022, 0, 1],
      700,
      through([
        [0, 82],
        [300, 86],
        [699, 78],
      ])
    );
    expect(insightsOf(w).since).toEqual({ direction: 'down', ts: null });
  });

  it('reads highest on a rise', () => {
    const w = daily(
      [2022, 0, 1],
      700,
      through([
        [0, 80],
        [300, 76],
        [699, 84],
      ])
    );
    expect(insightsOf(w).since).toEqual({ direction: 'up', ts: null });
  });

  it('is absent on a steady leg and when the date is under half a year old', () => {
    expect(insightsOf(daily([2025, 0, 1], 300, day => 80 + (day % 2 ? 0.5 : 0))).since).toBeNull();
    const recent = daily(
      [2025, 0, 1],
      300,
      through([
        [0, 84],
        [100, 78],
        [200, 82],
        [299, 78.5],
      ])
    );
    expect(insightsOf(recent).since).toBeNull();
  });

  it('is absent when the record is younger than half a year', () => {
    expect(
      insightsOf(
        daily(
          [2025, 0, 1],
          100,
          through([
            [0, 85],
            [99, 80],
          ])
        )
      ).since
    ).toBeNull();
  });
});

describe('swing and offset', () => {
  const trend7 = (n: number) => Array.from({ length: n }, (_, i) => ({ ts: i * DAY_MS, value: 70 }));
  const at = (kgs: number[]): Weighing[] => kgs.map((kg, i) => ({ ts: i * DAY_MS, kg, fatPct: 20 }));

  it('is the 80th percentile of the distance from the trend', () => {
    const kgs = [70, ...Array.from({ length: 20 }, (_, i) => 70 + (i % 2 ? -1 : 1) * (i + 1) * 0.1)];
    expect(bodyInsights(at(kgs), trend7(kgs.length)).swing).toBeCloseTo(1.62, 6);
  });

  it('needs twenty weighings', () => {
    expect(bodyInsights(at(Array(19).fill(71)), trend7(19)).swing).toBeNull();
    expect(bodyInsights(at(Array(20).fill(71)), trend7(20)).swing).toBeCloseTo(1, 6);
  });

  it('puts the latest weighing against the trend', () => {
    const w = daily([2025, 0, 1], 30, () => 80);
    w.push({ ts: w[w.length - 1].ts + DAY_MS, kg: 80.6, fatPct: 20 });
    const t = bodyModel(w).weightTrend;
    expect(bodyInsights(w, t).offset).toBeCloseTo(80.6 - t[t.length - 1].value, 9);
    expect(bodyInsights(w, t).offset).toBeGreaterThan(0.4);
  });
});

describe('weekdayOffsets', () => {
  const mondays = (kgAt: (monday: boolean, day: number) => number) =>
    daily([2025, 2, 3], 140, day => kgAt(new Date(2025, 2, 3 + day, 8).getDay() === 1, day));

  it('finds a Monday bump whatever the time zone', () => {
    const offsets = weekdayOffsets(mondays(monday => 75 + (monday ? 0.3 : 0)));
    const monday = offsets.find(o => o.day === 1);
    expect(offsets).toHaveLength(7);
    expect(monday?.offset).toBeGreaterThan(0.2);
    expect(monday?.offset).toBeLessThan(0.35);
    expect(Math.max(...offsets.filter(o => o.day !== 1).map(o => o.offset))).toBeLessThan(0.05);
  });

  it('is not fooled by a slow drift', () => {
    const offsets = weekdayOffsets(mondays((monday, day) => 80 - day * 0.03 + (monday ? 0.3 : 0)));
    expect(offsets.find(o => o.day === 1)?.offset).toBeGreaterThan(0.2);
    expect(Math.abs(offsets.find(o => o.day === 4)?.offset ?? 9)).toBeLessThan(0.1);
  });

  it('lists Monday first and leaves out a weekday with under ten weighings', () => {
    const w = mondays(() => 75).filter(x => new Date(x.ts).getDay() !== 0 || x.ts < new Date(2025, 4, 20).getTime());
    const offsets = weekdayOffsets(w);
    expect(offsets.map(o => o.day)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    const few = weekdayOffsets(mondays(() => 75).filter(x => new Date(x.ts).getDay() !== 0 || x.ts < new Date(2025, 2, 25).getTime()));
    expect(few.map(o => o.day)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('ignores a neighbour across a gap longer than two weeks', () => {
    const lonely: Weighing[] = [
      { ts: new Date(2025, 0, 6, 8).getTime(), kg: 80, fatPct: 20 },
      { ts: new Date(2025, 2, 6, 8).getTime(), kg: 90, fatPct: 20 },
    ];
    expect(weekdayOffsets(lonely)).toEqual([]);
  });
});

describe('yearLines and seasonalPeak', () => {
  /** A weighing every third day from `fromYear` to `toYear`, peaking `peakMonth` (1 to 12) of each year, in kg 80 ± 3. */
  function seasons(fromYear: number, toYear: number, peakMonth: (year: number) => number, until?: Date): Weighing[] {
    const out: Weighing[] = [];
    for (let year = fromYear; year <= toYear; year++) {
      const peak = new Date(year, peakMonth(year) - 1, 1).getTime();
      for (let day = 0; day < 365; day += 3) {
        const ts = new Date(year, 0, 1 + day, 8).getTime();
        if (until && ts > until.getTime()) break;
        out.push({ ts, kg: 80 + 3 * Math.cos(((ts - peak) / (365 * DAY_MS)) * 2 * Math.PI), fatPct: 20 });
      }
    }
    return out;
  }

  it('finds August as the usual peak, with the years that count', () => {
    const w = [
      ...seasons(2018, 2018, () => 8).filter(x => new Date(x.ts).getMonth() >= 6),
      ...seasons(2019, 2023, () => 8),
      ...seasons(2024, 2024, () => 8, new Date(2024, 2, 1)),
    ];
    const lines = yearLines(w);
    expect(lines.map(line => line.year)).toEqual([2018, 2019, 2020, 2021, 2022, 2023, 2024]);
    expect(lines.find(line => line.year === 2018)?.months).toBe(6);
    expect(seasonalPeak(lines, 2024)).toEqual({ month: 8, hits: 5, of: 5 });
    expect(insightsOf(w).seasonal).toEqual({ month: 8, hits: 5, of: 5 });
  });

  it('counts a peak a month away as a hit and gives up when the peaks are spread out', () => {
    const near = yearLines(seasons(2019, 2023, year => (year % 2 ? 8 : 9)));
    expect(seasonalPeak(near, 2030)?.hits).toBe(5);
    const spread = yearLines(seasons(2019, 2023, year => [2, 5, 8, 11, 3][year - 2019]));
    expect(seasonalPeak(spread, 2030)).toBeNull();
  });

  it('needs three full years besides the current one', () => {
    const two = yearLines(seasons(2022, 2024, () => 8));
    expect(seasonalPeak(two, 2024)).toBeNull();
    expect(seasonalPeak(two, 2030)).not.toBeNull();
  });

  it('places each year on its own calendar and cuts the line at a long gap', () => {
    const w: Weighing[] = [...daily([2025, 0, 1], 10, () => 80), ...daily([2025, 6, 1], 10, () => 82)];
    const [line] = yearLines(w);
    expect(line.segments).toHaveLength(2);
    expect(line.segments[0][0].x).toBeCloseTo(0, 2);
    expect(line.segments[1][0].x).toBeGreaterThan(0.49);
    expect(line.segments[1][0].x).toBeLessThan(0.51);
    expect(line.segments[1][0].ts - line.segments[0][line.segments[0].length - 1].ts).toBeGreaterThan(GAP_MS);
    expect(line.months).toBe(2);
    expect(line.peak.value).toBeGreaterThan(80);
  });

  it('builds the lines from the 14-day trend', () => {
    const w = daily([2025, 0, 1], 60, day => (day === 30 ? 90 : 80));
    const [line] = yearLines(w);
    const smooth = trend(
      w.map(x => ({ ts: x.ts, value: x.kg })),
      14 * DAY_MS
    );
    expect(line.peak.value).toBeCloseTo(Math.max(...smooth.map(p => p.value)), 9);
    expect(line.peak.value).toBeLessThan(85);
  });
});

describe('bodyInsights', () => {
  it('never throws with little or no data', () => {
    for (let n = 0; n < 10; n++) {
      const w = daily([2025, 0, 1], n, day => 80 + day * 0.1);
      const insights = insightsOf(w);
      expect(insights.swing).toBeNull();
      expect(insights.weekdays).toEqual([]);
      expect(insights.since).toBeNull();
      expect(insights.seasonal).toBeNull();
      expect(insights.legs.length).toBeLessThanOrEqual(1);
    }
  });

  it('reports the span, the first year and the change over four weeks', () => {
    const w = daily([2025, 0, 1], 120, day => 90 - day * 0.1);
    const insights = insightsOf(w);
    expect(insights.firstYear).toBe(2025);
    expect(insights.spanMs / DAY_MS).toBeCloseTo(119, 0);
    expect(insights.fourWeek).toBeCloseTo(-2.8, 1);
  });
});
