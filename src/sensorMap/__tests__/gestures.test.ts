import { describe, expect, it } from 'vitest';
import { panBy, pinchStart, pinchView, screenToPlan, type Px, type View } from '../geometry';
import {
  DOUBLE_TAP_MS,
  TAP_SLOP_PX,
  idleMachine,
  step,
  type GestureContext,
  type GestureEvent,
  type GestureMachine,
  type Hit,
  type PointerInput,
} from '../gestures';
import { makeDoc } from './docFixtures';

const { fit, bounds } = makeDoc().plan;
const size = { w: 800, h: 600 };
const START: View = { cx: 6, cy: 4, s: 40 };

const plan: Hit = { kind: 'plan', id: null };
const zone: Hit = { kind: 'zone', id: 'alpha' };
const selected: Hit = { kind: 'marker', id: 'sel' };
const other: Hit = { kind: 'marker', id: 'other' };
const handle: Hit = { kind: 'handle', id: 'sel' };

const draggable = (hit: Hit) => (hit.kind === 'marker' && hit.id === 'sel') || hit.kind === 'handle';
const down = (id: number, x: number, y: number, hit: Hit = plan, time = 0): PointerInput => ({ type: 'down', id, px: { x, y }, hit, time });
const move = (id: number, x: number, y: number): PointerInput => ({ type: 'move', id, px: { x, y } });
const up = (id: number, x: number, y: number, time = 0): PointerInput => ({ type: 'up', id, px: { x, y }, time });
const cancel = (id: number): PointerInput => ({ type: 'cancel', id });

/** Feeds the inputs through the machine and keeps the view up to date the way the hook does. */
function drive(inputs: PointerInput[], from: { machine?: GestureMachine; view?: View } = {}) {
  let machine = from.machine ?? idleMachine();
  let view = from.view ?? START;
  const events: GestureEvent[] = [];
  for (const input of inputs) {
    const ctx: GestureContext = { view, size, fit, bounds, draggable };
    const result = step(machine, input, ctx);
    machine = result.machine;
    for (const event of result.events) {
      events.push(event);
      if (event.type === 'view') view = event.view;
    }
  }
  return { machine, view, events };
}

const types = (events: GestureEvent[]) => events.map(event => event.type);

describe('taps', () => {
  it('turns a press and release on a marker into a tap on that marker', () => {
    const { events, machine } = drive([down(1, 300, 200, other), up(1, 300, 200)]);
    expect(events).toEqual([{ type: 'tap', hit: other, px: { x: 300, y: 200 }, world: screenToPlan(START, size, 300, 200) }]);
    expect(machine.state.mode).toBe('idle');
  });

  it('treats a wobble inside the slop as a tap, on the selected marker too, and never as a drag', () => {
    const wobble = TAP_SLOP_PX - 1;
    const { events } = drive([down(1, 300, 200, selected), move(1, 300 + wobble, 200), move(1, 300, 200 - wobble), up(1, 301, 200)]);
    expect(types(events)).toEqual(['tap']);
  });

  it('turns a double tap on the plan into one tap and then a double tap', () => {
    const { events } = drive([down(1, 300, 200, plan, 0), up(1, 300, 200, 50), down(1, 305, 202, plan, 200), up(1, 305, 202, 250)]);
    expect(types(events)).toEqual(['tap', 'double-tap']);
  });

  it('does not take two slow taps, two distant taps or two taps on markers for a double tap', () => {
    const slow = drive([
      down(1, 300, 200, plan, 0),
      up(1, 300, 200, 50),
      down(1, 300, 200, plan, 50 + DOUBLE_TAP_MS + 50),
      up(1, 300, 200, 50 + DOUBLE_TAP_MS + 80),
    ]);
    expect(types(slow.events)).toEqual(['tap', 'tap']);
    const far = drive([down(1, 300, 200, plan, 0), up(1, 300, 200, 50), down(1, 400, 200, plan, 100), up(1, 400, 200, 150)]);
    expect(types(far.events)).toEqual(['tap', 'tap']);
    const markers = drive([down(1, 300, 200, other, 0), up(1, 300, 200, 50), down(1, 300, 200, other, 100), up(1, 300, 200, 150)]);
    expect(types(markers.events)).toEqual(['tap', 'tap']);
  });

  it('takes two quick taps on a zone, which covers most of the plan, for a double tap too', () => {
    const { events } = drive([down(1, 300, 200, zone, 0), up(1, 300, 200, 50), down(1, 305, 202, zone, 200), up(1, 305, 202, 250)]);
    expect(types(events)).toEqual(['tap', 'double-tap']);
  });

  it('needs a fresh pair of taps after a double tap', () => {
    const { events } = drive([
      down(1, 300, 200, plan, 0),
      up(1, 300, 200, 20),
      down(1, 300, 200, plan, 100),
      up(1, 300, 200, 120),
      down(1, 300, 200, plan, 200),
      up(1, 300, 200, 220),
    ]);
    expect(types(events)).toEqual(['tap', 'double-tap', 'tap']);
  });
});

