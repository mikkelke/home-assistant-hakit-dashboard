import { describe, expect, it } from 'vitest';
import {
  NO_DELIVERIES,
  carrierName,
  chipView,
  deliveryIcon,
  itemsText,
  parcelStatusWord,
  parseDeliveryFeed,
  plannedText,
  railSteps,
  stageWord,
  timing,
  upcomingView,
  visibleDeliveries,
  windowText,
  type Delivery,
  type DeliveryFeed,
  type UpcomingParcel,
} from '../model';

const at = (iso: string) => Date.parse(iso);
/** Wednesday 11 Nov 2026, 17:40 in Copenhagen. */
const NOW = at('2026-11-11T17:40:00+01:00');
const inMinutes = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const delivery = (patch: Partial<Delivery> = {}): Delivery => ({
  id: 'wolt:t1',
  source: 'wolt',
  kind: 'food',
  title: 'Test Kitchen',
  stage: 'on_the_way',
  etaMs: null,
  windowStartMs: null,
  windowEndMs: null,
  itemCount: null,
  ...patch,
});

const parcel = (patch: Partial<UpcomingParcel> = {}): UpcomingParcel => ({
  id: 'postnord:TESTPN0001',
  source: 'postnord',
  title: 'Test Shop',
  status: 'registered',
  plannedFromMs: null,
  plannedToMs: null,
  ...patch,
});

const feed = (active: Delivery[] = [], upcoming: UpcomingParcel[] = []): DeliveryFeed => ({ active, upcoming });
const entity = (attributes: unknown, state: unknown = '1') => ({ state, attributes });

