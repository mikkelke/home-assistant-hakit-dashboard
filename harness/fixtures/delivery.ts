import type { HouseBuilder } from './builder';
import { MINUTE, iso } from './time';

/** `live`: a meal from a kitchen on its way, with two parcels still to come. `busy`: a kitchen that has just the order, a grocery
 * window and a parcel out today, with a parcel to come. `arriving`: the courier is a minute out. `upcoming`: nothing today, parcels
 * on their way. */
export type DeliveryScenario = 'live' | 'busy' | 'arriving' | 'upcoming';

/** The parcels still days away: one planned for tomorrow 14-18, one the carrier has given no day and, in the larger set, one waiting
 * at a pickup point from Monday. */
function comingParcels(kind: 'both' | 'three') {
  const tomorrow = Date.UTC(2026, 9, 22, 12, 0);
  const monday = Date.UTC(2026, 9, 26, 13, 0);
  const parcels = [
    {
      id: 'postnord:TESTPN0001',
      source: 'postnord',
      title: 'Test Shop',
      status: 'registered',
      planned_from: iso(tomorrow),
      planned_to: iso(tomorrow + 4 * 60 * MINUTE),
    },
    { id: 'gls:TESTGLS0001', source: 'gls', title: 'GLS', status: 'in_transit' },
  ];
  if (kind === 'three') {
    parcels.push({
      id: 'airmee:TESTAM0001',
      source: 'airmee',
      title: 'Test Outlet',
      status: 'at_pickup_point',
      planned_from: iso(monday),
      planned_to: iso(monday + 4 * 60 * MINUTE),
    });
  }
  return parcels;
}

/** `sensor.home_delivery` as the AppDaemon HomeDelivery app publishes it: only the keys with a value, since AppDaemon drops the
 * null, false and zero ones. */
export function addDelivery(h: HouseBuilder, scenario: DeliveryScenario): void {
  const { now } = h;
  const kitchen = (patch: Record<string, unknown>) => ({
    id: 'wolt:test-order-1',
    source: 'wolt',
    kind: 'food',
    title: 'Test Kitchen',
    stage: 'on_the_way',
    ...patch,
  });
  const groceries = {
    id: 'nemlig:test-order-2',
    source: 'nemlig',
    kind: 'groceries',
    title: 'Test Grocer',
    stage: 'preparing',
    window_start: iso(Date.UTC(2026, 9, 21, 18, 0)),
    window_end: iso(Date.UTC(2026, 9, 21, 20, 0)),
  };
  const parcelToday = {
    id: 'postnord:TESTPN0002',
    source: 'postnord',
    kind: 'parcel',
    title: 'Test Webshop',
    stage: 'on_the_way',
  };

  const scenarios: Record<DeliveryScenario, { deliveries: unknown[]; upcoming: unknown[] }> = {
    live: {
      deliveries: [kitchen({ eta: iso(now + 8 * MINUTE), minutes_left: 8, item_count: 3 })],
      upcoming: comingParcels('both'),
    },
    busy: {
      deliveries: [kitchen({ stage: 'preparing', eta: iso(now + 34 * MINUTE), minutes_left: 34, item_count: 2 }), groceries, parcelToday],
      upcoming: comingParcels('three'),
    },
    arriving: {
      deliveries: [kitchen({ stage: 'arriving', eta: iso(now + MINUTE), minutes_left: 1, item_count: 3 })],
      upcoming: [],
    },
    upcoming: { deliveries: [], upcoming: comingParcels('three') },
  };
  const { deliveries, upcoming } = scenarios[scenario];
  h.put(
    'sensor.home_delivery',
    deliveries.length,
    { friendly_name: 'Home delivery', icon: 'mdi:truck-delivery', deliveries, ...(upcoming.length > 0 ? { upcoming } : {}) },
    { ago: 2 }
  );
}
