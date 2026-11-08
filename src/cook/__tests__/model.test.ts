import { describe, expect, it } from 'vitest';
import { isCookActive, isProbeLost, parseCookLive, parseCookLog, parseCookState, parseCookTenths } from '../model';

const at = '2026-11-08T18:00:00+01:00';

describe('cook string contract', () => {
  it('rejects missing, unavailable and invalid states', () => {
    expect(parseCookState(undefined)).toBeNull();
    for (const state of ['unknown', 'unavailable', 'cooking']) expect(parseCookState({ state, attributes: {} })).toBeNull();
  });

  it('reads both independent lanes, decimal strings, ISO local times, and exact flags', () => {
    const state = parseCookState({
      state: 'both',
      attributes: {
        v: '1',
        next_kind: 'pull',
        next_at: at,
        next_label: 'Pull ≈ 18:00',
        bath_phase: 'cooking',
        bath_temp: '57.8',
        bath_target: '58',
        bath_ready_at: at,
        bath_in_at: at,
        bath_minutes: '150',
        bath_done_at: at,
        bath_chill_until: at,
        bath_low_water: '1',
        bath_stopped_at: at,
        bath_last_target: '59',
        bath_last_minutes: '120',
        bath_rate: '1.2',
        probe_phase: 'resting',
        probe_preset: 'duck',
        probe_serve: '54',
        probe_pull: '51',
        probe_core: '0',
        probe_ambient: '172.5',
        probe_needle: '0,102,,bad',
        probe_core_index: '0',
        probe_in_meat: '1',
        probe_eta: at,
        probe_slope: '0.7',
        probe_pulled_at: at,
        probe_pulled_core: '51.2',
        probe_peak: '53.4',
        probe_carve_at: at,
        probe_stale_since: at,
        presets: [{ key: 'duck', serve: '54', pull: '51', rest: '10' }],
      },
    });
    expect(state).toMatchObject({ mode: 'both', nextKind: 'pull', nextAtMs: Date.parse(at), nextLabel: 'Pull ≈ 18:00' });
    expect(state?.bath).toEqual({
      phase: 'cooking',
      temp: 57.8,
      target: 58,
      readyAtMs: Date.parse(at),
      inAtMs: Date.parse(at),
      minutes: 150,
      doneAtMs: Date.parse(at),
      chillUntilMs: Date.parse(at),
      lowWater: true,
      stoppedAtMs: Date.parse(at),
      lastTarget: 59,
      lastMinutes: 120,
      rate: 1.2,
    });
    expect(state?.probe).toEqual({
      phase: 'resting',
      preset: 'duck',
      serve: 54,
      pull: 51,
      core: 0,
      ambient: 172.5,
      needle: [0, 10.2, null, null],
      coreIndex: 0,
      inMeat: true,
      etaMs: Date.parse(at),
      slope: 0.7,
      pulledAtMs: Date.parse(at),
      pulledCore: 51.2,
      peak: 53.4,
      carveAtMs: Date.parse(at),
      staleSinceMs: Date.parse(at),
    });
    expect(state?.presets).toEqual([{ key: 'duck', serve: 54, pull: 51, rest: 10 }]);
  });

  it('keeps unknown values unknown and rejects malformed indexes and presets', () => {
    const state = parseCookState({
      state: 'off',
      attributes: {
        bath_temp: '',
        bath_target: 'NaN',
        bath_ready_at: '18:00',
        bath_low_water: '0',
        probe_in_meat: 'false',
        probe_core_index: '4',
        probe_needle: '120',
        presets: [{ key: 'beef', serve: '54', pull: 'oops', rest: '15' }],
      },
    });
    expect(state?.bath).toMatchObject({ phase: 'off', temp: null, target: null, readyAtMs: null, lowWater: false });
    expect(state?.probe).toMatchObject({ phase: 'off', coreIndex: null, inMeat: false, needle: [12, null, null, null] });
    expect(state?.presets).toEqual([]);
    expect(isCookActive(state)).toBe(false);
    expect(isCookActive(parseCookState({ state: 'off', attributes: { bath_low_water: '1' } }))).toBe(true);
  });

  it('keeps CSV gaps in place, including the first and last samples', () => {
    expect(parseCookTenths(',0,511,,bad,')).toEqual([null, 0, 51.1, null, null, null]);
    expect(parseCookTenths('')).toEqual([]);
    expect(
      parseCookLive({
        state: '6',
        attributes: { t0: at, step: '30', bath: '580,,581', core: ',0,511,,bad,', ambient: '1700', pull_mark: '0' },
      })
    ).toEqual({
      sampleCount: 6,
      t0Ms: Date.parse(at),
      stepS: 30,
      bath: [58, null, 58.1],
      core: [null, 0, 51.1, null, null, null],
      ambient: [170],
      pullMark: 0,
    });
    expect(parseCookLive({ state: '0', attributes: { step: '0', pull_mark: '0' } })).toMatchObject({
      sampleCount: 0,
      stepS: 30,
      pullMark: null,
    });
    expect(parseCookLive({ state: 'NaN', attributes: {} })).toBeNull();
  });

  it('retains string summary fields without guessing their schema and caps the ledger at 20', () => {
    const record = { kind: 'probe', start: at, end: at, peak: '54.0', zero: '0', nested: { bad: 'x' } };
    const log = parseCookLog({ state: '22', attributes: { cooks: [null, { kind: 'recipe' }, ...Array(22).fill(record)] } });
    expect(log?.cooks).toHaveLength(20);
    expect(log?.cooks[0]).toEqual({
      kind: 'probe',
      startAtMs: Date.parse(at),
      endAtMs: Date.parse(at),
      summary: { kind: 'probe', start: at, end: at, peak: '54.0', zero: '0' },
    });
  });

  it('flags a lost reading only at 90 seconds in the tracking phases', () => {
    const state = parseCookState({ state: 'probe', attributes: { probe_phase: 'tracking', probe_stale_since: at } });
    expect(isProbeLost(state, Date.parse(at) + 89_999)).toBe(false);
    expect(isProbeLost(state, Date.parse(at) + 90_000)).toBe(true);
    if (state) state.probe.phase = 'resting';
    expect(isProbeLost(state, Date.parse(at) + 600_000)).toBe(false);
  });
});
