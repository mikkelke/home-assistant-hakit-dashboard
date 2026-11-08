import { describe, expect, it } from 'vitest';
import { parseCookState } from '../model';
import { armFromLink, NO_TAKEOVER, returnDueAtMs, stepTakeover, takeoverMoment, TAKEOVER_RETURN_MS, type TakeoverInput } from '../takeover';

const NOW = 1_800_000_000_000;
const input = (patch: Partial<TakeoverInput> = {}): TakeoverInput => ({
  nextKind: 'pull',
  active: true,
  coffeeBrewing: false,
  onStage: false,
  lastPointerMs: 0,
  nowMs: NOW,
  ...patch,
});

describe('cooking tablet takeover', () => {
  it('opens once at each hands-on milestone after two minutes untouched', () => {
    let step = stepTakeover(NO_TAKEOVER, input());
    expect(step.action).toBe('open');
    step = stepTakeover(step.memo, input({ onStage: true, nowMs: NOW + 10_000 }));
    expect(step.action).toBe('none');
    expect(stepTakeover(NO_TAKEOVER, input({ lastPointerMs: NOW - 119_999 })).action).toBe('none');
    expect(stepTakeover(NO_TAKEOVER, input({ lastPointerMs: NOW - 120_000 })).action).toBe('open');
  });

  it('requires a real phase milestone instead of a predicted pull or ready ETA', () => {
    for (const probe_phase of ['tracking', 'near'])
      expect(takeoverMoment(parseCookState({ state: 'probe', attributes: { probe_phase, next_kind: 'pull' } }))).toBeNull();
    expect(takeoverMoment(parseCookState({ state: 'probe', attributes: { probe_phase: 'pull' } }))).toBe('pull');
    expect(takeoverMoment(parseCookState({ state: 'bath', attributes: { bath_phase: 'ready', next_kind: 'bag_in' } }))).toBe('bath_ready');
    expect(takeoverMoment(parseCookState({ state: 'bath', attributes: { bath_phase: 'heating', next_kind: 'bath_ready' } }))).toBeNull();
  });

  it('leaves coffee brewing in control and never replays a suppressed moment later', () => {
    const step = stepTakeover(NO_TAKEOVER, input({ coffeeBrewing: true }));
    expect(step.action).toBe('none');
    expect(stepTakeover(step.memo, input({ nowMs: NOW + 500_000 })).action).toBe('none');
  });

  it('returns five minutes after the final lane ends and cancels if another lane resumes', () => {
    const opened = stepTakeover(NO_TAKEOVER, input()).memo;
    expect(returnDueAtMs(opened)).toBeNull();
    const ended = stepTakeover(opened, input({ nextKind: null, active: false, onStage: true, nowMs: NOW + 60_000 })).memo;
    expect(returnDueAtMs(ended)).toBe(NOW + 60_000 + TAKEOVER_RETURN_MS);
    expect(
      stepTakeover(ended, input({ nextKind: null, active: false, onStage: true, nowMs: NOW + 60_000 + TAKEOVER_RETURN_MS - 1 })).action
    ).toBe('none');
    expect(
      stepTakeover(ended, input({ nextKind: null, active: false, onStage: true, nowMs: NOW + 60_000 + TAKEOVER_RETURN_MS })).action
    ).toBe('back');
    const resumed = stepTakeover(ended, input({ nextKind: null, active: true, onStage: true, nowMs: NOW + 120_000 })).memo;
    expect(returnDueAtMs(resumed)).toBeNull();
  });

  it('cancels the return on a touch, route close, or coffee brew', () => {
    const opened = stepTakeover(NO_TAKEOVER, input()).memo;
    for (const patch of [{ lastPointerMs: NOW + 1, onStage: true }, { onStage: false }, { coffeeBrewing: true, onStage: true }]) {
      expect(stepTakeover(opened, input({ ...patch, nowMs: NOW + 6_000 })).memo.active).toBeNull();
    }
    expect(stepTakeover(opened, input({ onStage: false, nowMs: NOW + 100 })).memo.active).not.toBeNull();
  });

  it('arms a wake link for a return to the grid', () => {
    const armed = armFromLink(NO_TAKEOVER, 'cook-1', NOW);
    const ended = stepTakeover(armed, input({ nextKind: null, onStage: true, active: false, nowMs: NOW + 60_000 })).memo;
    expect(
      stepTakeover(ended, input({ nextKind: null, onStage: true, active: false, nowMs: NOW + 60_000 + TAKEOVER_RETURN_MS })).action
    ).toBe('grid');
  });
});
