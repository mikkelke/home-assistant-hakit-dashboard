import { describe, expect, it } from 'vitest';
import { countdownLabel, doneAtDisplay, readCycle, startedTime } from '../applianceFormat';

// The suite runs in America/Los_Angeles (vitest.config.ts): UTC-8 on 8 Nov 2026.

describe('startedTime', () => {
  it('takes started_at_display as it is when it is a clock time', () => {
    expect(startedTime({ started_at_display: '11:05' })).toBe('11:05');
    expect(startedTime({ started_at_display: '11:05:42' })).toBe('11:05');
  });

  it('reads started_at_display as a timestamp when it is one', () => {
    expect(startedTime({ started_at_display: '2026-11-08T12:00:00+01:00' })).toBe('03:00');
  });

  it('falls back to the start timestamp, the house-time copy first', () => {
    const utc = '2026-11-08T10:00:00Z';
    const local = '2026-11-08T12:30:00+01:00';
    expect(startedTime({ cycle_start_time: utc, cycle_start_time_local: local })).toBe('03:30');
    expect(startedTime({ cycle_start_time: utc })).toBe('02:00');
    expect(startedTime({ started_at_display: '  ', cycle_start_time_local: local })).toBe('03:30');
  });

  it('ignores a started_at_display it cannot read', () => {
    expect(startedTime({ started_at_display: 'soon', cycle_start_time: '2026-11-08T10:00:00Z' })).toBe('02:00');
  });

  it('is --:-- with nothing to go on', () => {
    expect(startedTime({})).toBe('--:--');
    expect(startedTime({ started_at_display: '', cycle_start_time: '' })).toBe('--:--');
  });
});

describe('doneAtDisplay', () => {
  it('is when the sensor entered its finished state, less the detection lag', () => {
    expect(doneAtDisplay('2026-11-08T10:30:00+00:00')).toBe('02:30');
    expect(doneAtDisplay('2026-11-08T10:30:00+00:00', 4)).toBe('02:26');
  });

  it('is null when that moment is unknown', () => {
    expect(doneAtDisplay(undefined)).toBeNull();
    expect(doneAtDisplay('soon')).toBeNull();
  });
});

describe('countdownLabel', () => {
  it('counts down, then says almost done', () => {
    expect(countdownLabel(87)).toBe('1h 27m left');
    expect(countdownLabel(12)).toBe('12 min left');
    expect(countdownLabel(0)).toBe('Almost done');
    expect(countdownLabel(-3)).toBe('Almost done');
  });

  it('is null while the time left is unknown', () => {
    expect(countdownLabel(undefined)).toBeNull();
  });
});

describe('readCycle', () => {
  it('takes progress from the percentage when the monitor gives one, kept within 0 to 100', () => {
    expect(readCycle({ progress_pct: 56, programme_duration_min: 199 }, true).progressPct).toBe(56);
    expect(readCycle({ progress_pct: '140' }, true).progressPct).toBe(100);
    expect(readCycle({ progress_pct: -5 }, true).progressPct).toBe(0);
  });

  it('works it out from the length and the time left otherwise', () => {
    expect(readCycle({ programme_duration_min: 200, estimated_remaining_min: 50 }, true).progressPct).toBe(75);
    expect(readCycle({ programme_duration_min: 200, elapsed_minutes: 20 }, true).progressPct).toBe(10);
  });

  it('is 0 unless the run is going and something says how far it is', () => {
    expect(readCycle({ progress_pct: 56, programme_duration_min: 199 }, false).progressPct).toBe(0);
    expect(readCycle({ programme_label: 'ECO' }, true).progressPct).toBe(0);
    expect(readCycle({ progress_pct: '' }, true).progressPct).toBe(0);
  });

  it('reports what the monitor published about start, end and time left', () => {
    expect(readCycle({}, true)).toMatchObject({
      hasStart: false,
      startedDisplay: '--:--',
      hasStartedDisplay: false,
      estimatedEndTime: undefined,
      remainingMin: undefined,
      totalMin: undefined,
    });
    expect(
      readCycle(
        { cycle_start_time: '2026-11-08T10:00:00Z', estimated_end_time: '12:27', estimated_remaining_min: 87, programme_duration_min: 199 },
        true
      )
    ).toMatchObject({
      hasStart: true,
      startedDisplay: '02:00',
      hasStartedDisplay: true,
      estimatedEndTime: '12:27',
      remainingMin: 87,
      totalMin: 199,
    });
  });
});
