import { afterEach, describe, expect, it } from 'vitest';
import { HOUSEHOLD } from '../../home/household';
import { DELIVERY_AUDIENCE, canViewerSeeDelivery, type DeliveryKind } from '../audience';
import { NO_DELIVERIES, visibleDeliveries, type DeliveryFeed } from '../model';

const KINDS: DeliveryKind[] = ['food', 'groceries', 'parcel'];
const shipped = Object.fromEntries(KINDS.map(kind => [kind, [...DELIVERY_AUDIENCE[kind]]]));
const editable = DELIVERY_AUDIENCE as unknown as Record<DeliveryKind, string[]>;

afterEach(() => {
  for (const kind of KINDS) editable[kind] = [...shipped[kind]];
});

describe('the delivery audience', () => {
  it('lists every kind, by household member keys only', () => {
    expect(Object.keys(DELIVERY_AUDIENCE).sort()).toEqual([...KINDS].sort());
    const keys = HOUSEHOLD.map(member => member.key);
    for (const kind of KINDS) {
      for (const key of DELIVERY_AUDIENCE[kind]) expect(keys).toContain(key);
    }
  });

  it('opens food to the whole household and keeps groceries and parcels to Mikkel', () => {
    expect(DELIVERY_AUDIENCE.food).toEqual(['mikkel', 'kristine', 'claudia']);
    expect(DELIVERY_AUDIENCE.groceries).toEqual(['mikkel']);
    expect(DELIVERY_AUDIENCE.parcel).toEqual(['mikkel']);
  });

  it('lets the housemates see food', () => {
    for (const name of ['Kristine', 'Claudia']) expect(canViewerSeeDelivery('food', { name })).toBe(true);
  });

  it.each(KINDS)('lets Mikkel see %s, whatever the case or spacing of his display name', kind => {
    expect(canViewerSeeDelivery(kind, { name: 'Mikkel' })).toBe(true);
    expect(canViewerSeeDelivery(kind, { name: '  mikkel ' })).toBe(true);
  });

  it.each(KINDS)('keeps %s from the shared tablet, other users and a viewer still resolving', kind => {
    for (const name of ['Rooftop', 'Another admin', 'Mikkel Eskildsen', '', '   ', null]) {
      expect(canViewerSeeDelivery(kind, { name })).toBe(false);
    }
  });

  it.each(['groceries', 'parcel'] as const)('keeps %s from the housemates', kind => {
    for (const name of ['Kristine', 'Claudia']) expect(canViewerSeeDelivery(kind, { name })).toBe(false);
  });

  it('opens one kind to a housemate by adding their key to that kind alone', () => {
    editable.food = ['mikkel', 'kristine'];
    editable.groceries = ['mikkel'];
    expect(canViewerSeeDelivery('food', { name: 'Kristine' })).toBe(true);
    expect(canViewerSeeDelivery('food', { name: 'Claudia' })).toBe(false);
    expect(canViewerSeeDelivery('groceries', { name: 'Kristine' })).toBe(false);
    expect(canViewerSeeDelivery('parcel', { name: 'Kristine' })).toBe(false);

    const feed: DeliveryFeed = {
      active: [
        {
          id: 'wolt:t1',
          source: 'wolt',
          kind: 'food',
          title: 'Test Kitchen',
          stage: 'on_the_way',
          etaMs: null,
          windowStartMs: null,
          windowEndMs: null,
          itemCount: null,
        },
        {
          id: 'nemlig:t2',
          source: 'nemlig',
          kind: 'groceries',
          title: 'Test Grocer',
          stage: 'preparing',
          etaMs: null,
          windowStartMs: null,
          windowEndMs: null,
          itemCount: null,
        },
      ],
      upcoming: [{ id: 'gls:1', source: 'gls', title: 'GLS', status: 'in_transit', plannedFromMs: null, plannedToMs: null }],
    };
    const kristine = visibleDeliveries(feed, { name: 'Kristine' });
    expect(kristine.active.map(delivery => delivery.id)).toEqual(['wolt:t1']);
    expect(kristine.upcoming).toEqual([]);
    expect(visibleDeliveries(feed, { name: 'Claudia' })).toBe(NO_DELIVERIES);
  });
});
