import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCookState, type CookState } from '../../../cook/model';

const world = vi.hoisted(() => ({ name: null as string | null, isAdmin: false, cook: null as CookState | null, coffee: false }));
const NOW = Date.parse('2026-11-08T18:00:00+01:00');
vi.mock('@hakit/core', () => ({ useHass: (selector: (state: unknown) => unknown) => selector({ entities: {} }) }));
vi.mock('@iconify/react', () => ({ Icon: () => null }));
vi.mock('../../../hooks/useViewer', () => ({ useViewer: () => ({ name: world.name, isAdmin: world.isAdmin, id: null }) }));
vi.mock('../../../hooks/useNowMs', () => ({ useNowMs: () => Date.parse('2026-11-08T18:00:00+01:00') }));
vi.mock('../../../coffee/useCoffeeState', () => ({ useCoffeeState: () => (world.coffee ? { phase: 'brewing' } : null) }));
vi.mock('../CoffeeTickerChip', () => ({ CoffeeTickerChip: () => createElement('button', { 'data-coffee': true }, 'Coffee') }));
vi.mock('../../../home/motionBudget', () => ({ useMotionSlot: () => false }));
vi.mock('../../../cook/useCook', () => ({ useCookState: () => world.cook, useCookLive: () => null }));
const { HouseTicker } = await import('../HouseTicker');
const active = () =>
  parseCookState({
    state: 'bath',
    attributes: {
      v: '1',
      bath_phase: 'cooking',
      bath_in_at: new Date(NOW - 30 * 60_000).toISOString(),
      bath_done_at: new Date(NOW + 30 * 60_000).toISOString(),
      next_kind: 'bath_done',
    },
  });
const render = () =>
  renderToStaticMarkup(createElement(HouseTicker, { onOpenNow: () => {}, onOpenCook: () => {}, onOpenCoffee: () => {} }));
beforeEach(() => {
  world.name = 'Mikkel';
  world.isAdmin = false;
  world.cook = active();
  world.coffee = false;
});
describe('the cooking chip audience', () => {
  it.each(['Mikkel', 'Rooftop'])('shows the active lane for %s with time and progress', name => {
    world.name = name;
    const markup = render();
    expect(markup).toContain('Cook, Done 18:30');
    expect(markup).toContain('width:50%');
  });
  it.each(['Kristine', 'Claudia', 'Another admin', null])('does not show cooking for %s, even an admin', name => {
    world.name = name;
    world.isAdmin = true;
    expect(render()).toBe('');
  });
  it('disappears when both lanes are off and leads coffee while active', () => {
    world.coffee = true;
    const markup = render();
    expect(markup.indexOf('Cook, Done')).toBeLessThan(markup.indexOf('data-coffee'));
    world.cook = parseCookState({ state: 'off', attributes: { v: '1' } });
    expect(render()).not.toContain('Cook,');
  });
});
