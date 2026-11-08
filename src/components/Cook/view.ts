import type { CookState } from '../../cook/model';
import { isProbeLost } from '../../cook/model';
import { nextCookMoment } from '../../cook/moments';
import { formatHomeClock } from '../../energy/homeTime';

export type CookTone = 'heat' | 'sky' | 'act' | 'alarm' | 'ok';
export const degrees = (value: number | null) => (value == null ? '—' : `${value.toFixed(1)}°`);
export const duration = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

export function centred(state: CookState): boolean {
  const { needle, coreIndex } = state.probe;
  if (coreIndex == null || coreIndex <= 0 || coreIndex >= 3) return false;
  const core = needle[coreIndex];
  const before = needle[coreIndex - 1];
  const after = needle[coreIndex + 1];
  return core != null && before != null && after != null && before > core && after > core;
}

export function cookCue(state: CookState, nowMs: number): { label: string; value: string; detail: string; tone: CookTone } {
  const { bath, probe } = state;
  const moment = nextCookMoment(state, nowMs);
  if (bath.lowWater || moment?.kind === 'low_water')
    return {
      label: 'Low water',
      value: 'Top up',
      detail: bath.stoppedAtMs == null ? 'The Anova cannot heat' : `Heater stopped ${formatHomeClock(bath.stoppedAtMs)}`,
      tone: 'alarm',
    };
  if (moment?.kind === 'lost' || isProbeLost(state, nowMs))
    return {
      label: 'Probe lost',
      value: probe.staleSinceMs == null ? 'No reading' : formatHomeClock(probe.staleSinceMs),
      detail: 'No reading since · check the receiver',
      tone: 'alarm',
    };
  if (bath.phase === 'interrupted' && (moment?.kind === 'bath_done' || !moment))
    return {
      label: 'Stopped',
      value: bath.stoppedAtMs == null ? '—' : formatHomeClock(bath.stoppedAtMs),
      detail: 'The bath stopped before the cook finished',
      tone: 'alarm',
    };
  if (bath.phase === 'too_hot' && (moment?.kind === 'bath_ready' || !moment))
    return {
      label: 'Bath too hot',
      value: bath.temp != null && bath.target != null ? `+${(bath.temp - bath.target).toFixed(1)}°` : 'Too hot',
      detail: 'Add cold water · the Anova cannot cool',
      tone: 'act',
    };
  const kind = moment?.kind;
  const label =
    kind === 'pull'
      ? 'Pull'
      : kind === 'carve'
        ? 'Carve'
        : kind === 'bath_ready'
          ? 'Ready'
          : kind === 'bag_in'
            ? 'Bag in'
            : kind === 'bath_done'
              ? 'Done'
              : kind === 'chill_done'
                ? 'Into the fridge'
                : 'Cook';
  const at = moment?.atMs ?? null;
  const act = moment?.urgent ?? false;
  const value = act ? 'Now' : at == null ? '—' : `${moment?.approximate ? '≈ ' : ''}${formatHomeClock(at)}`;
  let detail = at != null && at > nowMs ? `in ${Math.max(1, Math.ceil((at - nowMs) / 60_000))} min` : '';
  if (kind === 'pull')
    detail =
      probe.phase === 'pull'
        ? `Rests to about ${degrees(probe.serve)}`
        : probe.staleSinceMs != null
          ? 'Reading stalled · waiting for the probe'
          : `${degrees(probe.core)} → ${degrees(probe.pull)}`;
  if (kind === 'carve') detail = probe.phase === 'carve' ? `Peaked ${degrees(probe.peak)}` : `Resting · peak ${degrees(probe.peak)}`;
  if (kind === 'bath_done' && bath.phase === 'done')
    return {
      label: 'Done',
      value: bath.doneAtMs == null ? 'Now' : formatHomeClock(bath.doneAtMs),
      detail: `Holding ${degrees(bath.target)}`,
      tone: 'act',
    };
  if (kind === 'bath_ready') detail = `Bath ${degrees(bath.temp)} → ${degrees(bath.target)}`;
  if (kind === 'bag_in') detail = `Bath at ${degrees(bath.temp)}`;
  if (!moment && probe.phase !== 'off')
    return {
      label: 'Pull',
      value: '—',
      detail: probe.staleSinceMs != null ? 'Reading stalled · waiting for the probe' : `${degrees(probe.core)} → ${degrees(probe.pull)}`,
      tone: 'heat',
    };
  if (!moment && bath.phase === 'off')
    return { label: 'Next cook', value: '—', detail: 'Plug in the probe or start the bath', tone: 'sky' };
  return {
    label,
    value,
    detail,
    tone: act || (kind === 'pull' && probe.phase === 'near') ? 'act' : kind === 'carve' ? 'ok' : kind === 'pull' ? 'heat' : 'sky',
  };
}
