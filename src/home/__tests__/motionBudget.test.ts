import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMotionBudget, holdMotionSlot, MOTION_CAP, motionCap, type MotionBudget, type MotionPriority } from '../motionBudget';

/** Loops requested lowest priority first, so any grant order comes from the budget. */
const LOOPS: [string, MotionPriority][] = [
  ['clouds', 'clouds'],
  ['breathing', 'breathing'],
  ['now-pulse', 'nowPulse'],
  ['eq:dining_room', 'equaliser'],
  ['glint:washer', 'appliance'],
];

function requestAll(budget: MotionBudget, loops = LOOPS) {
  return loops.map(([id, priority]) => budget.acquire(id, priority, id === 'now-pulse' ? 'timeline' : 'grid'));
}

describe('caps', () => {
  it('grants 3 by day, 1 at night and 0 under reduced motion', () => {
    expect(MOTION_CAP).toEqual({ day: 3, night: 1, reducedMotion: 0 });
    expect(motionCap({ reducedMotion: false, night: false })).toBe(3);
    expect(motionCap({ reducedMotion: false, night: true })).toBe(1);
    expect(motionCap({ reducedMotion: true, night: true })).toBe(0);

    const budget = createMotionBudget();
    requestAll(budget);
    budget.acquire('ripple:hallway', 'oneShot', 'grid');
    expect(budget.granted()).toEqual(['ripple:hallway', 'glint:washer', 'eq:dining_room']);
    budget.setConditions({ night: true });
    expect(budget.granted()).toEqual(['ripple:hallway']);
    budget.setConditions({ reducedMotion: true });
    expect(budget.granted()).toEqual([]);
  });

  it('grants by priority, then by arrival', () => {
    const budget = createMotionBudget();
    requestAll(budget, [
      ['eq:kristines_room', 'equaliser'],
      ['clouds', 'clouds'],
      ['eq:dining_room', 'equaliser'],
      ['glint:dryer', 'appliance'],
    ]);
    expect(budget.granted()).toEqual(['glint:dryer', 'eq:kristines_room', 'eq:dining_room']);
  });

  it('never grants breathing or clouds at night, even with the slot free', () => {
    const budget = createMotionBudget({ night: true });
    requestAll(budget, [
      ['clouds', 'clouds'],
      ['breathing', 'breathing'],
    ]);
    expect(budget.granted()).toEqual([]);
    budget.acquire('eq:bedroom', 'equaliser', 'grid');
    expect(budget.granted()).toEqual(['eq:bedroom']);
    budget.setConditions({ night: false });
    expect(budget.granted()).toEqual(['eq:bedroom', 'breathing', 'clouds']);
  });
});

describe('preemption and release', () => {
  it('lets a one-shot take the lowest loop slot until it ends', () => {
    const budget = createMotionBudget();
    requestAll(budget, LOOPS.slice(0, 2));
    budget.acquire('glint:washer', 'appliance', 'grid');
    expect(budget.granted()).toEqual(['glint:washer', 'breathing', 'clouds']);

    const release = budget.acquire('ripple:hallway', 'oneShot', 'grid');
    expect(budget.granted()).toEqual(['ripple:hallway', 'glint:washer', 'breathing']);
    expect(budget.isGranted('clouds')).toBe(false);
    release();
    expect(budget.granted()).toEqual(['glint:washer', 'breathing', 'clouds']);
  });

  it('hands an unmounted slot to the next in line, and ignores a second release', () => {
    const budget = createMotionBudget();
    const [, , , , releaseGlint] = requestAll(budget);
    budget.acquire('eq:kitchen', 'equaliser', 'grid');
    expect(budget.granted()).toEqual(['glint:washer', 'eq:dining_room', 'eq:kitchen']);
    releaseGlint();
    releaseGlint();
    expect(budget.granted()).toEqual(['eq:dining_room', 'eq:kitchen', 'breathing']);
  });

  it('keeps one shared slot while any holder of the id remains', () => {
    const budget = createMotionBudget();
    const releaseBedroom = budget.acquire('breathing', 'breathing', 'grid');
    const releaseKitchen = budget.acquire('breathing', 'breathing', 'grid');
    budget.acquire('clouds', 'clouds', 'grid');
    expect(budget.granted()).toEqual(['breathing', 'clouds']);
    releaseBedroom();
    releaseBedroom();
    expect(budget.isGranted('breathing')).toBe(true);
    releaseKitchen();
    expect(budget.granted()).toEqual(['clouds']);
  });

  it('ends in the same grant after StrictMode mounts, unmounts and remounts every effect', () => {
    const once = createMotionBudget();
    requestAll(once);
    const strict = createMotionBudget();
    requestAll(strict).forEach(release => release());
    requestAll(strict);
    expect(strict.granted()).toEqual(once.granted());
    expect(strict.granted()).toEqual(['glint:washer', 'eq:dining_room', 'breathing']);
  });
});

