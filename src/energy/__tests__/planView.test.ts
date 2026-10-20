import { describe, expect, it } from 'vitest';
import { formatHomeClock } from '../homeTime';
import {
  cheapestAhead,
  dailyOutlook,
  durationLabel,
  knobLabel,
  krValue,
  peakHoursFromTariffs,
  peakWindows,
  pressChips,
  programmeLabel,
  programmeLabelInferred,
  relativeDayWord,
  weekdayShort,
} from '../planView';
import { rankBands } from '../priceBands';
import { home, hourly, HOUR_MS } from './testUtils';

const radius = {
  additional_tariffs: { elafgift: 0.01 },
  tariffs: Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), h < 6 ? 0.133 : h >= 17 && h < 21 ? 1.194 : 0.398])),
};

describe('peak tariff', () => {
  it('finds the hours charged the highest tariff', () => {
    expect(peakHoursFromTariffs(radius)).toEqual([17, 18, 19, 20]);
  });

  it('rejects a missing, partial or flat table', () => {
    expect(peakHoursFromTariffs(undefined)).toBeNull();
    expect(peakHoursFromTariffs({ tariffs: { '0': 1 } })).toBeNull();
    expect(peakHoursFromTariffs({ tariffs: Object.fromEntries(Array.from({ length: 24 }, (_, h) => [String(h), 0.4])) })).toBeNull();
    expect(peakHoursFromTariffs({ tariffs: { ...radius.tariffs, '3': 'x' } })).toBeNull();
  });

  it('places peak windows on home-time hours, also across the autumn change', () => {
    const day = home(2026, 10, 13);
    expect(peakWindows(day, day + 24 * HOUR_MS, [17, 18, 19, 20])).toEqual([
      { startMs: home(2026, 10, 13, 17), endMs: home(2026, 10, 13, 21) },
    ]);
    const autumn = home(2026, 10, 25);
    expect(peakWindows(autumn, autumn + 25 * HOUR_MS, [17, 18, 19, 20])).toEqual([
      { startMs: Date.parse('2026-10-25T17:00:00+01:00'), endMs: Date.parse('2026-10-25T21:00:00+01:00') },
    ]);
    expect(peakWindows(day, day + 24 * HOUR_MS, null)).toEqual([]);
  });
});

describe('dailyOutlook', () => {
  it('summarises whole home days from the given day and stops at a thin day', () => {
    const start = home(2026, 10, 14);
    const timeline = [
      ...hourly(
        start,
        Array.from({ length: 24 }, (_, h) => 1 + h / 10)
      ),
      ...hourly(
        start + 24 * HOUR_MS,
        Array.from({ length: 24 }, () => 2),
        true
      ),
      ...hourly(
        start + 48 * HOUR_MS,
        Array.from({ length: 6 }, () => 3),
        true
      ),
    ];
    const days = dailyOutlook(timeline, start + 5 * HOUR_MS, 7);
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ dayStartMs: start, minPrice: 1, estimated: false });
    expect(days[0].maxPrice).toBeCloseTo(3.3);
    expect(days[1]).toMatchObject({ dayStartMs: start + 24 * HOUR_MS, meanPrice: 2, estimated: true });
    expect(dailyOutlook(timeline, start, 1)).toHaveLength(1);
  });
});

describe('cheapestAhead', () => {
  it('stops at the end of tomorrow even when the forecast reaches further', () => {
    const today = home(2026, 10, 13);
    const timeline = [
      ...hourly(
        today,
        Array.from({ length: 48 }, (_, h) => 2 + (h % 24) / 10)
      ),
      ...hourly(
        today + 48 * HOUR_MS,
        Array.from({ length: 24 }, () => 0.5),
        true
      ),
    ];
    const block = cheapestAhead(timeline, home(2026, 10, 13, 14, 20));
    expect(block?.startMs).toBe(home(2026, 10, 14));
    expect(block?.estimated).toBe(false);
  });
});

