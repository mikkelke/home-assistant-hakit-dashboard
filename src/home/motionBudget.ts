/** A cap on looping animations: a module store grants slots by priority to the animations in the
 * scope on screen, and `useMotionSlot` reads it through `useSyncExternalStore`. Anything not
 * granted renders its static frame. */
import { createContext, useContext, useLayoutEffect, useSyncExternalStore } from 'react';

/** Highest first. */
export const MOTION_PRIORITIES = ['oneShot', 'appliance', 'equaliser', 'nowPulse', 'breathing', 'clouds'] as const;
export type MotionPriority = (typeof MOTION_PRIORITIES)[number];

export type MotionScope = 'grid' | 'timeline' | 'stage';

export interface MotionConditions {
  reducedMotion: boolean;
  /** Anyone in sleep mode, or night hours. */
  night: boolean;
  /** The document is hidden. */
  hidden: boolean;
  /** The scope on screen; null while something covers both, such as Energy, a room sheet or a modal. */
  scope: MotionScope | null;
}

export const MOTION_CAP = { day: 3, night: 1, reducedMotion: 0 } as const;

/** The coffee stage is a screen of its own, watched while a brew runs: its own cap, day or night. */
export const STAGE_MOTION_CAP = 2;

/** Never granted at night, even with a slot free. */
const NIGHT_EXCLUDED: ReadonlySet<MotionPriority> = new Set(['breathing', 'clouds']);

export function motionCap(conditions: Pick<MotionConditions, 'reducedMotion' | 'night'> & { scope?: MotionScope | null }): number {
  if (conditions.reducedMotion) return MOTION_CAP.reducedMotion;
  if (conditions.scope === 'stage') return STAGE_MOTION_CAP;
  return conditions.night ? MOTION_CAP.night : MOTION_CAP.day;
}

export interface MotionBudget {
  /** Asks for `id`'s slot and returns its release, which is safe to call more than once. Holders of
   * one id share its slot, with the first holder's priority and scope: all occupied cards breathe
   * as one loop. */
  acquire(id: string, priority: MotionPriority, scope: MotionScope): () => void;
  setConditions(patch: Partial<MotionConditions>): void;
  isGranted(id: string): boolean;
  /** Granted ids, highest priority first; the same array until the grant changes. */
  granted(): readonly string[];
  /** Listeners run only when the grant changes. */
  subscribe(listener: () => void): () => void;
}

interface SlotRequest {
  priority: MotionPriority;
  scope: MotionScope;
  order: number;
  holders: number;
}

const DEFAULT_CONDITIONS: MotionConditions = { reducedMotion: false, night: false, hidden: false, scope: 'grid' };

const rank = (priority: MotionPriority) => MOTION_PRIORITIES.indexOf(priority);

export function createMotionBudget(initial: Partial<MotionConditions> = {}): MotionBudget {
  let conditions: MotionConditions = { ...DEFAULT_CONDITIONS, ...initial };
  const requests = new Map<string, SlotRequest>();
  const listeners = new Set<() => void>();
  let nextOrder = 0;
  let granted: readonly string[] = [];

  function regrant() {
    const cap = conditions.hidden || conditions.scope == null ? 0 : motionCap(conditions);
    const next = [...requests.entries()]
      .filter(([, request]) => request.scope === conditions.scope && !(conditions.night && NIGHT_EXCLUDED.has(request.priority)))
      .sort(([, a], [, b]) => rank(a.priority) - rank(b.priority) || a.order - b.order)
      .slice(0, cap)
      .map(([id]) => id);
    if (next.length === granted.length && next.every((id, i) => id === granted[i])) return;
    granted = next;
    for (const listener of [...listeners]) listener();
  }

  return {
    acquire(id, priority, scope) {
      const request = requests.get(id);
      if (request) request.holders += 1;
      else requests.set(id, { priority, scope, order: nextOrder++, holders: 1 });
      regrant();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const held = requests.get(id);
        if (!held) return;
        held.holders -= 1;
        if (held.holders === 0) requests.delete(id);
        regrant();
      };
    },
    setConditions(patch) {
      conditions = { ...conditions, ...patch };
      regrant();
    },
    isGranted: id => granted.includes(id),
    granted: () => granted,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app's one budget. */
export const motionBudget = createMotionBudget();

export function setMotionConditions(patch: Partial<MotionConditions>): void {
  motionBudget.setConditions(patch);
}

/** The scope `useMotionSlot` asks in; the grid unless a provider says otherwise. */
export const MotionScopeContext = createContext<MotionScope>('grid');

/** Holds `id`'s slot until the returned cleanup runs, or for `oneShotMs` when given. */
export function holdMotionSlot(
  budget: MotionBudget,
  id: string,
  priority: MotionPriority,
  scope: MotionScope,
  oneShotMs?: number
): () => void {
  const release = budget.acquire(id, priority, scope);
  if (oneShotMs == null) return release;
  const timer = setTimeout(release, oneShotMs);
  return () => {
    clearTimeout(timer);
    release();
  };
}

/** Whether the animation `id` may play now. It asks for a slot while `active`; a one-shot (with
 * `oneShotMs`) plays once each time `active` turns true. The slot is taken before the browser
 * paints, so a one-shot never shows its end frame first. */
export function useMotionSlot(id: string, priority: MotionPriority, active: boolean, oneShotMs?: number): boolean {
  const scope = useContext(MotionScopeContext);
  useLayoutEffect(
    () => (active ? holdMotionSlot(motionBudget, id, priority, scope, oneShotMs) : undefined),
    [id, priority, scope, active, oneShotMs]
  );
  const granted = useSyncExternalStore(
    motionBudget.subscribe,
    () => motionBudget.isGranted(id),
    () => false
  );
  return active && granted;
}