describe('scope and pausing', () => {
  it('grants only the scope on screen', () => {
    const budget = createMotionBudget();
    requestAll(budget);
    budget.setConditions({ scope: 'timeline' });
    expect(budget.granted()).toEqual(['now-pulse']);
    budget.setConditions({ scope: null });
    expect(budget.granted()).toEqual([]);
    budget.setConditions({ scope: 'grid' });
    expect(budget.granted()).toEqual(['glint:washer', 'eq:dining_room', 'breathing']);
  });

  it('pauses everything while the document is hidden', () => {
    const budget = createMotionBudget();
    requestAll(budget);
    budget.setConditions({ hidden: true });
    expect(budget.granted()).toEqual([]);
    budget.setConditions({ hidden: false });
    expect(budget.granted()).toHaveLength(3);
  });
});

describe('snapshots', () => {
  it('keeps the same array and stays silent while the grant is unchanged', () => {
    const budget = createMotionBudget();
    const listener = vi.fn();
    const unsubscribe = budget.subscribe(listener);
    requestAll(budget, [
      ['breathing', 'breathing'],
      ['eq:dining_room', 'equaliser'],
      ['glint:washer', 'appliance'],
    ]);
    const snapshot = budget.granted();
    expect(listener).toHaveBeenCalledTimes(3);

    const releaseClouds = budget.acquire('clouds', 'clouds', 'grid');
    budget.setConditions({ night: false });
    releaseClouds();
    expect(budget.granted()).toBe(snapshot);
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    budget.setConditions({ reducedMotion: true });
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe('holdMotionSlot', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives a one-shot slot back after its duration', () => {
    vi.useFakeTimers();
    const budget = createMotionBudget();
    holdMotionSlot(budget, 'ripple:hallway', 'oneShot', 'grid', 2_000);
    expect(budget.isGranted('ripple:hallway')).toBe(true);
    vi.advanceTimersByTime(1_999);
    expect(budget.isGranted('ripple:hallway')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(budget.isGranted('ripple:hallway')).toBe(false);
  });

  it('releases on cleanup, once, also when StrictMode runs the effect twice', () => {
    vi.useFakeTimers();
    const budget = createMotionBudget();
    holdMotionSlot(budget, 'ripple:hallway', 'oneShot', 'grid', 2_000)();
    const cleanup = holdMotionSlot(budget, 'ripple:hallway', 'oneShot', 'grid', 2_000);
    expect(budget.isGranted('ripple:hallway')).toBe(true);
    cleanup();
    expect(budget.isGranted('ripple:hallway')).toBe(false);
    vi.advanceTimersByTime(5_000);

    const loop = holdMotionSlot(budget, 'glint:washer', 'appliance', 'grid');
    vi.advanceTimersByTime(60_000);
    expect(budget.isGranted('glint:washer')).toBe(true);
    loop();
    expect(budget.granted()).toEqual([]);
  });
});

describe('the coffee stage', () => {
  it('has its own cap of 2, day or night, and none under reduced motion', () => {
    expect(motionCap({ reducedMotion: false, night: true, scope: 'stage' })).toBe(2);
    expect(motionCap({ reducedMotion: true, night: false, scope: 'stage' })).toBe(0);
    const budget = createMotionBudget({ scope: 'stage' });
    budget.acquire('glint:washer', 'appliance', 'grid');
    budget.acquire('stage:head', 'appliance', 'stage');
    budget.acquire('stage:pour', 'appliance', 'stage');
    budget.acquire('stage:extra', 'appliance', 'stage');
    expect(budget.granted()).toEqual(['stage:head', 'stage:pour']);
    budget.setConditions({ night: true });
    expect(budget.granted()).toEqual(['stage:head', 'stage:pour']);
    budget.setConditions({ hidden: true });
    expect(budget.granted()).toEqual([]);
  });
});