describe('labels', () => {
  it('words knob positions the way the machine shows them', () => {
    expect(knobLabel(30)).toBe('30 min');
    expect(knobLabel(90)).toBe('1,5 h');
    expect(knobLabel(780)).toBe('13 h');
  });

  it('formats durations, numbers and programme names', () => {
    expect(durationLabel(130)).toBe('2 h 10 min');
    expect(durationLabel(120)).toBe('2 h');
    expect(durationLabel(45)).toBe('45 min');
    expect(krValue(1234.567)).toBe('1.234,57');
    expect(programmeLabel({ key: 'typical', label: 'Typical' })).toBe('Usual');
    expect(programmeLabel({ key: 'eco', label: 'ECO' })).toBe('ECO');
  });

  it('marks a programme name nobody confirmed, but not the pooled Usual profile', () => {
    expect(programmeLabelInferred({ key: 'eco', labelConfirmed: false })).toBe(true);
    expect(programmeLabelInferred({ key: 'eco', labelConfirmed: true })).toBe(false);
    expect(programmeLabelInferred({ key: 'typical', labelConfirmed: false })).toBe(false);
  });

  it('names the day of a start in home time', () => {
    const now = home(2026, 10, 13, 14, 20);
    expect(relativeDayWord(home(2026, 10, 13, 15), now)).toBe('today');
    expect(relativeDayWord(home(2026, 10, 13, 22), now)).toBe('tonight');
    expect(relativeDayWord(home(2026, 10, 14, 2), now)).toBe('tonight');
    expect(relativeDayWord(home(2026, 10, 14, 9), now)).toBe('tomorrow');
    expect(relativeDayWord(home(2026, 10, 15, 9), now)).toBe('Thu');
    expect(weekdayShort(home(2026, 10, 13, 0, 30))).toBe('Tue');
    expect(formatHomeClock(home(2026, 10, 13, 7, 5))).toBe('07:05');
  });

  it('builds press instructions only when they matter', () => {
    const clock = formatHomeClock;
    const base = { knobMin: 0, pressFromMs: home(2026, 10, 13, 20, 5), pressUntilMs: home(2026, 10, 13, 20, 30), showPressBy: false };
    expect(pressChips({ ...base, kind: 'now', startMs: base.pressFromMs }, clock)).toEqual({ start: null, knob: null, press: null });
    expect(pressChips({ ...base, kind: 'now', startMs: base.pressFromMs, showPressBy: true }, clock).press).toBe('press by 20:30');
    expect(pressChips({ ...base, kind: 'knob', knobMin: 360, startMs: home(2026, 10, 14, 2, 5) }, clock)).toEqual({
      start: 'start 02:05',
      knob: 'set knob 6 h',
      press: null,
    });
    expect(pressChips({ ...base, kind: 'knob', knobMin: 1440, startMs: base.pressFromMs + 24 * HOUR_MS }, clock).start).toBe(
      'start tomorrow 20:05'
    );
    expect(pressChips({ ...base, kind: 'knob', knobMin: 1440, startMs: base.pressFromMs + 48 * HOUR_MS }, clock).start).toBe(
      'start Thu 20:05'
    );
    expect(pressChips({ ...base, kind: 'wait', startMs: base.pressFromMs, showPressBy: true }, clock).press).toBe('press 20:05–20:30');
    expect(pressChips({ ...base, kind: 'wait', startMs: base.pressFromMs }, clock).press).toBe('press from 20:05');
  });
});

describe('rankBands', () => {
  it('ranks values into quarters and leaves missing ones unknown', () => {
    expect(rankBands([4, 1, null, 3, 2])).toEqual(['expensive', 'cheap', 'unknown', 'pricey', 'normal']);
    expect(rankBands([2, 2, 2])).toEqual(['normal', 'normal', 'normal']);
    expect(rankBands([1, 1, 5, 5])).toEqual(['cheap', 'cheap', 'pricey', 'pricey']);
    expect(rankBands([])).toEqual([]);
  });
});
