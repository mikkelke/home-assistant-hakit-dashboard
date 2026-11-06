import { describe, expect, it } from 'vitest';
import { COFFEE_PHASES, type CoffeePhase } from '../state';
import { settledCupAdjust, type HeldCupAdjust } from '../adjust';

const sentFrom = (brewId: string | null): HeldCupAdjust => ({ recipeId: '1', values: { dose: 5.5 }, sentFrom: { brewId } });
const look = (current: HeldCupAdjust | null, phase: CoffeePhase, brewId: string | null) => settledCupAdjust(current, { phase, brewId });

describe('the cup adjustment held through its brew', () => {
  it('is left alone before a start has gone out with it', () => {
    const waiting: HeldCupAdjust = { recipeId: '1', values: { dose: 5.5 }, sentFrom: null };
    for (const phase of COFFEE_PHASES) expect(look(waiting, phase, 'c2')).toBe(waiting);
    expect(look(null, 'ready', 'c2')).toBeNull();
  });

  it('stays while the old brew still shows, however long the start takes to be seen', () => {
    const held = sentFrom('c1');
    for (const phase of ['idle', 'asleep', 'picked_up', 'stopped', 'ready'] as const) expect(look(held, phase, 'c1')).toBe(held);
  });

  it('stays from the start to the last drop of its brew', () => {
    const held = sentFrom('c1');
    for (const phase of ['awaiting_cup', 'starting', 'grinding', 'brewing', 'paused'] as const) expect(look(held, phase, 'c2')).toBe(held);
  });

  it('lets go when that brew is ready, picked up, stopped, or has lapsed unseen', () => {
    const held = sentFrom('c1');
    for (const phase of ['ready', 'picked_up', 'stopped', 'idle', 'asleep'] as const) expect(look(held, phase, 'c2')).toBeNull();
  });

  it('keeps the values for another try when the machine refuses the start', () => {
    const refused = look(sentFrom('c1'), 'start_failed', 'c2');
    expect(refused).toEqual({ recipeId: '1', values: { dose: 5.5 }, sentFrom: null });
    for (const phase of COFFEE_PHASES) expect(look(refused, phase, 'c2')).toBe(refused);
  });

  it('keeps them when the wait for a cup is dropped, which shows the old brew again', () => {
    const held = sentFrom('c1');
    expect(look(held, 'awaiting_cup', 'c2')).toBe(held);
    expect(look(held, 'idle', 'c1')).toBe(held);
  });

  it('follows a start sent when no brew had run yet', () => {
    const held = sentFrom(null);
    expect(look(held, 'idle', null)).toBe(held);
    expect(look(held, 'starting', 'c1')).toBe(held);
    expect(look(held, 'ready', 'c1')).toBeNull();
  });
});
