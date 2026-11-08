import type { CookMomentKind, CookState } from './model';

export const TAKEOVER_UNTOUCHED_MS = 120_000;
export const TAKEOVER_RETURN_MS = 300_000;
export const TAKEOVER_SETTLE_MS = 5_000;

export interface ActiveTakeover {
  cookId: string | null;
  atMs: number;
  returnTo: 'back' | 'grid';
  endedAtMs: number | null;
}

export interface TakeoverMemo {
  seenKind: CookMomentKind | null;
  active: ActiveTakeover | null;
}

export const NO_TAKEOVER: TakeoverMemo = { seenKind: null, active: null };

export interface TakeoverInput {
  nextKind: CookMomentKind | null;
  active: boolean;
  coffeeBrewing: boolean;
  onStage: boolean;
  lastPointerMs: number;
  nowMs: number;
}

export type TakeoverAction = 'none' | 'open' | 'back' | 'grid';
export interface TakeoverStep {
  memo: TakeoverMemo;
  action: TakeoverAction;
}

const MOMENTS = new Set<CookMomentKind>(['bath_ready', 'bath_done', 'pull', 'carve', 'low_water']);

export function takeoverMoment(state: CookState | null | undefined): CookMomentKind | null {
  if (!state) return null;
  if (state.bath.lowWater) return 'low_water';
  if (state.probe.phase === 'pull') return 'pull';
  if (state.probe.phase === 'carve') return 'carve';
  if (state.bath.phase === 'done') return 'bath_done';
  if (state.bath.phase === 'ready') return 'bath_ready';
  return null;
}

export function armFromLink(memo: TakeoverMemo, cookId: string | null, nowMs: number): TakeoverMemo {
  return { ...memo, active: { cookId, atMs: nowMs, returnTo: 'grid', endedAtMs: null } };
}

export function returnDueAtMs(memo: TakeoverMemo): number | null {
  return memo.active?.endedAtMs != null ? memo.active.endedAtMs + TAKEOVER_RETURN_MS : null;
}

export function stepTakeover(memo: TakeoverMemo, input: TakeoverInput): TakeoverStep {
  let { active } = memo;
  const seenKind = input.nextKind;
  let action: TakeoverAction = 'none';
  const closed = !input.onStage && input.nowMs - (active?.atMs ?? input.nowMs) > TAKEOVER_SETTLE_MS;
  if (active && (input.lastPointerMs > active.atMs || closed || input.coffeeBrewing)) active = null;

  if (input.nextKind !== memo.seenKind && input.nextKind && MOMENTS.has(input.nextKind)) {
    if (input.active && !input.coffeeBrewing && !input.onStage && input.nowMs - input.lastPointerMs >= TAKEOVER_UNTOUCHED_MS) {
      active = { cookId: null, atMs: input.nowMs, returnTo: 'back', endedAtMs: null };
      action = 'open';
    }
  }

  if (active) {
    if (input.active && active.endedAtMs != null) active = { ...active, endedAtMs: null };
    else if (!input.active && active.endedAtMs == null) active = { ...active, endedAtMs: input.nowMs };
    if (action === 'none' && active.endedAtMs != null && input.nowMs >= active.endedAtMs + TAKEOVER_RETURN_MS) {
      action = active.returnTo;
      active = null;
    }
  }
  return { memo: { seenKind, active }, action };
}