describe('parseDeliveryFeed', () => {
  it('reads deliveries and upcoming parcels as the sensor publishes them', () => {
    const parsed = parseDeliveryFeed(
      entity({
        deliveries: [
          {
            id: 'wolt:t1',
            source: 'wolt',
            kind: 'food',
            title: 'Test Kitchen',
            stage: 'on_the_way',
            eta: inMinutes(8),
            minutes_left: 8,
            item_count: 3,
          },
          {
            id: 'nemlig:t2',
            source: 'nemlig',
            kind: 'groceries',
            title: 'Test Grocer',
            stage: 'preparing',
            window_start: '2026-11-11T18:00:00+01:00',
            window_end: '2026-11-11T20:00:00+01:00',
          },
        ],
        upcoming: [
          {
            id: 'postnord:TESTPN0001',
            source: 'postnord',
            title: 'Test Shop',
            status: 'registered',
            planned_from: '2026-11-12T14:00:00+01:00',
            planned_to: '2026-11-12T18:00:00+01:00',
          },
        ],
      })
    );
    expect(parsed.active).toEqual([
      delivery({ etaMs: NOW + 8 * 60_000, itemCount: 3 }),
      delivery({
        id: 'nemlig:t2',
        source: 'nemlig',
        kind: 'groceries',
        title: 'Test Grocer',
        stage: 'preparing',
        windowStartMs: at('2026-11-11T18:00:00+01:00'),
        windowEndMs: at('2026-11-11T20:00:00+01:00'),
      }),
    ]);
    expect(parsed.upcoming).toEqual([
      parcel({ plannedFromMs: at('2026-11-12T14:00:00+01:00'), plannedToMs: at('2026-11-12T18:00:00+01:00') }),
    ]);
  });

  it('copes with every key AppDaemon drops for a null, false or zero value', () => {
    const parsed = parseDeliveryFeed(
      entity({
        deliveries: [{ id: 'wolt:t1', source: 'wolt', kind: 'food', title: 'Test Kitchen', stage: 'arriving' }],
        upcoming: [{ id: 'gls:TESTGLS0001', source: 'gls', title: 'GLS', status: 'in_transit' }],
      })
    );
    expect(parsed.active).toEqual([delivery({ stage: 'arriving' })]);
    expect(parsed.upcoming).toEqual([parcel({ id: 'gls:TESTGLS0001', source: 'gls', title: 'GLS', status: 'in_transit' })]);
  });

  it('gives a feed with no deliveries and no upcoming key as nothing at all', () => {
    expect(parseDeliveryFeed(entity({ deliveries: [] }, '0'))).toBe(NO_DELIVERIES);
    expect(parseDeliveryFeed(entity({}))).toBe(NO_DELIVERIES);
  });

  it.each([undefined, null, entity(null), entity('text'), entity([]), entity({}, 'unavailable'), entity({}, 'unknown')])(
    'gives nothing for an unusable entity %#',
    raw => {
      expect(parseDeliveryFeed(raw as never)).toBe(NO_DELIVERIES);
    }
  );

  it('does not trust the state of an unavailable sensor even when attributes remain', () => {
    const attributes = { deliveries: [{ id: 'wolt:t1', kind: 'food', stage: 'on_the_way' }] };
    expect(parseDeliveryFeed(entity(attributes, 'unavailable'))).toBe(NO_DELIVERIES);
  });

  it('leaves out ended and cancelled deliveries, unknown kinds, repeated ids and entries that are not records', () => {
    const parsed = parseDeliveryFeed(
      entity({
        deliveries: [
          { id: 'wolt:ok', kind: 'food', stage: 'on_the_way' },
          { id: 'wolt:ok', kind: 'food', stage: 'preparing' },
          { id: 'wolt:done', kind: 'food', stage: 'delivered' },
          { id: 'wolt:gone', kind: 'food', stage: 'cancelled' },
          { id: 'x:1', kind: 'drone', stage: 'on_the_way' },
          { id: '', kind: 'food', stage: 'on_the_way' },
          { kind: 'food', stage: 'on_the_way' },
          'text',
          null,
          [],
        ],
        upcoming: [{ id: 'gls:1', source: 'gls' }, { id: 'gls:1', source: 'gls' }, { source: 'gls' }, 'text', null],
      })
    );
    expect(parsed.active.map(item => [item.id, item.stage])).toEqual([['wolt:ok', 'on_the_way']]);
    expect(parsed.upcoming.map(item => item.id)).toEqual(['gls:1']);
  });

  it('names a delivery without a title by its kind and a parcel without one as a parcel', () => {
    const parsed = parseDeliveryFeed(
      entity({
        deliveries: [
          { id: 'a', kind: 'food', stage: 'preparing' },
          { id: 'b', kind: 'groceries', stage: 'preparing' },
          { id: 'c', kind: 'parcel', stage: 'on_the_way', title: '  ' },
        ],
        upcoming: [{ id: 'gls:1', source: 'gls' }],
      })
    );
    expect(parsed.active.map(item => item.title)).toEqual(['Food', 'Groceries', 'Parcel']);
    expect(parsed.upcoming[0]).toMatchObject({ title: 'Parcel', status: 'unknown' });
  });

  it('takes an item count only when it is a whole number above zero', () => {
    const counts = [3, 0, -1, 2.5, '4', null].map(item_count => ({
      id: `wolt:${String(item_count)}`,
      kind: 'food',
      stage: 'preparing',
      item_count,
    }));
    expect(parseDeliveryFeed(entity({ deliveries: counts })).active.map(item => item.itemCount)).toEqual([3, null, null, null, null, null]);
  });

  it('reads a time it cannot parse as no time', () => {
    const parsed = parseDeliveryFeed(
      entity({
        deliveries: [{ id: 'a', kind: 'food', stage: 'on_the_way', eta: 'soon', window_start: 5, window_end: null }],
        upcoming: [{ id: 'gls:1', source: 'gls', planned_from: 'Thursday', planned_to: '' }],
      })
    );
    expect(parsed.active[0]).toMatchObject({ etaMs: null, windowStartMs: null, windowEndMs: null });
    expect(parsed.upcoming[0]).toMatchObject({ plannedFromMs: null, plannedToMs: null });
  });
});

describe('visibleDeliveries', () => {
  const everything = feed(
    [delivery(), delivery({ id: 'nemlig:t2', kind: 'groceries' }), delivery({ id: 'gls:1', kind: 'parcel' })],
    [parcel()]
  );

  it('gives Mikkel all of it', () => {
    expect(visibleDeliveries(everything, { name: 'Mikkel' })).toEqual(everything);
  });

  it.each(['Kristine', 'Claudia', 'Rooftop', 'Another admin', null])('gives %s nothing', name => {
    expect(visibleDeliveries(everything, { name })).toBe(NO_DELIVERIES);
  });
});

describe('windowText', () => {
  it('writes a window on the hours as two hours and others as clock times, in home time', () => {
    expect(windowText(at('2026-11-11T17:00:00+01:00'), at('2026-11-11T19:00:00+01:00'))).toBe('17–19');
    expect(windowText(at('2026-11-11T17:30:00+01:00'), at('2026-11-11T19:00:00+01:00'))).toBe('17:30–19:00');
    expect(windowText(at('2026-11-11T08:00:00+01:00'), at('2026-11-11T10:15:00+01:00'))).toBe('08:00–10:15');
  });

  it('does not depend on the device zone', () => {
    expect(windowText(at('2026-11-11T16:00:00Z'), at('2026-11-11T18:00:00Z'))).toBe('17–19');
  });
});

