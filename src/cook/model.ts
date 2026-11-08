import { fields, numberOf, oneOf, text, timeOf, usable, type Attributes, type CoffeeEntity } from '../coffee/state';

export type CookEntity = CoffeeEntity;
export const BATH_PHASES = ['off', 'heating', 'too_hot', 'ready', 'cooking', 'done', 'chilling', 'chilled', 'interrupted'] as const;
export type BathPhase = (typeof BATH_PHASES)[number];
export const PROBE_PHASES = ['off', 'tracking', 'near', 'pull', 'resting', 'carve'] as const;
export type ProbePhase = (typeof PROBE_PHASES)[number];
export const NEXT_KINDS = ['bath_ready', 'bag_in', 'bath_done', 'chill_done', 'pull', 'carve', 'low_water', 'lost'] as const;
export type CookMomentKind = (typeof NEXT_KINDS)[number];
export type PresetKey = 'beef' | 'lamb' | 'pork' | 'chicken' | 'duck' | 'fish' | 'custom';

export interface CookPreset {
  key: PresetKey;
  serve: number;
  pull: number;
  rest: number;
}

export const COOK_PRESETS: readonly CookPreset[] = [
  { key: 'beef', serve: 54, pull: 50, rest: 15 },
  { key: 'lamb', serve: 58, pull: 54, rest: 15 },
  { key: 'pork', serve: 63, pull: 60, rest: 15 },
  { key: 'chicken', serve: 66, pull: 64, rest: 10 },
  { key: 'duck', serve: 54, pull: 51, rest: 10 },
  { key: 'fish', serve: 50, pull: 48, rest: 5 },
];

export interface CookBath {
  phase: BathPhase;
  temp: number | null;
  target: number | null;
  readyAtMs: number | null;
  inAtMs: number | null;
  minutes: number | null;
  doneAtMs: number | null;
  chillUntilMs: number | null;
  lowWater: boolean;
  stoppedAtMs: number | null;
  lastTarget: number | null;
  lastMinutes: number | null;
  rate: number | null;
}

export interface CookProbe {
  phase: ProbePhase;
  preset: PresetKey | null;
  serve: number | null;
  pull: number | null;
  core: number | null;
  ambient: number | null;
  needle: (number | null)[];
  coreIndex: number | null;
  inMeat: boolean;
  etaMs: number | null;
  slope: number | null;
  pulledAtMs: number | null;
  pulledCore: number | null;
  peak: number | null;
  carveAtMs: number | null;
  staleSinceMs: number | null;
}

export interface CookState {
  mode: 'off' | 'bath' | 'probe' | 'both';
  nextKind: CookMomentKind | null;
  nextAtMs: number | null;
  nextLabel: string | null;
  bath: CookBath;
  probe: CookProbe;
  presets: CookPreset[];
}

export function parseCookTenths(value: unknown): (number | null)[] {
  return fields(value, ',').map(field => {
    const value = numberOf(field);
    return value == null ? null : value / 10;
  });
}

const presetKeys = [...COOK_PRESETS.map(preset => preset.key), 'custom'] as const;

function parsePreset(raw: unknown): CookPreset | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Attributes;
  const key = oneOf(a.key, presetKeys);
  const serve = numberOf(a.serve);
  const pull = numberOf(a.pull);
  const rest = numberOf(a.rest);
  return key && serve != null && pull != null && rest != null ? { key, serve, pull, rest } : null;
}

