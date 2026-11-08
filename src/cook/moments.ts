import { isCookActive, isProbeLost, type CookLive, type CookMomentKind, type CookState } from './model';

export interface CookMoment {
  kind: CookMomentKind;
  label: string;
  atMs: number | null;
  approximate: boolean;
  urgent: boolean;
  alarm: boolean;
  status: 'done' | 'current' | 'upcoming';
}

function moment(kind: CookMomentKind, label: string, atMs: number | null, approximate = false, urgent = false, alarm = false): CookMoment {
  return { kind, label, atMs, approximate, urgent, alarm, status: 'current' };
}

const predictionAtMs = (atMs: number | null, nowMs: number, stale = false): number | null =>
  stale || (atMs != null && atMs < nowMs) ? null : atMs;

function bathMoment(state: CookState): CookMoment | null {
  const bath = state.bath;
  switch (bath.phase) {
    case 'heating':
      return moment('bath_ready', 'Ready', bath.readyAtMs, true);
    case 'too_hot': {
      const excess = bath.temp != null && bath.target != null ? `+${Math.max(0, bath.temp - bath.target).toFixed(1)}° · ` : '';
      return moment('bath_ready', `${excess}Add cold`, null, false, true);
    }
    case 'ready':
      return moment('bag_in', 'Bag in', bath.readyAtMs, false, true);
    case 'cooking':
      return moment('bath_done', 'Done', bath.doneAtMs);
    case 'done':
      return moment('bath_done', 'Done', bath.doneAtMs, false, true);
    case 'chilling':
      return moment('chill_done', 'Fridge', bath.chillUntilMs);
    case 'chilled':
      return moment('chill_done', 'Into the fridge', bath.chillUntilMs, false, true);
    case 'interrupted':
      return moment('bath_done', 'Stopped', bath.stoppedAtMs, false, true, true);
    default:
      return null;
  }
}

function probeMoment(state: CookState, nowMs: number): CookMoment | null {
  const probe = state.probe;
  switch (probe.phase) {
    case 'tracking':
    case 'near':
      return moment('pull', 'Pull', predictionAtMs(probe.etaMs, nowMs, probe.staleSinceMs != null), true);
    case 'pull':
      return moment('pull', 'Pull now', probe.etaMs, false, true);
    case 'resting':
      return moment('carve', 'Carve', predictionAtMs(probe.carveAtMs, nowMs), true);
    case 'carve':
      return moment('carve', 'Carve now', null, false, true);
    default:
      return null;
  }
}

export function nextCookMoment(state: CookState | null | undefined, nowMs = Date.now()): CookMoment | null {
  if (!state || !isCookActive(state)) return null;
  if (state.bath.lowWater || state.nextKind === 'low_water') return moment('low_water', 'Low water', state.nextAtMs, false, true, true);
  if (state.nextKind === 'lost' || isProbeLost(state, nowMs))
    return moment('lost', 'No reading since', state.probe.staleSinceMs, false, true, true);
  const bath = bathMoment(state);
  const probe = probeMoment(state, nowMs);
  const choices = [bath, probe].filter((item): item is CookMoment => item != null);
  const published = choices.find(item => item.kind === state.nextKind);
  if (published) {
    const stalePrediction =
      published.kind === 'pull' && ['tracking', 'near'].includes(state.probe.phase) && state.probe.staleSinceMs != null;
    const atMs = state.nextAtMs ?? published.atMs;
    return { ...published, atMs: published.approximate ? predictionAtMs(atMs, nowMs, stalePrediction) : atMs };
  }
  const next = choices.sort(
    (a, b) => Number(b.alarm) - Number(a.alarm) || Number(b.urgent) - Number(a.urgent) || (a.atMs ?? Infinity) - (b.atMs ?? Infinity)
  )[0];
  return next ? { ...next, atMs: next.approximate ? predictionAtMs(next.atMs, nowMs) : next.atMs } : null;
}