describe('timing', () => {
  it('gives the minutes left with the ETA clock beside them', () => {
    expect(timing(delivery({ etaMs: NOW + 8 * 60_000 }), NOW)).toEqual({ headline: '8 min', clock: '17:48' });
  });

  it('rounds a part minute up, so the last minute reads as one minute, not as now', () => {
    expect(timing(delivery({ etaMs: NOW + 30_000 }), NOW)).toEqual({ headline: '1 min', clock: '17:40' });
    expect(timing(delivery({ etaMs: NOW + 61_000 }), NOW)).toEqual({ headline: '2 min', clock: '17:41' });
  });

  it('gives only the clock time from an hour out', () => {
    expect(timing(delivery({ etaMs: NOW + 59 * 60_000 }), NOW)).toEqual({ headline: '59 min', clock: '18:39' });
    expect(timing(delivery({ etaMs: NOW + 60 * 60_000 }), NOW)).toEqual({ headline: '18:40', clock: null });
    expect(timing(delivery({ etaMs: NOW + 3 * 60 * 60_000 }), NOW)).toEqual({ headline: '20:40', clock: null });
  });

  it('says now once the ETA of a courier that is out has passed', () => {
    expect(timing(delivery({ etaMs: NOW - 2 * 60_000 }), NOW)).toEqual({ headline: 'Now', clock: null });
    expect(timing(delivery({ stage: 'arriving', etaMs: NOW }), NOW)).toEqual({ headline: 'Now', clock: null });
  });

  it('gives a kitchen that has outrun its ETA the window, or nothing, never now', () => {
    const late = { stage: 'preparing', etaMs: NOW - 5 * 60_000 } as const;
    expect(timing(delivery(late), NOW)).toBeNull();
    const window = { windowStartMs: at('2026-11-11T18:00:00+01:00'), windowEndMs: at('2026-11-11T20:00:00+01:00') };
    expect(timing(delivery({ ...late, ...window }), NOW)).toEqual({ headline: '18–20', clock: null });
  });

  it('gives the window when there is no ETA', () => {
    const window = { windowStartMs: at('2026-11-11T17:30:00+01:00'), windowEndMs: at('2026-11-11T19:00:00+01:00') };
    expect(timing(delivery({ kind: 'groceries', stage: 'preparing', ...window }), NOW)).toEqual({ headline: '17:30–19:00', clock: null });
  });

  it('prefers the ETA to the window', () => {
    const window = { windowStartMs: at('2026-11-11T18:00:00+01:00'), windowEndMs: at('2026-11-11T20:00:00+01:00') };
    expect(timing(delivery({ etaMs: NOW + 10 * 60_000, ...window }), NOW)).toEqual({ headline: '10 min', clock: '17:50' });
  });

  it('gives nothing when it has no time at all, or a window with only one end', () => {
    expect(timing(delivery(), NOW)).toBeNull();
    expect(timing(delivery({ windowStartMs: NOW }), NOW)).toBeNull();
  });
});

describe('deliveryIcon and stageWord', () => {
  it.each([
    ['food', 'preparing', 'mdi:chef-hat'],
    ['food', 'on_the_way', 'mdi:moped'],
    ['food', 'arriving', 'mdi:moped'],
    ['groceries', 'preparing', 'mdi:cart'],
    ['groceries', 'on_the_way', 'mdi:truck-delivery'],
    ['parcel', 'preparing', 'mdi:package-variant-closed'],
    ['parcel', 'on_the_way', 'mdi:package-variant-closed'],
  ] as const)('draws %s %s as %s', (kind, stage, icon) => {
    expect(deliveryIcon({ kind, stage })).toBe(icon);
  });

  it.each([
    ['food', 'preparing', 'Preparing'],
    ['food', 'on_the_way', 'On the way'],
    ['groceries', 'preparing', 'Booked for today'],
    ['groceries', 'on_the_way', 'On the way'],
    ['parcel', 'preparing', 'Expected today'],
    ['parcel', 'on_the_way', 'Out for delivery'],
    ['food', 'arriving', 'Arriving'],
    ['parcel', 'arriving', 'Arriving'],
  ] as const)('says %s %s as "%s"', (kind, stage, word) => {
    expect(stageWord({ kind, stage })).toBe(word);
  });
});

