import { COOK_LIVE_ENTITY, COOK_LOG_ENTITY, COOK_STATE_ENTITY } from './entities';
import { COOK_PRESETS, type BathPhase, type ProbePhase } from './model';
import type { CookDemoScenario, CookDemoSnapshot } from './demoStore';

const MINUTE = 60_000;
export function cookDemo(scenario: CookDemoScenario, nowMs = Date.now()): CookDemoSnapshot {
  const iso = (minutes: number) => new Date(nowMs + minutes * MINUTE).toISOString();
  const bathPhases: readonly string[] = ['heating', 'too_hot', 'ready', 'cooking', 'done', 'chilling', 'chilled', 'interrupted'];
  const probePhases: readonly string[] = ['tracking', 'near', 'pull', 'resting', 'carve'];
  const bathPhase: BathPhase = bathPhases.includes(scenario)
    ? (scenario as BathPhase)
    : scenario === 'both' || scenario === 'low_water'
      ? 'cooking'
      : 'off';
  const probePhase: ProbePhase = probePhases.includes(scenario)
    ? (scenario as ProbePhase)
    : scenario === 'both' || scenario === 'lost'
      ? 'tracking'
      : 'off';
  const bathActive = bathPhase !== 'off';
  const bagIn = ['cooking', 'done', 'chilling', 'chilled', 'interrupted'].includes(bathPhase);
  const chilling = bathPhase === 'chilling' || bathPhase === 'chilled';
  const doneMinutes = bathPhase === 'done' ? -1 : bathPhase === 'chilling' ? -6 : bathPhase === 'chilled' ? -16 : 25;
  const probeActive = probePhase !== 'off';
  const resting = probePhase === 'resting' || probePhase === 'carve';
  const lowWater = scenario === 'low_water';
  const lost = scenario === 'lost';
  const core = probePhase === 'pull' ? 50.2 : resting ? 53.8 : probePhase === 'near' ? 48.1 : 42.6;
  const eta = probePhase === 'near' ? 3 : 10;
  let nextKind = '';
  let nextAt = '';
  let nextLabel = '';
  if (bathActive) {
    if (bathPhase === 'heating' || bathPhase === 'too_hot') {
      nextKind = 'bath_ready';
      nextAt = iso(8);
      nextLabel = 'Ready ≈';
    } else if (bathPhase === 'ready') {
      nextKind = 'bag_in';
      nextAt = iso(-1);
      nextLabel = 'Bag in';
    } else if (bathPhase === 'chilling' || bathPhase === 'chilled') {
      nextKind = 'chill_done';
      nextAt = iso(bathPhase === 'chilled' ? -1 : 9);
      nextLabel = 'Fridge';
    } else if (bathPhase === 'interrupted') {
      nextKind = 'bath_done';
      nextAt = iso(-4);
      nextLabel = 'Stopped';
    } else {
      nextKind = 'bath_done';
      nextAt = iso(bathPhase === 'done' ? -1 : 25);
      nextLabel = 'Done';
    }
  }
  if (probeActive) {
    nextKind = resting ? 'carve' : 'pull';
    nextAt = resting ? iso(8) : iso(eta);
    nextLabel = resting ? 'Carve ≈' : 'Pull ≈';
  }
  if (lowWater) {
    nextKind = 'low_water';
    nextAt = '';
    nextLabel = 'Low water';
  }
  if (lost) {
    nextKind = 'lost';
    nextAt = '';
    nextLabel = 'No reading since';
  }
  const attributes = {
    v: '1',
    next_kind: nextKind,
    next_at: nextAt,
    next_label: nextLabel,
    bath_phase: bathPhase,
    bath_temp: bathPhase === 'too_hot' ? '61.4' : bathPhase === 'heating' ? '49.7' : '58.0',
    bath_target: '58',
    bath_ready_at: bathPhase === 'heating' ? iso(8) : bathPhase === 'ready' ? iso(-1) : bagIn ? iso(doneMinutes - 165) : '',
    bath_in_at: bagIn ? iso(doneMinutes - 150) : '',
    bath_minutes: '150',
    bath_done_at: bagIn ? iso(doneMinutes) : '',
    bath_chill_until: chilling ? iso(bathPhase === 'chilled' ? -1 : 9) : '',
    bath_low_water: lowWater ? '1' : '0',
    bath_stopped_at: bathPhase === 'interrupted' || lowWater ? iso(-4) : '',
    bath_last_target: '58',
    bath_last_minutes: '150',
    bath_rate: '1.1',
    probe_phase: probePhase,
    probe_preset: 'beef',
    probe_serve: '54',
    probe_pull: '50',
    probe_core: String(core),
    probe_ambient: resting ? '23.8' : '172.4',
    probe_needle: `${Math.round((core + 1.5) * 10)},${Math.round(core * 10)},${Math.round((core + 0.6) * 10)},${Math.round((core + 3) * 10)}`,
    probe_core_index: '1',
    probe_in_meat: probeActive ? '1' : '0',
    probe_eta: lost ? '' : iso(eta),
    probe_slope: '0.74',
    probe_pulled_at: resting ? iso(-7) : '',
    probe_pulled_core: resting ? '50.2' : '',
    probe_peak: resting ? '54.0' : '',
    probe_carve_at: resting ? iso(8) : '',
    probe_stale_since: lost ? iso(-3) : '',
    presets: COOK_PRESETS.map(preset => ({
      key: preset.key,
      serve: String(preset.serve),
      pull: String(preset.pull),
      rest: String(preset.rest),
    })),
  };
  const count = 81;
  const curve = (fn: (fraction: number) => number) =>
    Array.from({ length: count }, (_, index) => Math.round(fn(index / (count - 1)) * 10)).join(',');
  return {
    entities: {
      [COOK_STATE_ENTITY]: { state: bathActive && probeActive ? 'both' : bathActive ? 'bath' : probeActive ? 'probe' : 'off', attributes },
      [COOK_LIVE_ENTITY]: {
        state: String(count),
        attributes: {
          t0: iso(-40),
          step: '30',
          bath: bathActive ? curve(f => (bathPhase === 'heating' ? 23 + f * 26.7 : 58 + Math.sin(f * 12) * 0.12)) : '',
          core: probeActive ? curve(f => 18 + (core - 18) * f) : '',
          ambient: probeActive ? curve(f => 24 + 148.4 * Math.min(1, f * 5)) : '',
          ...(resting ? { pull_mark: '66' } : {}),
        },
      },
      [COOK_LOG_ENTITY]: {
        state: '1',
        attributes: { cooks: [{ kind: 'probe', start: iso(-180), end: iso(-90), preset: 'beef', peak: '54.0' }] },
      },
    },
  };
}
