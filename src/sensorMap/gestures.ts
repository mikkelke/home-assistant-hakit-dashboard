import { panBy, pinchStart, pinchView, screenToPlan, type PinchStart, type Px, type Size, type View } from './geometry';
import type { Point, Rect } from './mapDoc';

export const TAP_SLOP_PX = 8;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 24;

export type HitKind = 'plan' | 'marker' | 'handle' | 'zone' | 'ghost' | 'fingerprint' | 'survey';

export interface Hit {
  kind: HitKind;
  id: string | null;
}

export interface GestureContext {
  view: View;
  size: Size;
  fit: Rect;
  bounds: Rect;
  /** True when a press that starts on this hit drags it, as the selected marker and its handle do in Edit mode. */
  draggable: (hit: Hit) => boolean;
}

type GestureState =
  | { mode: 'idle' }
  | { mode: 'press'; id: number; start: Px; hit: Hit }
  | { mode: 'pan'; id: number; start: Px; view: View }
  | { mode: 'drag'; id: number; hit: Hit; startWorld: Point }
  | { mode: 'pinch'; ids: [number, number]; start: PinchStart };

export interface GestureMachine {
  state: GestureState;
  pointers: Record<number, Px>;
  lastTap: { time: number; px: Px } | null;
}

export type PointerInput =
  | { type: 'down'; id: number; px: Px; hit: Hit; time: number }
  | { type: 'move'; id: number; px: Px }
  | { type: 'up'; id: number; px: Px; time: number }
  | { type: 'cancel'; id: number }
  | { type: 'reset' };

export type GestureEvent =
  | { type: 'view'; view: View }
  | { type: 'tap'; hit: Hit; px: Px; world: Point }
  | { type: 'double-tap'; px: Px; world: Point }
  | { type: 'gesture-start' }
  | { type: 'drag-start'; hit: Hit; startWorld: Point }
  | { type: 'drag-move'; hit: Hit; startWorld: Point; world: Point }
  | { type: 'drag-end'; hit: Hit; startWorld: Point; world: Point }
  | { type: 'drag-cancel'; hit: Hit };

export interface Step {
  machine: GestureMachine;
  events: GestureEvent[];
}

export const idleMachine = (): GestureMachine => ({ state: { mode: 'idle' }, pointers: {}, lastTap: null });

const distance = (a: Px, b: Px) => Math.hypot(a.x - b.x, a.y - b.y);
/** A room's fill covers most of the plan, so a tap on a zone is a tap on the background. */
const isBackground = (hit: Hit) => hit.kind === 'plan' || hit.kind === 'zone';
const worldOf = (ctx: GestureContext, px: Px): Point => screenToPlan(ctx.view, ctx.size, px.x, px.y);

function withoutPointer(pointers: Record<number, Px>, id: number): Record<number, Px> {
  const { [id]: _removed, ...rest } = pointers;
  void _removed;
  return rest;
}

/** What is left when one of two fingers goes: the other one carries on as a pan from where it is now. */
function continueAsPan(machine: GestureMachine, ctx: GestureContext, gone: number): GestureMachine {
  const pointers = withoutPointer(machine.pointers, gone);
  const [remaining] = Object.keys(pointers).map(Number);
  if (remaining === undefined) return { ...machine, state: { mode: 'idle' }, pointers: {} };
  return { ...machine, state: { mode: 'pan', id: remaining, start: pointers[remaining], view: ctx.view }, pointers };
}

/**
 * The pointer state machine of the map, as a pure function.
 *
 *   idle  - down ->  press       one pointer down; nothing happens until it moves or lifts
 *   press - up    -> tap         lifted within the slop; a quick second tap on the plan or a zone is a double tap
 *   press - moved past the slop -> drag on the selected marker or its handle, otherwise pan
 *   any   - a second pointer down -> pinch   (a drag in progress is cancelled)
 *   pinch - one lifts -> pan     the remaining pointer carries on from where it is, so the view does not jump
 *   drag  - up -> drag-end only when the point moved; cancel, lost capture, reset -> drag-cancel
 *
 * A third pointer is ignored. A tap or a wobble inside the slop never produces a drag event.
 */
