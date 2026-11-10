import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCookState, type CookState } from '../../../cook/model';

const NOW = Date.parse('2026-11-11T17:40:00+01:00');
const world = vi.hoisted(() => ({
  name: null as string | null,
  isAdmin: false,
  entity: undefined as { state: string; attributes: Record<string, unknown> } | undefined,
  cook: null as CookState | null,
  coffee: false,
}));
vi.mock('@hakit/core', () => ({
  useHass: (selector: (state: unknown) => unknown) => selector({ entities: world.entity ? { 'sensor.home_delivery': world.entity } : {} }),
}));
vi.mock('@iconify/react', () => ({ Icon: ({ icon }: { icon: string }) => createElement('i', { 'data-icon': icon }) }));
vi.mock('../../../hooks/useViewer', () => ({ useViewer: () => ({ name: world.name, isAdmin: world.isAdmin, id: null }) }));
vi.mock('../../../hooks/useNowMs', () => ({ useNowMs: () => Date.parse('2026-11-11T17:40:00+01:00') }));
vi.mock('../../../coffee/useCoffeeState', () => ({ useCoffeeState: () => (world.coffee ? { phase: 'brewing' } : null) }));
vi.mock('../CoffeeTickerChip', () => ({ CoffeeTickerChip: () => createElement('button', { 'data-coffee': true }, 'Coffee') }));
vi.mock('../../../home/motionBudget', () => ({ useMotionSlot: () => false }));
vi.mock('../../../cook/useCook', () => ({ useCookState: () => world.cook, useCookLive: () => null }));
const { HouseTicker } = await import('../HouseTicker');

const inMinutes = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();
const food = (patch: Record<string, unknown> = {}) => ({
  id: 'wolt:t1',
  source: 'wolt',
  kind: 'food',
  title: 'Test Kitchen',
  stage: 'on_the_way',
  eta: inMinutes(8),
  ...patch,
});
const upcoming = { id: 'gls:TESTGLS0001', source: 'gls', title: 'GLS', status: 'in_transit' };
const feed = (deliveries: unknown[], coming: unknown[] = []) => {
  world.entity = { state: String(deliveries.length), attributes: { deliveries, upcoming: coming } };
};
const cooking = () =>
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
  world.entity = undefined;
  world.cook = null;
  world.coffee = false;
});

describe('the delivery chip', () => {
  it('shows the first delivery on the way with its minutes and clock time, as a button that names it', () => {
    feed([food()]);
    const markup = render();
    expect(markup).toContain('<button type="button" class="ticker-chip is-delivery"');
    expect(markup).toContain('aria-label="Food, Test Kitchen, 8 min, about 17:48"');
    expect(markup).toContain('data-icon="mdi:moped"');
    expect(markup).toContain('<b>8 min</b>');
    expect(markup).toContain('<em>17:48</em>');
  });

  it('draws one chip for several deliveries and counts the rest', () => {
    feed([food(), { id: 'gls:TESTGLS0002', source: 'gls', kind: 'parcel', title: 'GLS', stage: 'on_the_way' }]);
    const markup = render();
    expect(markup.match(/is-delivery/g)).toHaveLength(1);
    expect(markup).toContain('<em>+1</em>');
  });

  it('turns to its arriving look when the courier is close', () => {
    feed([food({ stage: 'arriving', eta: inMinutes(1) })]);
    expect(render()).toContain('ticker-chip is-delivery-now');
  });

  it('is a quiet count of parcels, without a countdown, when none is on its way today', () => {
    feed([], [upcoming, { ...upcoming, id: 'gls:TESTGLS0002' }]);
    const markup = render();
    expect(markup).toContain('ticker-chip is-delivery-quiet');
    expect(markup).toContain('aria-label="2 parcels on their way"');
    expect(markup).toContain('data-icon="mdi:package-variant-closed"');
    expect(markup).toContain('<b>2</b>');
    expect(markup).not.toContain('<em>');
  });

  it('leaves the quiet count to a delivery that is on its way', () => {
    feed([food()], [upcoming]);
    const markup = render();
    expect(markup).toContain('ticker-chip is-delivery"');
    expect(markup).not.toContain('is-delivery-quiet');
  });

  it('leads cooking and coffee when a delivery is on its way, and trails them when it is only a quiet count', () => {
    world.cook = cooking();
    world.coffee = true;
    feed([food()]);
    let markup = render();
    expect(markup.indexOf('Food, Test Kitchen')).toBeLessThan(markup.indexOf('Cook, Done'));
    expect(markup.indexOf('Cook, Done')).toBeLessThan(markup.indexOf('data-coffee'));
    feed([], [upcoming]);
    markup = render();
    expect(markup.indexOf('data-coffee')).toBeLessThan(markup.indexOf('1 parcel on its way'));
  });

  it('is not there when nothing is on its way, or the sensor is unavailable', () => {
    expect(render()).toBe('');
    feed([]);
    expect(render()).toBe('');
    world.entity = { state: 'unavailable', attributes: { deliveries: [food()] } };
    expect(render()).toBe('');
  });

  it.each(['Kristine', 'Claudia', 'Rooftop', 'Another admin', null])('is not there for %s, even an admin', name => {
    world.name = name;
    world.isAdmin = true;
    feed([food()], [upcoming]);
    expect(render()).toBe('');
  });

  it.each(['Kristine', 'Claudia', 'Rooftop', null])('leaves the rest of the ticker alone for %s', name => {
    world.name = name;
    world.coffee = true;
    feed([food()], [upcoming]);
    const markup = render();
    expect(markup).toContain('data-coffee');
    expect(markup).not.toContain('is-delivery');
  });
});
