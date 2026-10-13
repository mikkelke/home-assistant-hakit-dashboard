// @vitest-environment happy-dom
import { act, createElement, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  motionBudget,
  MotionScopeContext,
  setMotionConditions,
  useMotionSlot,
  type MotionPriority,
  type MotionScope,
} from '../motionBudget';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** What each probe last rendered: whether its animation may play. */
let shown: Record<string, boolean> = {};

function Probe({ id, priority, active = true, oneShotMs }: { id: string; priority: MotionPriority; active?: boolean; oneShotMs?: number }) {
  const playing = useMotionSlot(id, priority, active, oneShotMs);
  useEffect(() => {
    shown[id] = playing;
  });
  return null;
}

type Spec = { id: string; priority: MotionPriority; active?: boolean; oneShotMs?: number; scope?: MotionScope };

const roots: Root[] = [];

function render(specs: Spec[], wrap: (node: ReactNode) => ReactNode = node => node): Root {
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  const tree = specs.map(spec =>
    createElement(MotionScopeContext.Provider, { key: spec.id, value: spec.scope ?? 'grid' }, createElement(Probe, spec))
  );
  act(() => root.render(wrap(tree)));
  return root;
}

const granted = () => Object.keys(shown).filter(id => shown[id]);

beforeEach(() => {
  shown = {};
  setMotionConditions({ reducedMotion: false, night: false, hidden: false, scope: 'grid' });
});

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()));
  vi.useRealTimers();
});

describe('useMotionSlot in rendered components', () => {
  it('plays the three highest loops on screen and hands a slot on when one unmounts', () => {
    render([
      { id: 'clouds', priority: 'clouds' },
      { id: 'breathing', priority: 'breathing' },
      { id: 'eq:dining_room', priority: 'equaliser' },
    ]);
    const washer = render([{ id: 'glint:washer', priority: 'appliance' }]);
    expect(granted().sort()).toEqual(['breathing', 'eq:dining_room', 'glint:washer']);

    act(() => washer.unmount());
    expect(motionBudget.granted()).toEqual(['eq:dining_room', 'breathing', 'clouds']);
    expect(shown.clouds).toBe(true);
  });

  it('lets a one-shot take the lowest loop and gives it back when it ends', () => {
    vi.useFakeTimers();
    render([
      { id: 'glint:washer', priority: 'appliance' },
      { id: 'eq:kitchen', priority: 'equaliser' },
      { id: 'breathing', priority: 'breathing' },
    ]);
    render([{ id: 'ripple:hallway', priority: 'oneShot', oneShotMs: 2300 }]);
    expect(shown['ripple:hallway']).toBe(true);
    expect(shown.breathing).toBe(false);

    act(() => vi.advanceTimersByTime(2300));
    expect(shown['ripple:hallway']).toBe(false);
    expect(shown.breathing).toBe(true);
  });

  it('ends StrictMode double mounting in the grant a single mount gives, and frees every slot on unmount', () => {
    const root = render(
      [
        { id: 'glint:washer', priority: 'appliance' },
        { id: 'eq:kitchen', priority: 'equaliser' },
        { id: 'breathing', priority: 'breathing' },
        { id: 'clouds', priority: 'clouds' },
      ],
      node => createElement(StrictMode, null, node)
    );
    expect(motionBudget.granted()).toEqual(['glint:washer', 'eq:kitchen', 'breathing']);
    act(() => root.unmount());
    expect(motionBudget.granted()).toEqual([]);
  });

  it('plays only the scope on screen, nothing under reduced motion, and one loop at night', () => {
    render([
      { id: 'glint:washer', priority: 'appliance' },
      { id: 'breathing', priority: 'breathing' },
      { id: 'now-pulse', priority: 'nowPulse', scope: 'timeline' },
    ]);
    expect(granted().sort()).toEqual(['breathing', 'glint:washer']);

    act(() => setMotionConditions({ scope: 'timeline' }));
    expect(granted()).toEqual(['now-pulse']);

    act(() => setMotionConditions({ scope: 'grid', night: true }));
    expect(granted()).toEqual(['glint:washer']);

    act(() => setMotionConditions({ night: false, reducedMotion: true }));
    expect(granted()).toEqual([]);
  });

  it('stops asking while inactive', () => {
    const root = render([{ id: 'eq:bedroom', priority: 'equaliser', active: false }]);
    expect(shown['eq:bedroom']).toBe(false);
    expect(motionBudget.granted()).toEqual([]);
    act(() => root.render(createElement(Probe, { id: 'eq:bedroom', priority: 'equaliser', active: true })));
    expect(shown['eq:bedroom']).toBe(true);
  });
});
