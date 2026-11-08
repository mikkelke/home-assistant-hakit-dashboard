import { describe, expect, it } from 'vitest';
import { cookDemo } from '../demo';
import { COOK_DEMO_SCENARIOS } from '../demoStore';
import { COOK_LIVE_ENTITY, COOK_LOG_ENTITY, COOK_STATE_ENTITY } from '../entities';
import { isCookActive, parseCookLive, parseCookLog, parseCookState } from '../model';
import { cookMoments } from '../moments';

describe('cook fixtures', () => {
  it('supplies readable entities for every preview phase without hardware', () => {
    for (const scenario of COOK_DEMO_SCENARIOS) {
      const { entities } = cookDemo(scenario, Date.parse('2026-11-08T17:00:00Z'));
      const state = parseCookState(entities[COOK_STATE_ENTITY]);
      expect(state).not.toBeNull();
      expect(isCookActive(state)).toBe(scenario !== 'off');
      expect(parseCookLive(entities[COOK_LIVE_ENTITY])?.stepS).toBe(30);
      expect(parseCookLog(entities[COOK_LOG_ENTITY])?.cooks).toHaveLength(1);
      for (const [key, value] of Object.entries(entities[COOK_STATE_ENTITY]?.attributes ?? {})) {
        expect(typeof value === 'string' || key === 'presets').toBe(true);
      }
    }
  });

  it('keeps bath episode timestamps consistent with the phase and selected duration', () => {
    const nowMs = Date.parse('2026-11-08T17:40:00Z');
    for (const scenario of COOK_DEMO_SCENARIOS) {
      const state = parseCookState(cookDemo(scenario, nowMs).entities[COOK_STATE_ENTITY])!;
      const { bath } = state;
      if (bath.inAtMs != null) {
        expect(bath.readyAtMs).toBeLessThanOrEqual(bath.inAtMs);
        expect(bath.inAtMs).toBeLessThan(nowMs);
        expect(bath.doneAtMs! - bath.inAtMs).toBe(bath.minutes! * 60_000);
      }
      if (['off', 'heating', 'too_hot', 'ready'].includes(bath.phase)) {
        expect(bath.inAtMs).toBeNull();
        expect(bath.doneAtMs).toBeNull();
      }
      if (bath.phase === 'chilling' || bath.phase === 'chilled') {
        expect(bath.doneAtMs).toBeLessThan(nowMs);
        expect(bath.chillUntilMs! - bath.doneAtMs!).toBe(15 * 60_000);
      } else {
        expect(bath.chillUntilMs).toBeNull();
        expect(cookMoments(state, nowMs).some(item => item.kind === 'chill_done')).toBe(false);
      }
    }
  });
});