export function parseCookState(entity: CookEntity): CookState | null {
  if (!usable(entity)) return null;
  const mode = oneOf(entity.state, ['off', 'bath', 'probe', 'both'] as const);
  if (!mode) return null;
  const a = entity.attributes ?? {};
  const needle = parseCookTenths(a.probe_needle).slice(0, 4);
  while (needle.length < 4) needle.push(null);
  const coreIndex = numberOf(a.probe_core_index);
  return {
    mode,
    nextKind: oneOf(a.next_kind, NEXT_KINDS),
    nextAtMs: timeOf(a.next_at),
    nextLabel: text(a.next_label),
    bath: {
      phase: oneOf(a.bath_phase, BATH_PHASES) ?? 'off',
      temp: numberOf(a.bath_temp),
      target: numberOf(a.bath_target),
      readyAtMs: timeOf(a.bath_ready_at),
      inAtMs: timeOf(a.bath_in_at),
      minutes: numberOf(a.bath_minutes),
      doneAtMs: timeOf(a.bath_done_at),
      chillUntilMs: timeOf(a.bath_chill_until),
      lowWater: a.bath_low_water === '1',
      stoppedAtMs: timeOf(a.bath_stopped_at),
      lastTarget: numberOf(a.bath_last_target),
      lastMinutes: numberOf(a.bath_last_minutes),
      rate: numberOf(a.bath_rate),
    },
    probe: {
      phase: oneOf(a.probe_phase, PROBE_PHASES) ?? 'off',
      preset: oneOf(a.probe_preset, presetKeys),
      serve: numberOf(a.probe_serve),
      pull: numberOf(a.probe_pull),
      core: numberOf(a.probe_core),
      ambient: numberOf(a.probe_ambient),
      needle,
      coreIndex: coreIndex != null && Number.isInteger(coreIndex) && coreIndex >= 0 && coreIndex < 4 ? coreIndex : null,
      inMeat: a.probe_in_meat === '1',
      etaMs: timeOf(a.probe_eta),
      slope: numberOf(a.probe_slope),
      pulledAtMs: timeOf(a.probe_pulled_at),
      pulledCore: numberOf(a.probe_pulled_core),
      peak: numberOf(a.probe_peak),
      carveAtMs: timeOf(a.probe_carve_at),
      staleSinceMs: timeOf(a.probe_stale_since),
    },
    presets: Array.isArray(a.presets)
      ? a.presets.flatMap(raw => {
          const preset = parsePreset(raw);
          return preset ? [preset] : [];
        })
      : [],
  };
}

export interface CookLive {
  sampleCount: number;
  t0Ms: number | null;
  stepS: number;
  bath: (number | null)[];
  core: (number | null)[];
  ambient: (number | null)[];
  pullMark: number | null;
}

export function parseCookLive(entity: CookEntity): CookLive | null {
  if (!usable(entity)) return null;
  const sampleCount = numberOf(entity.state);
  if (sampleCount == null || !Number.isInteger(sampleCount) || sampleCount < 0) return null;
  const a = entity.attributes ?? {};
  const step = numberOf(a.step);
  const pullMark = numberOf(a.pull_mark);
  return {
    sampleCount,
    t0Ms: timeOf(a.t0),
    stepS: step != null && step > 0 ? step : 30,
    bath: parseCookTenths(a.bath),
    core: parseCookTenths(a.core),
    ambient: parseCookTenths(a.ambient),
    pullMark: pullMark != null && Number.isInteger(pullMark) && pullMark >= 0 && pullMark < sampleCount ? pullMark : null,
  };
}

export interface CookRecord {
  kind: 'bath' | 'probe';
  startAtMs: number | null;
  endAtMs: number | null;
  summary: Readonly<Record<string, string>>;
}

export interface CookLog {
  cooks: CookRecord[];
}

export function parseCookLog(entity: CookEntity): CookLog | null {
  if (!usable(entity)) return null;
  const raw = entity.attributes?.cooks;
  return {
    cooks: Array.isArray(raw)
      ? raw
          .flatMap(item => {
            if (typeof item !== 'object' || item === null) return [];
            const a = item as Attributes;
            const kind = oneOf(a.kind, ['bath', 'probe'] as const);
            if (!kind) return [];
            const summary = Object.fromEntries(
              Object.entries(a).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            );
            return [{ kind, startAtMs: timeOf(a.start), endAtMs: timeOf(a.end), summary }];
          })
          .slice(0, 20)
      : [],
  };
}

export const isCookActive = (state: CookState | null | undefined): boolean =>
  state != null && (state.bath.phase !== 'off' || state.probe.phase !== 'off' || state.bath.lowWater);

export const isProbeLost = (state: CookState | null | undefined, nowMs: number): boolean =>
  state != null &&
  ['tracking', 'near', 'pull'].includes(state.probe.phase) &&
  state.probe.staleSinceMs != null &&
  nowMs - state.probe.staleSinceMs >= 90_000;