describe('panning', () => {
  it('pans the plan with a finger that leaves the slop, from the point it went down, and starts a gesture once', () => {
    const { events, machine } = drive([down(1, 300, 200), move(1, 300 + 40, 200 - 80), move(1, 300 + 80, 200 - 40), up(1, 380, 160)]);
    expect(types(events)).toEqual(['gesture-start', 'view', 'view']);
    const last = events[events.length - 1];
    expect(last).toEqual({ type: 'view', view: panBy(START, 80, -40, bounds) });
    expect(machine.state.mode).toBe('idle');
  });

  it('works from the view the pan began with, so going back and forth never drifts', () => {
    const there = drive([down(1, 300, 200), move(1, 400, 260), move(1, 350, 230)]);
    const direct = drive([down(1, 300, 200), move(1, 350, 230)]);
    expect(there.view).toEqual(direct.view);
  });

  it('pans the plan when a press starts on a marker that is not the selected one, and a drag of a draggable one does not pan', () => {
    const panned = drive([down(1, 300, 200, other), move(1, 340, 200)]);
    expect(types(panned.events)).toEqual(['gesture-start', 'view']);
    const dragged = drive([down(1, 300, 200, selected), move(1, 340, 200)]);
    expect(dragged.events.some(event => event.type === 'view')).toBe(false);
  });

  it('never ends a pan in a tap', () => {
    const { events } = drive([down(1, 300, 200), move(1, 340, 200), up(1, 340, 200)]);
    expect(events.some(event => event.type === 'tap')).toBe(false);
  });
});

describe('dragging the selected marker', () => {
  it('starts only after the slop, then follows the pointer and commits on release: a 1 m drag moves 1.00 m', () => {
    const { events, machine } = drive([
      down(1, 300, 200, selected),
      move(1, 300 + 4, 200),
      move(1, 300 + 20, 200),
      move(1, 300 + 40, 200),
      up(1, 340, 200),
    ]);
    expect(types(events)).toEqual(['gesture-start', 'drag-start', 'drag-move', 'drag-move', 'drag-end']);
    const end = events[events.length - 1];
    if (end.type !== 'drag-end') throw new Error('expected a drag-end');
    expect(end.world[0] - end.startWorld[0]).toBeCloseTo(1, 6);
    expect(end.world[1]).toBeCloseTo(end.startWorld[1], 6);
    expect(machine.state.mode).toBe('idle');
  });

  it('drags the rotation handle the same way', () => {
    const { events } = drive([down(1, 300, 200, handle), move(1, 330, 230), up(1, 330, 230)]);
    expect(types(events)).toEqual(['gesture-start', 'drag-start', 'drag-move', 'drag-end']);
  });

  it('cancels, committing nothing, when the pointer comes back to where it started', () => {
    const { events } = drive([down(1, 300, 200, selected), move(1, 360, 200), move(1, 300, 200), up(1, 300, 200)]);
    expect(types(events)).toEqual(['gesture-start', 'drag-start', 'drag-move', 'drag-move', 'drag-cancel']);
  });

  it('cancels on pointercancel and on lost capture', () => {
    const { events, machine } = drive([down(1, 300, 200, selected), move(1, 360, 200), cancel(1)]);
    expect(types(events)).toEqual(['gesture-start', 'drag-start', 'drag-move', 'drag-cancel']);
    expect(machine.state.mode).toBe('idle');
    expect(machine.pointers).toEqual({});
  });

  it('cancels when a second finger lands, and the first finger lifting afterwards commits nothing', () => {
    const { events, machine } = drive([
      down(1, 300, 200, selected),
      move(1, 360, 200),
      down(2, 500, 300),
      move(2, 520, 300),
      up(1, 360, 200),
      up(2, 520, 300),
    ]);
    expect(types(events)).toContain('drag-cancel');
    expect(types(events)).not.toContain('drag-end');
    expect(machine.state.mode).toBe('idle');
  });

  it('cancels on reset, which is what a page hide or a navigation sends', () => {
    const { events, machine } = drive([down(1, 300, 200, selected), move(1, 360, 200), { type: 'reset' }]);
    expect(events[events.length - 1]).toEqual({ type: 'drag-cancel', hit: selected });
    expect(machine.state.mode).toBe('idle');
    expect(drive([down(1, 300, 200), { type: 'reset' }]).events).toEqual([]);
  });

  it('starts no drag on the selected marker when the press began as a tap and only a cancel arrives', () => {
    const { events } = drive([down(1, 300, 200, selected), cancel(1)]);
    expect(events).toEqual([]);
  });
});