describe('chipView', () => {
  it('gives nothing when nothing is on its way', () => {
    expect(chipView(NO_DELIVERIES, NOW)).toBeNull();
  });

  it('leads with the first delivery on the way: icon, minutes and the clock time', () => {
    expect(chipView(feed([delivery({ etaMs: NOW + 8 * 60_000 })]), NOW)).toEqual({
      tone: 'live',
      icon: 'mdi:moped',
      headline: '8 min',
      clock: '17:48',
      more: 0,
      label: 'Food, Test Kitchen, 8 min, about 17:48',
    });
  });

  it('counts the deliveries beside the lead', () => {
    const view = chipView(feed([delivery({ etaMs: NOW + 8 * 60_000 }), delivery({ id: 'gls:1', kind: 'parcel' })]), NOW);
    expect(view).toMatchObject({ more: 1, label: 'Food, Test Kitchen, 8 min, about 17:48, and 1 more' });
  });

  it('turns to now when the lead is arriving', () => {
    expect(chipView(feed([delivery({ stage: 'arriving', etaMs: NOW + 60_000 })]), NOW)).toMatchObject({ tone: 'now', headline: '1 min' });
  });

  it('shows a chef hat while the kitchen has the order and says so when there is no time', () => {
    expect(chipView(feed([delivery({ stage: 'preparing' })]), NOW)).toMatchObject({
      icon: 'mdi:chef-hat',
      headline: 'Preparing',
      clock: null,
      label: 'Food, Test Kitchen, Preparing',
    });
  });

  it('gives groceries their window, and a cart before the truck is out', () => {
    const window = { windowStartMs: at('2026-11-11T18:00:00+01:00'), windowEndMs: at('2026-11-11T20:00:00+01:00') };
    expect(chipView(feed([delivery({ kind: 'groceries', stage: 'preparing', title: 'Test Grocer', ...window })]), NOW)).toMatchObject({
      icon: 'mdi:cart',
      headline: '18–20',
      clock: null,
    });
    expect(chipView(feed([delivery({ kind: 'groceries', stage: 'on_the_way', ...window })]), NOW)?.icon).toBe('mdi:truck-delivery');
  });

  it('shows a parcel out today with the word of its stage when it has no time', () => {
    expect(chipView(feed([delivery({ kind: 'parcel', stage: 'on_the_way', title: 'GLS' })]), NOW)).toMatchObject({
      icon: 'mdi:package-variant-closed',
      headline: 'On the way',
    });
    expect(chipView(feed([delivery({ kind: 'parcel', stage: 'preparing' })]), NOW)?.headline).toBe('Today');
  });

  it('is a quiet count with no countdown when only parcels days away are left', () => {
    expect(chipView(feed([], [parcel()]), NOW)).toEqual({
      tone: 'quiet',
      icon: 'mdi:package-variant-closed',
      headline: '1',
      clock: null,
      more: 0,
      label: '1 parcel on its way',
    });
    expect(chipView(feed([], [parcel(), parcel({ id: 'gls:1' })]), NOW)).toMatchObject({ headline: '2', label: '2 parcels on their way' });
  });

  it('keeps to the deliveries on the way when there are parcels days away too', () => {
    const view = chipView(feed([delivery({ etaMs: NOW + 8 * 60_000 })], [parcel()]), NOW);
    expect(view).toMatchObject({ tone: 'live', more: 0 });
  });
});

describe('railSteps', () => {
  const states = (stage: 'preparing' | 'on_the_way' | 'arriving') => railSteps(stage).map(step => `${step.label}:${step.state}`);

  it('puts the order in the kitchen while it is preparing', () => {
    expect(states('preparing')).toEqual(['Ordered:done', 'Kitchen:now', 'On the way:todo', 'At the door:todo']);
  });

  it('puts it on the way once the courier has it, and never at the door, which the sensor does not tell', () => {
    expect(states('on_the_way')).toEqual(['Ordered:done', 'Kitchen:done', 'On the way:now', 'At the door:todo']);
    expect(states('arriving')).toEqual(['Ordered:done', 'Kitchen:done', 'On the way:now', 'At the door:todo']);
  });

  it('marks exactly one step as the current one', () => {
    for (const stage of ['preparing', 'on_the_way', 'arriving'] as const) {
      expect(railSteps(stage).filter(step => step.state === 'now')).toHaveLength(1);
    }
  });
});

describe('itemsText', () => {
  it('counts items', () => {
    expect(itemsText(1)).toBe('1 item');
    expect(itemsText(3)).toBe('3 items');
  });
});

