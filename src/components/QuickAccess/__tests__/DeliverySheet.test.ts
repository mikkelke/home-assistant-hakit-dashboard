import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = Date.parse('2026-11-11T17:40:00+01:00');
const world = vi.hoisted(() => ({
  name: null as string | null,
  entity: undefined as { state: string; attributes: Record<string, unknown> } | undefined,
}));
vi.mock('@hakit/core', () => ({
  useHass: (selector: (state: unknown) => unknown) => selector({ entities: world.entity ? { 'sensor.home_delivery': world.entity } : {} }),
}));
vi.mock('@iconify/react', () => ({ Icon: ({ icon }: { icon: string }) => createElement('i', { 'data-icon': icon }) }));
vi.mock('../../../hooks/useViewer', () => ({ useViewer: () => ({ name: world.name, isAdmin: false, id: null }) }));
vi.mock('../../../hooks/useNowMs', () => ({ useNowMs: () => Date.parse('2026-11-11T17:40:00+01:00') }));
const { DeliverySheetBody } = await import('../DeliverySheet');

const inMinutes = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();
const food = (patch: Record<string, unknown> = {}) => ({
  id: 'wolt:t1',
  source: 'wolt',
  kind: 'food',
  title: 'Test Kitchen',
  stage: 'on_the_way',
  eta: inMinutes(8),
  item_count: 3,
  ...patch,
});
const shop = {
  id: 'postnord:TESTPN0001',
  source: 'postnord',
  title: 'Test Shop',
  status: 'registered',
  planned_from: '2026-11-12T14:00:00+01:00',
  planned_to: '2026-11-12T18:00:00+01:00',
};
const gls = { id: 'gls:TESTGLS0001', source: 'gls', title: 'GLS', status: 'in_transit' };
const feed = (deliveries: unknown[], upcoming: unknown[] = []) => {
  world.entity = { state: String(deliveries.length), attributes: { deliveries, upcoming } };
};
const render = () => renderToStaticMarkup(createElement(DeliverySheetBody));

beforeEach(() => {
  world.name = 'Mikkel';
  world.entity = undefined;
});

describe('the delivery sheet', () => {
  it('shows a food order with its minutes, clock time, stage strip and item count', () => {
    feed([food()]);
    const markup = render();
    expect(markup).toContain('Test Kitchen');
    expect(markup).toContain('<strong>8 min</strong>');
    expect(markup).toContain('≈ 17:48');
    expect(markup).toContain('data-icon="mdi:moped"');
    for (const step of ['Ordered', 'Kitchen', 'On the way', 'At the door']) expect(markup).toContain(`<b>${step}</b>`);
    expect(markup).toContain('3 items');
  });

  it('marks the current stage for assistive tech, one step per order', () => {
    feed([food(), food({ id: 'wolt:t2', stage: 'preparing', eta: inMinutes(25) })]);
    const markup = render();
    expect(markup.match(/aria-current="step"/g)).toHaveLength(2);
    expect(markup).toMatch(
      /dl-step is-now" aria-current="step"><span class="dl-dot"><i data-icon="mdi:moped"><\/i><\/span><b>On the way<\/b>/
    );
    expect(markup).toMatch(
      /dl-step is-now" aria-current="step"><span class="dl-dot"><i data-icon="mdi:chef-hat"><\/i><\/span><b>Kitchen<\/b>/
    );
  });

  it('gives an order that is arriving the gold look, and says now once its time has passed', () => {
    feed([food({ stage: 'arriving', eta: inMinutes(-1) })]);
    const markup = render();
    expect(markup).toContain('dl-card is-now');
    expect(markup).toContain('<strong>Now</strong>');
  });

  it('gives groceries their window and the word for their stage, without a stage strip', () => {
    feed([
      {
        id: 'nemlig:t2',
        source: 'nemlig',
        kind: 'groceries',
        title: 'Test Grocer',
        stage: 'preparing',
        window_start: '2026-11-11T18:00:00+01:00',
        window_end: '2026-11-11T20:00:00+01:00',
      },
    ]);
    const markup = render();
    expect(markup).toContain('<strong>18–20</strong>');
    expect(markup).toContain('Booked for today');
    expect(markup).toContain('data-icon="mdi:cart"');
    expect(markup).not.toContain('dl-rail');
  });

  it('names the carrier under a parcel out for delivery that has a sender, and not when the sender is the carrier', () => {
    feed([
      { id: 'postnord:TESTPN0002', source: 'postnord', kind: 'parcel', title: 'Test Shop', stage: 'on_the_way' },
      { id: 'gls:TESTGLS0002', source: 'gls', kind: 'parcel', title: 'GLS', stage: 'on_the_way' },
    ]);
    const markup = render();
    expect(markup).toContain('<small>PostNord</small>');
    expect(markup).not.toContain('<small>GLS</small>');
    expect(markup.match(/Out for delivery/g)).toHaveLength(2);
  });

  it('lists the parcels still days away after the deliveries, under a label', () => {
    feed([food()], [shop, gls]);
    const markup = render();
    expect(markup.indexOf('Test Kitchen')).toBeLessThan(markup.indexOf('Later'));
    expect(markup.indexOf('Later')).toBeLessThan(markup.indexOf('Test Shop'));
    expect(markup).toContain('PostNord · Not sent yet');
    expect(markup).toContain('Tomorrow 14–18');
  });

  it('lists the parcels alone without a label, the carrier alone when it is the title and no day when none is planned', () => {
    feed([], [gls, shop]);
    const markup = render();
    expect(markup).not.toContain('Later');
    expect(markup).not.toContain('dl-card');
    expect(markup).toContain('<small>On the way</small>');
    expect(markup).not.toContain('GLS ·');
    expect(markup.match(/mdi:calendar-clock-outline/g)).toHaveLength(1);
  });

  it('flags a problem or a return in gold', () => {
    feed(
      [],
      [
        { ...gls, status: 'problem' },
        { ...gls, id: 'gls:TESTGLS0002', status: 'returning' },
        { ...gls, id: 'gls:TESTGLS0003' },
      ]
    );
    const markup = render();
    expect(markup.match(/is-attention/g)).toHaveLength(2);
    expect(markup).toContain('data-icon="mdi:alert-circle-outline"');
    expect(markup).toContain('data-icon="mdi:keyboard-return"');
  });

  it('says there is nothing on the way when the feed is empty', () => {
    expect(render()).toContain('Nothing on the way');
    feed([]);
    expect(render()).toContain('Nothing on the way');
  });

  it.each(['Kristine', 'Claudia', 'Rooftop', null])('shows %s nothing, whatever is on its way', name => {
    world.name = name;
    feed([food()], [shop]);
    const markup = render();
    expect(markup).toContain('Nothing on the way');
    expect(markup).not.toContain('Test Kitchen');
    expect(markup).not.toContain('Test Shop');
  });

  it('shows no sender text beyond the title the sensor gives', () => {
    feed([food()], [gls]);
    const markup = render();
    expect(markup).not.toContain('TESTGLS0001');
    expect(markup).not.toContain('wolt:t1');
  });
});