export function cookMoments(state: CookState | null | undefined, nowMs = Date.now()): CookMoment[] {
  if (!state || !isCookActive(state)) return [];
  const result: CookMoment[] = [];
  const bath = state.bath;
  const probe = state.probe;
  if (bath.phase === 'interrupted') {
    result.push({ ...moment('bath_done', 'Stopped', bath.stoppedAtMs, false, true, true), status: 'current' });
  } else if (bath.phase !== 'off') {
    const phaseIndex = ['heating', 'too_hot', 'ready', 'cooking', 'done', 'chilling', 'chilled', 'interrupted'].indexOf(bath.phase);
    const bagIn = bath.inAtMs != null && bath.inAtMs <= nowMs;
    if (phaseIndex <= 1 && !bagIn) {
      result.push({ ...moment('bath_ready', 'Ready', predictionAtMs(bath.readyAtMs, nowMs), true), status: 'current' });
    } else if (bath.readyAtMs != null && bath.readyAtMs <= nowMs) {
      result.push({ ...moment('bath_ready', 'Ready', bath.readyAtMs), status: 'done' });
    }
    if (bagIn) {
      result.push({ ...moment('bag_in', 'Bag in', bath.inAtMs), status: 'done' });
    } else if (phaseIndex <= 2) {
      result.push({ ...moment('bag_in', 'Bag in', null), status: phaseIndex === 2 ? 'current' : 'upcoming' });
    }
    result.push({
      ...moment('bath_done', 'Done', phaseIndex < 3 ? null : bath.doneAtMs),
      status: phaseIndex < 3 ? 'upcoming' : phaseIndex <= 4 ? 'current' : 'done',
    });
    if (bath.phase === 'chilling' || bath.phase === 'chilled') {
      result.push({ ...moment('chill_done', 'Fridge', bath.chillUntilMs), status: 'current' });
    }
  }
  if (probe.phase !== 'off') {
    const resting = probe.phase === 'resting' || probe.phase === 'carve';
    result.push(
      {
        ...moment('pull', 'Pull', resting ? probe.pulledAtMs : predictionAtMs(probe.etaMs, nowMs, probe.staleSinceMs != null), !resting),
        status: resting ? 'done' : 'current',
      },
      {
        ...moment(
          'carve',
          'Carve',
          probe.phase === 'carve' ? probe.carveAtMs : predictionAtMs(probe.carveAtMs, nowMs),
          probe.phase !== 'carve'
        ),
        status: resting ? 'current' : 'upcoming',
      }
    );
  }
  const next = nextCookMoment(state, nowMs);
  if (next?.alarm && !result.some(item => item.kind === next.kind)) result.unshift(next);
  const rail = result.map(item =>
    next && item.status === 'current' && item.kind === next.kind && ['pull', 'carve', 'bag_in', 'chill_done'].includes(item.kind)
      ? { ...item, atMs: next.atMs, approximate: next.approximate, urgent: next.urgent, alarm: next.alarm }
      : item
  );
  return rail.sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return -1;
    if (b.status === 'done' && a.status !== 'done') return 1;
    if (a.alarm !== b.alarm) return Number(b.alarm) - Number(a.alarm);
    return (a.atMs ?? Infinity) - (b.atMs ?? Infinity);
  });
}

export function cookProgress(state: CookState | null | undefined, live: CookLive | null | undefined, nowMs = Date.now()): number | null {
  const next = nextCookMoment(state, nowMs);
  if (!state || !next) return null;
  if (next.urgent && (next.atMs == null || next.atMs <= nowMs)) return 1;
  const start =
    next.kind === 'bath_done'
      ? state.bath.inAtMs
      : next.kind === 'carve'
        ? state.probe.pulledAtMs
        : next.kind === 'chill_done'
          ? state.bath.chillUntilMs != null
            ? state.bath.chillUntilMs - 15 * 60_000
            : null
          : (live?.t0Ms ?? null);
  if (start == null || next.atMs == null || next.atMs <= start) return null;
  return Math.min(1, Math.max(0, (nowMs - start) / (next.atMs - start)));
}