describe('carrierName and parcelStatusWord', () => {
  it('names the carriers it knows and spells out the rest from their slug', () => {
    expect(carrierName('gls')).toBe('GLS');
    expect(carrierName('postnord')).toBe('PostNord');
    expect(carrierName('airmee')).toBe('Airmee');
    expect(carrierName('dao')).toBe('DAO');
    expect(carrierName('test_freight')).toBe('Test Freight');
    expect(carrierName('constructor')).toBe('Constructor');
    expect(carrierName('')).toBe('');
  });

  it.each([
    ['registered', 'Not sent yet'],
    ['in_transit', 'On the way'],
    ['out_for_delivery', 'Out for delivery'],
    ['at_pickup_point', 'At the pickup point'],
    ['returning', 'Going back to sender'],
    ['problem', 'Problem'],
    ['unknown', 'Status unknown'],
    ['something_new', 'Status unknown'],
    ['constructor', 'Status unknown'],
  ])('says %s as "%s"', (status, word) => {
    expect(parcelStatusWord(status)).toBe(word);
  });
});

describe('plannedText', () => {
  it('says tomorrow and today for the day in home time, with the window', () => {
    expect(plannedText(at('2026-11-12T14:00:00+01:00'), at('2026-11-12T18:00:00+01:00'), NOW)).toBe('Tomorrow 14–18');
    expect(plannedText(at('2026-11-11T18:00:00+01:00'), at('2026-11-11T20:00:00+01:00'), NOW)).toBe('Today 18–20');
  });

  it('says a weekday within the week and the date from a week out', () => {
    expect(plannedText(at('2026-11-13T14:00:00+01:00'), at('2026-11-13T18:00:00+01:00'), NOW)).toBe('Fri 14–18');
    expect(plannedText(at('2026-11-17T14:00:00+01:00'), at('2026-11-17T18:00:00+01:00'), NOW)).toBe('Tue 14–18');
    expect(plannedText(at('2026-11-18T14:00:00+01:00'), at('2026-11-18T18:00:00+01:00'), NOW)).toBe('Wed 18 Nov 14–18');
  });

  it('gives a day already past by its date', () => {
    expect(plannedText(at('2026-11-10T14:00:00+01:00'), at('2026-11-10T18:00:00+01:00'), NOW)).toBe('Tue 10 Nov 14–18');
  });

  it('gives one time when there is only one, or the window is empty', () => {
    expect(plannedText(at('2026-11-13T14:00:00+01:00'), null, NOW)).toBe('Fri 14:00');
    expect(plannedText(null, at('2026-11-13T18:30:00+01:00'), NOW)).toBe('Fri 18:30');
    expect(plannedText(at('2026-11-13T14:00:00+01:00'), at('2026-11-13T14:00:00+01:00'), NOW)).toBe('Fri 14:00');
  });

  it('gives nothing when the carrier has not planned a day', () => {
    expect(plannedText(null, null, NOW)).toBeNull();
  });

  it('counts the day in home time, not in the device zone', () => {
    expect(plannedText(at('2026-11-12T00:30:00+01:00'), null, NOW)).toBe('Tomorrow 00:30');
    expect(plannedText(at('2026-11-11T23:30:00+01:00'), null, NOW)).toBe('Today 23:30');
  });
});

describe('upcomingView', () => {
  it('shows the carrier and the status beside a sender, with the planned window', () => {
    const view = upcomingView(
      parcel({ plannedFromMs: at('2026-11-12T14:00:00+01:00'), plannedToMs: at('2026-11-12T18:00:00+01:00') }),
      NOW
    );
    expect(view).toEqual({
      id: 'postnord:TESTPN0001',
      icon: 'mdi:package-variant-closed',
      attention: false,
      title: 'Test Shop',
      sub: 'PostNord · Not sent yet',
      planned: 'Tomorrow 14–18',
    });
  });

  it('shows the status alone when the carrier is the title, and no day when none is planned', () => {
    expect(upcomingView(parcel({ id: 'gls:1', source: 'gls', title: 'GLS', status: 'in_transit' }), NOW)).toMatchObject({
      title: 'GLS',
      sub: 'On the way',
      planned: null,
    });
  });

  it.each([
    ['at_pickup_point', 'mdi:storefront-outline', false],
    ['returning', 'mdi:keyboard-return', true],
    ['problem', 'mdi:alert-circle-outline', true],
    ['in_transit', 'mdi:package-variant-closed', false],
    ['unknown', 'mdi:package-variant-closed', false],
  ])('draws a parcel that is %s as %s, wanting a look: %s', (status, icon, attention) => {
    expect(upcomingView(parcel({ status }), NOW)).toMatchObject({ icon, attention });
  });
});