export function step(machine: GestureMachine, input: PointerInput, ctx: GestureContext): Step {
  const { state } = machine;
  const events: GestureEvent[] = [];

  if (input.type === 'reset') {
    if (state.mode === 'drag') events.push({ type: 'drag-cancel', hit: state.hit });
    return { machine: { ...idleMachine(), lastTap: machine.lastTap }, events };
  }

  if (input.type === 'down') {
    if (machine.pointers[input.id]) return { machine, events };
    const pointers = { ...machine.pointers, [input.id]: input.px };
    if (state.mode === 'idle') {
      return { machine: { ...machine, state: { mode: 'press', id: input.id, start: input.px, hit: input.hit }, pointers }, events };
    }
    if (state.mode === 'pinch') return { machine, events };
    if (state.mode === 'drag') events.push({ type: 'drag-cancel', hit: state.hit });
    const start = pinchStart(ctx.view, ctx.size, machine.pointers[state.id], input.px);
    events.push({ type: 'gesture-start' });
    return { machine: { ...machine, state: { mode: 'pinch', ids: [state.id, input.id], start }, pointers }, events };
  }

  if (!machine.pointers[input.id]) return { machine, events };

  if (input.type === 'move') {
    const pointers = { ...machine.pointers, [input.id]: input.px };
    const next = { ...machine, pointers };
    if (state.mode === 'press' && state.id === input.id) {
      if (distance(state.start, input.px) <= TAP_SLOP_PX) return { machine: next, events };
      if (ctx.draggable(state.hit)) {
        const startWorld = worldOf(ctx, state.start);
        events.push({ type: 'gesture-start' }, { type: 'drag-start', hit: state.hit, startWorld });
        events.push({ type: 'drag-move', hit: state.hit, startWorld, world: worldOf(ctx, input.px) });
        return { machine: { ...next, state: { mode: 'drag', id: state.id, hit: state.hit, startWorld } }, events };
      }
      const view = panBy(ctx.view, input.px.x - state.start.x, input.px.y - state.start.y, ctx.bounds);
      events.push({ type: 'gesture-start' }, { type: 'view', view });
      return { machine: { ...next, state: { mode: 'pan', id: state.id, start: state.start, view: ctx.view } }, events };
    }
    if (state.mode === 'pan' && state.id === input.id) {
      events.push({ type: 'view', view: panBy(state.view, input.px.x - state.start.x, input.px.y - state.start.y, ctx.bounds) });
      return { machine: next, events };
    }
    if (state.mode === 'drag' && state.id === input.id) {
      events.push({ type: 'drag-move', hit: state.hit, startWorld: state.startWorld, world: worldOf(ctx, input.px) });
      return { machine: next, events };
    }
    if (state.mode === 'pinch' && state.ids.includes(input.id)) {
      const [a, b] = state.ids;
      events.push({ type: 'view', view: pinchView(state.start, ctx.size, ctx.fit, ctx.bounds, pointers[a], pointers[b]) });
    }
    return { machine: next, events };
  }

  if (input.type === 'cancel') {
    if (state.mode === 'pinch' && state.ids.includes(input.id)) return { machine: continueAsPan(machine, ctx, input.id), events };
    if (state.mode === 'drag' && state.id === input.id) events.push({ type: 'drag-cancel', hit: state.hit });
    return { machine: { ...machine, state: { mode: 'idle' }, pointers: withoutPointer(machine.pointers, input.id) }, events };
  }

  if (state.mode === 'pinch') {
    if (!state.ids.includes(input.id)) return { machine, events };
    return { machine: continueAsPan(machine, ctx, input.id), events };
  }

  const pointers = withoutPointer(machine.pointers, input.id);
  const idle: GestureMachine = { ...machine, state: { mode: 'idle' }, pointers };
  if (state.mode === 'drag' && state.id === input.id) {
    const world = worldOf(ctx, input.px);
    const moved = world[0] !== state.startWorld[0] || world[1] !== state.startWorld[1];
    events.push(
      moved ? { type: 'drag-end', hit: state.hit, startWorld: state.startWorld, world } : { type: 'drag-cancel', hit: state.hit }
    );
    return { machine: idle, events };
  }
  if (state.mode === 'press' && state.id === input.id) {
    const world = worldOf(ctx, input.px);
    const previous = machine.lastTap;
    const second =
      previous !== null &&
      isBackground(state.hit) &&
      input.time - previous.time <= DOUBLE_TAP_MS &&
      distance(previous.px, input.px) <= DOUBLE_TAP_PX;
    if (second) {
      events.push({ type: 'double-tap', px: input.px, world });
      return { machine: { ...idle, lastTap: null }, events };
    }
    events.push({ type: 'tap', hit: state.hit, px: input.px, world });
    return { machine: { ...idle, lastTap: isBackground(state.hit) ? { time: input.time, px: input.px } : null }, events };
  }
  return { machine: idle, events };
}
