import { describe, expect, it } from 'vitest';
import {
  NO_TAKEOVER,
  TAKEOVER_RETURN_MS,
  TAKEOVER_UNTOUCHED_MS,
  armFromLink,
  returnDueAtMs,
  stepTakeover,
  type TakeoverInput,
  type TakeoverMemo,
} from '../takeover';

const T0 = Date.parse('2026-10-20T05:40:00Z');
const MIN = 60_000;

/** A tablet session on a fake clock: each `at` moves the clock and looks once. */
function tablet(start: Partial<TakeoverInput> = {}) {
  let memo: TakeoverMemo = NO_TAKEOVER;
  let input: TakeoverInput = {
    brewId: null,
    source: null,
    phase: 'idle',
    pickedUpAtMs: null,
    stoppedAtMs: null,
    onStage: false,
    lastPointerMs: 0,
    nowMs: T0,
    ...start,
  };
  const actions: string[] = [];
  return {
    at(nowMs: number, patch: Partial<TakeoverInput> = {}) {
      input = { ...input, ...patch, nowMs };
      const step = stepTakeover(memo, input);
      memo = step.memo;
      if (step.action === 'open') input = { ...input, onStage: true };
      if (step.action === 'back' || step.action === 'grid') input = { ...input, onStage: false };
      actions.push(step.action);
      return step.action;
    },
    touch(atMs: number) {
      input = { ...input, lastPointerMs: atMs };
    },
    arm(brewId: string, nowMs: number) {
      memo = armFromLink(memo, brewId, nowMs);
      input = { ...input, onStage: true, nowMs };
    },
    get memo() {
      return memo;
    },
    actions,
  };
}

describe('the tablet takes over', () => {
  it('opens the stage for a brew started on the machine while nobody touched it for 2 min', () => {
    const t = tablet({ lastPointerMs: T0 - 5 * MIN });
    expect(t.at(T0, { brewId: 'c1', source: 'machine', phase: 'grinding' })).toBe('open');
  });

  it('waits for untouched: a touch 119 s before the start keeps it where it is, for that whole brew', () => {
    const t = tablet({ lastPointerMs: T0 - TAKEOVER_UNTOUCHED_MS + 1000 });
    expect(t.at(T0, { brewId: 'c1', source: 'machine', phase: 'grinding' })).toBe('none');
    expect(t.at(T0 + 2 * MIN, { phase: 'brewing' })).toBe('none');
  });

  it('never for a brew started from the tablet, a phone or HA, nor for a power-only brew', () => {
    for (const source of ['tablet', 'phone', 'ha', 'power'] as const) {
      const t = tablet();
      expect(t.at(T0, { brewId: `c-${source}`, source, phase: 'brewing' })).toBe('none');
    }
  });

  it('never on the machine waking or working alone, without a brew', () => {
    const t = tablet();
    expect(t.at(T0, { phase: 'idle', source: 'machine' })).toBe('none');
    expect(t.at(T0 + MIN, { phase: 'starting', brewId: null })).toBe('none');
  });

  it('not when the stage is already showing, and only once per brew', () => {
    const shown = tablet({ onStage: true });
    expect(shown.at(T0, { brewId: 'c1', source: 'machine', phase: 'brewing' })).toBe('none');

    const t = tablet();
    expect(t.at(T0, { brewId: 'c1', source: 'machine', phase: 'grinding' })).toBe('open');
    t.touch(T0 + 10_000);
    t.at(T0 + 11_000, { onStage: false });
    expect(t.at(T0 + 4 * MIN, { phase: 'brewing' })).toBe('none');
    expect(t.at(T0 + 30 * MIN, { brewId: 'c2', source: 'machine', phase: 'grinding' })).toBe('open');
  });

  it('a brew first seen once it is ready, as after a reload, is never taken over', () => {
    const t = tablet();
    expect(t.at(T0, { brewId: 'c1', source: 'machine', phase: 'ready' })).toBe('none');
    expect(t.at(T0 + MIN, { phase: 'brewing' })).toBe('none');
  });
});