describe('two fingers', () => {
  const a = { x: 300, y: 300 };
  const b = { x: 500, y: 300 };

  it('translates the plan by the finger delta when both fingers move the same way', () => {
    const { view } = drive([down(1, a.x, a.y), down(2, b.x, b.y), move(1, a.x + 80, a.y - 40), move(2, b.x + 80, b.y - 40)]);
    expect(view.s).toBeCloseTo(START.s);
    expect(view.cx).toBeCloseTo(START.cx - 80 / START.s);
    expect(view.cy).toBeCloseTo(START.cy - 40 / START.s);
  });

  it('scales about the plan point under the midpoint', () => {
    const anchor = screenToPlan(START, size, 400, 300);
    const { view } = drive([down(1, a.x, a.y), down(2, b.x, b.y), move(1, 200, 300), move(2, 600, 300)]);
    expect(view.s).toBeCloseTo(START.s * 2);
    const under = screenToPlan(view, size, 400, 300);
    expect(under[0]).toBeCloseTo(anchor[0]);
    expect(under[1]).toBeCloseTo(anchor[1]);
  });

  it('gives the view the pinch maths gives, move for move', () => {
    const { view } = drive([down(1, a.x, a.y), down(2, b.x, b.y), move(1, 260, 320), move(2, 540, 280)]);
    const expected = pinchView(pinchStart(START, size, a, b), size, fit, bounds, { x: 260, y: 320 }, { x: 540, y: 280 });
    expect(view).toEqual(expected);
  });

  it('starts a gesture when the second finger lands', () => {
    const { events } = drive([down(1, a.x, a.y), down(2, b.x, b.y)]);
    expect(types(events)).toEqual(['gesture-start']);
  });

  it('carries on as a pan with the finger left, from where it is, without a jump', () => {
    const afterPinch = drive([down(1, a.x, a.y), down(2, b.x, b.y), move(1, 250, 300), move(2, 550, 300), up(1, 250, 300)]);
    expect(afterPinch.machine.state.mode).toBe('pan');
    const stay = drive([move(2, 550, 300)], afterPinch);
    expect(stay.view).toEqual(afterPinch.view);
    const moved = drive([move(2, 590, 330)], afterPinch);
    expect(moved.view.cx).toBeCloseTo(afterPinch.view.cx - 40 / afterPinch.view.s);
    expect(moved.view.cy).toBeCloseTo(afterPinch.view.cy + 30 / afterPinch.view.s);
    expect(moved.view.s).toBeCloseTo(afterPinch.view.s);
  });

  it('does not tap when the last finger lifts after a pinch', () => {
    const { events } = drive([down(1, a.x, a.y), down(2, b.x, b.y), up(1, a.x, a.y), up(2, b.x, b.y)]);
    expect(types(events)).not.toContain('tap');
  });

  it('continues without a jump when a lifted finger is replaced by another', () => {
    const first = drive([down(1, a.x, a.y), down(2, b.x, b.y), move(1, 250, 300), move(2, 550, 300), up(1, 250, 300)]);
    const second = drive([down(3, 200, 300), move(3, 200, 300), move(2, 550, 300)], first);
    expect(second.machine.state.mode).toBe('pinch');
    expect(second.view.s).toBeCloseTo(first.view.s, 6);
    expect(second.view.cx).toBeCloseTo(first.view.cx, 6);
    expect(second.view.cy).toBeCloseTo(first.view.cy, 6);
  });

  it('ignores a third finger', () => {
    const base = drive([down(1, a.x, a.y), down(2, b.x, b.y)]);
    const third = drive([down(3, 100, 100), move(3, 150, 150), up(3, 150, 150)], base);
    expect(third.events).toEqual([]);
    expect(third.machine.state.mode).toBe('pinch');
  });

  it('cancels a pinch cleanly when one finger is cancelled', () => {
    const { machine } = drive([down(1, a.x, a.y), down(2, b.x, b.y), cancel(1), cancel(2)]);
    expect(machine.state.mode).toBe('idle');
    expect(machine.pointers).toEqual({});
  });

  it('ignores moves and releases of pointers it never saw go down', () => {
    const { events, machine } = drive([move(9, 10, 10), up(9, 10, 10), cancel(9)]);
    expect(events).toEqual([]);
    expect(machine).toEqual(idleMachine());
  });
});

describe('a mouse', () => {
  it('pans, taps and drags like one finger, with one pointer id', () => {
    const pointer: Px = { x: 120, y: 90 };
    const tap = drive([down(1, pointer.x, pointer.y, other), up(1, pointer.x, pointer.y)]);
    expect(types(tap.events)).toEqual(['tap']);
    const pan = drive([down(1, pointer.x, pointer.y), move(1, 160, 90), up(1, 160, 90)]);
    expect(types(pan.events)).toEqual(['gesture-start', 'view']);
  });
});
