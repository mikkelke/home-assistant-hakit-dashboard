/** When the wine-fridge tablet opens the coffee stage by itself, and when it goes back. Only a brew started on the
 * machine itself, while nobody has touched the tablet for 2 min, takes it over; it returns 5 min after the cup is
 * picked up, and only if nobody has touched it since. A machine waking up never counts. Pure. */
import type { BrewSource, CoffeePhase } from './state';

export const TAKEOVER_UNTOUCHED_MS = 120_000;
export const TAKEOVER_RETURN_MS = 300_000;
/** How long a takeover may wait for the stage it opened to show before it counts as closed. */
export const TAKEOVER_SETTLE_MS = 5_000;

export interface ActiveTakeover {
  /** The brew the stage was opened for. */
  brewId: string | null;
  atMs: number;
  /** `back`: the stage sits over the view it took over from; `grid`: a wake link opened it cold. */
  returnTo: 'back' | 'grid';
  /** When its brew ended: picked up, or stopped or gone quiet without a pickup. */
  endedAtMs: number | null;
}

export interface TakeoverMemo {
  /** The newest brew the tablet has seen, so each brew is considered once. */
  seenBrewId: string | null;
  active: ActiveTakeover | null;
}

export const NO_TAKEOVER: TakeoverMemo = { seenBrewId: null, active: null };

export interface TakeoverInput {
  brewId: string | null;
  source: BrewSource | null;
  phase: CoffeePhase | null;
  pickedUpAtMs: number | null;
  stoppedAtMs: number | null;
  /** The stage is showing. */
  onStage: boolean;
  /** The last pointer on the tablet; 0 for none since the page loaded. */
  lastPointerMs: number;
  nowMs: number;
}

export type TakeoverAction = 'none' | 'open' | 'back' | 'grid';

export interface TakeoverStep {
  memo: TakeoverMemo;
  action: TakeoverAction;
}

const ENDED: ReadonlySet<CoffeePhase> = new Set(['picked_up', 'stopped', 'start_failed', 'idle', 'asleep']);

/** A wake link (`#coffee&takeover=<brew>`) opened the stage: it goes back to the grid, armed like any takeover. */
export function armFromLink(memo: TakeoverMemo, brewId: string | null, nowMs: number): TakeoverMemo {
  return {
    seenBrewId: brewId ?? memo.seenBrewId,
    active: { brewId, atMs: nowMs, returnTo: 'grid', endedAtMs: null },
  };
}

/** When the return is due, for a timer; null while none is pending. */
export function returnDueAtMs(memo: TakeoverMemo): number | null {
  return memo.active?.endedAtMs != null ? memo.active.endedAtMs + TAKEOVER_RETURN_MS : null;
}

/** One look at the tablet: takes a new machine brew over, notes when the brew ends, and goes back once that is 5 min
 * ago. A pointer since the takeover, or the stage closed some other way, drops it. */
export function stepTakeover(memo: TakeoverMemo, input: TakeoverInput): TakeoverStep {
  let { seenBrewId, active } = memo;
  let action: TakeoverAction = 'none';

  const closed = !input.onStage && input.nowMs - (active?.atMs ?? input.nowMs) > TAKEOVER_SETTLE_MS;
  if (active && (input.lastPointerMs > active.atMs || closed)) active = null;

  if (input.brewId && input.brewId !== seenBrewId) {
    seenBrewId = input.brewId;
    const untouched = input.nowMs - input.lastPointerMs >= TAKEOVER_UNTOUCHED_MS;
    const brewing = input.phase === 'grinding' || input.phase === 'brewing';
    if (!active && input.source === 'machine' && brewing && !input.onStage && untouched) {
      active = { brewId: input.brewId, atMs: input.nowMs, returnTo: 'back', endedAtMs: null };
      action = 'open';
    } else if (active) {
      active = { ...active, brewId: input.brewId, endedAtMs: null };
    }
  }

  if (
    active &&
    active.endedAtMs == null &&
    input.phase &&
    ENDED.has(input.phase) &&
    (active.brewId == null || active.brewId === input.brewId)
  ) {
    const at = input.phase === 'picked_up' ? input.pickedUpAtMs : input.phase === 'stopped' ? input.stoppedAtMs : null;
    active = { ...active, endedAtMs: Math.min(at ?? input.nowMs, input.nowMs) };
  }

  if (action === 'none' && active?.endedAtMs != null && input.nowMs >= active.endedAtMs + TAKEOVER_RETURN_MS) {
    action = active.returnTo;
    active = null;
  }

  return { memo: { seenBrewId, active }, action };
}