describe('and goes back', () => {
  it('5 min after Picked up, when nobody touched it since the takeover', () => {
    const t = tablet();
    t.at(T0, { brewId: 'c1', source: 'machine', phase: 'grinding' });
    t.at(T0 + 4 * MIN, { phase: 'ready' });
    const picked = T0 + 6 * MIN;
    expect(t.at(picked + 1000, { phase: 'picked_up', pickedUpAtMs: picked })).toBe('none');
    expect(returnDueAtMs(t.memo)).toBe(picked + TAKEOVER_RETURN_MS);
    expect(t.at(picked + TAKEOVER_RETURN_MS - 1000)).toBe('none');
    expect(t.at(picked + TAKEOVER_RETURN_MS, { phase: 'idle' })).toBe('back');
    expect(t.memo.active).toBeNull();
  });

  it('never once anyone touched it, even after Picked up', () => {
    const t = tablet();
    t.at(T0, { brewId: 'c1', source: 'machine', phase: 'grinding' });
    const picked = T0 + 6 * MIN;
    t.at(picked, { phase: 'picked_up', pickedUpAtMs: picked });
    t.touch(picked + 2 * MIN);
    expect(t.at(picked + TAKEOVER_RETURN_MS + 1000)).toBe('none');
    expect(t.memo.active).toBeNull();
  });

  it('a touch during the brew cancels the return for good', () => {
    const t = tablet();
    t.at(T0, { brewId: 'c1', source: 'machine', phase: 'grinding' });
    t.touch(T0 + MIN);
    t.at(T0 + MIN + 1);
    const picked = T0 + 6 * MIN;
    t.at(picked, { phase: 'picked_up', pickedUpAtMs: picked });
    expect(t.at(picked + 2 * TAKEOVER_RETURN_MS)).toBe('none');
  });

  it('a stopped brew, or one that went quiet without a pickup, also goes back after 5 min', () => {
    const stopped = tablet();
    stopped.at(T0, { brewId: 'c1', source: 'machine', phase: 'grinding' });
    stopped.at(T0 + MIN, { phase: 'stopped', stoppedAtMs: T0 + MIN });
    expect(stopped.at(T0 + MIN + TAKEOVER_RETURN_MS)).toBe('back');

    const quiet = tablet();
    quiet.at(T0, { brewId: 'c1', source: 'machine', phase: 'grinding' });
    quiet.at(T0 + 4 * MIN, { phase: 'ready' });
    quiet.at(T0 + 34 * MIN, { phase: 'idle' });
    expect(quiet.at(T0 + 34 * MIN + TAKEOVER_RETURN_MS)).toBe('back');
  });

  it('does not go back while its brew is still on, and not when the stage was closed some other way', () => {
    const t = tablet();
    t.at(T0, { brewId: 'c1', source: 'machine', phase: 'grinding' });
    expect(t.at(T0 + 20 * MIN, { phase: 'brewing' })).toBe('none');
    t.at(T0 + 21 * MIN, { onStage: false });
    t.at(T0 + 22 * MIN, { phase: 'picked_up', pickedUpAtMs: T0 + 22 * MIN, onStage: true });
    expect(t.at(T0 + 40 * MIN)).toBe('none');
  });

  it('waits for the stage it opened to show before counting it as closed', () => {
    const t = tablet();
    expect(t.at(T0, { brewId: 'c1', source: 'machine', phase: 'grinding' })).toBe('open');
    t.at(T0 + 100, { onStage: false });
    t.at(T0 + 200, { onStage: true });
    expect(t.memo.active).not.toBeNull();
  });

  it('a wake link (#coffee&takeover=) arms the return to the grid', () => {
    const t = tablet();
    t.arm('c1', T0);
    expect(t.at(T0 + 1000, { brewId: 'c1', source: 'machine', phase: 'grinding' })).toBe('none');
    const picked = T0 + 5 * MIN;
    t.at(picked, { phase: 'picked_up', pickedUpAtMs: picked });
    expect(t.at(picked + TAKEOVER_RETURN_MS)).toBe('grid');
  });
});
