import {
  emptyFingerprintDoc,
  emptyMapDoc,
  emptySuggestDoc,
  validateMapDoc,
  type Furniture,
  type MapDevice,
  type MapDoc,
  type Placement,
  type Point,
  type Zone,
} from '../../src/sensorMap/mapDoc';
import type { HouseBuilder } from './builder';
import { iso } from './time';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

interface Room {
  zone: string;
  name: string;
  area: string | null;
  box: [number, number, number, number];
  active?: string;
}

/** An invented flat: three bedrooms along the top, a corridor with two bathrooms, and the kitchen, the living area and the dining
 * room along the bottom. */
const ROOMS: readonly Room[] = [
  {
    zone: 'kristines',
    name: 'Kristines Room',
    area: 'kristines_room',
    box: [0, 5.4, 3.8, 9],
    active: 'binary_sensor.kristines_room_active',
  },
  { zone: 'claudias', name: 'Claudias Room', area: 'office', box: [3.8, 5.4, 7.6, 9], active: 'binary_sensor.claudias_room_active' },
  { zone: 'bedroom', name: 'Bedroom', area: 'bedroom', box: [7.6, 5.4, 12, 9], active: 'binary_sensor.bedroom_active' },
  { zone: 'bathroom', name: 'Bathroom', area: 'bathroom', box: [0, 3.2, 2.8, 5.4], active: 'binary_sensor.bathroom_active' },
  { zone: 'hallway', name: 'Hallway', area: 'hallway', box: [2.8, 3.2, 9.2, 5.4], active: 'binary_sensor.hallway_active' },
  {
    zone: 'guest',
    name: 'Guest Bathroom',
    area: 'guest_bathroom',
    box: [9.2, 3.2, 12, 5.4],
    active: 'binary_sensor.guest_bathroom_active',
  },
  { zone: 'kitchen', name: 'Kitchen', area: 'kitchen', box: [0, 0, 4.6, 3.2], active: 'binary_sensor.kitchen_active' },
  { zone: 'living', name: 'Living Room', area: 'living_room', box: [4.6, 0, 8.6, 3.2], active: 'binary_sensor.living_room_active' },
  { zone: 'dining', name: 'Dining Room', area: 'dining_room', box: [8.6, 0, 12, 3.2], active: 'binary_sensor.dining_room_active' },
];

const placed = (x: number, y: number, h: number | null, partial: Partial<Placement> = {}): Placement => ({
  pos: { x, y, h },
  facing: { state: 'unknown' },
  fov_deg: null,
  cert: 'room',
  confirmed_at: null,
  ...partial,
});

function device(name: string, type: string, zone: string | null, placement: Placement, partial: Partial<MapDevice> = {}): MapDevice {
  return {
    name,
    type,
    roles: [],
    model: type === 'presence' ? 'Radar module' : type === 'ble' ? 'BLE proxy' : 'Generic',
    ha: { device_ids: [], bindings: {}, scanner_source: null },
    zone_id: zone,
    clip_region_id: null,
    placement,
    history: [],
    basis: '',
    notes: '',
    measure_ids: [],
    ...partial,
  };
}

function plan(now: string): MapDoc {
  const doc = emptyMapDoc(now);
  doc.layout_version = 4;
  doc.plan = {
    units: 'm',
    origin: 'the south-west corner of the kitchen',
    bounds: { x0: -1, x1: 13, y0: -1, y1: 10 },
    fit: { x0: -0.6, x1: 12.6, y0: -0.6, y1: 9.6 },
    scale_rms_cm: 6,
    walls: [
      { x0: 0, x1: 12, y0: -0.1, y1: 0 },
      { x0: 0, x1: 12, y0: 9, y1: 9.1 },
      { x0: -0.1, x1: 0, y0: 0, y1: 9 },
      { x0: 12, x1: 12.1, y0: 0, y1: 9 },
      { x0: 0, x1: 12, y0: 5.35, y1: 5.45 },
      { x0: 0, x1: 12, y0: 3.15, y1: 3.25 },
      { x0: 3.75, x1: 3.85, y0: 5.4, y1: 9 },
      { x0: 7.55, x1: 7.65, y0: 5.4, y1: 9 },
      { x0: 2.75, x1: 2.85, y0: 3.2, y1: 5.4 },
      { x0: 9.15, x1: 9.25, y0: 3.2, y1: 5.4 },
      { x0: 4.55, x1: 4.65, y0: 0, y1: 3.2 },
    ],
    doors: [
      { name: 'Front door', hinge: [9.2, 4.3], closed: [9.2, 3.5], open: [10, 4.3] },
      { name: 'Bedroom door', hinge: [8.3, 5.4], closed: [9.1, 5.4], open: [8.3, 6.2] },
      { name: 'Bathroom door', hinge: [2.8, 4.8], closed: [2.8, 4], open: [2, 4.8] },
    ],
    windows: [
      { name: 'Kitchen window', box: [1.4, -0.05, 3, 0.05], door: false },
      { name: 'Living room terrace door', box: [5.2, -0.05, 7, 0.05], door: true },
      { name: 'Dining room window', box: [9.4, -0.05, 11.2, 0.05], door: false },
      { name: 'Bedroom window', box: [9.2, 8.95, 11, 9.05], door: false },
    ],
    furniture: [
      { id: 'f-sofa', name: 'Sofa', box: [5, 0.4, 7.4, 1.3] } satisfies Furniture,
      { id: 'f-table', name: 'Dining table', box: [9.2, 0.8, 11.2, 2.2] } satisfies Furniture,
      { id: 'f-bed', name: 'Bed', box: [8.2, 6.6, 10.6, 8.7] } satisfies Furniture,
    ],
    zones: ROOMS.map(
      (room): Zone => ({
        zone_id: room.zone,
        name: room.name,
        poly: rect(...room.box),
        ha_area_id: room.area,
        active_entity: room.active ?? null,
        label: [(room.box[0] + room.box[2]) / 2, (room.box[1] + room.box[3]) / 2],
        ceiling_m: 2.5,
      })
    ),
    clip_regions: [{ clip_region_id: 'open-plan', poly: rect(4.6, 0, 12, 3.2) }],
    zone_lines: [{ x: 8.6, y1: 3.2 }],
    annotations: [{ id: 'a-terrace', kind: 'note', at: [6, -0.7], lines: ['Terrace'], rot: 0, small: true, outside: true }],
    compass: { x: 12.4, y: 9.6, rot: 12 },
  };
  doc.types = [
    { key: 'ble', label: 'BLE scanner' },
    { key: 'presence', label: 'Presence radar' },
    { key: 'contact', label: 'Contact' },
    { key: 'plug', label: 'Plug' },
    { key: 'other', label: 'Other' },
  ];
  const radar = (key: string, room: Room, x: number, y: number, deg: number) =>
    [
      `radar_${key}`,
      device(
        `${room.name} radar`,
        'presence',
        room.zone,
        placed(x, y, 2.4, { facing: { state: 'known', deg }, fov_deg: 120, cert: 'confirmed', confirmed_at: now }),
        {
          ha: {
            device_ids: [`dev-radar-${key}`],
            bindings: { presence: `binary_sensor.${room.area ?? key}_presence_occupancy` },
            scanner_source: null,
          },
        }
      ),
    ] as const;
  const scanner = (key: string, room: Room, x: number, y: number, mac: string) =>
    [
      `scan_${key}`,
      device(`${room.name} scanner`, 'ble', room.zone, placed(x, y, 1.1), {
        ha: { device_ids: [`dev-scan-${key}`], bindings: {}, scanner_source: mac },
      }),
    ] as const;
  const living = ROOMS[7];
  const kitchen = ROOMS[6];
  const bedroom = ROOMS[2];
  const hallway = ROOMS[4];
  doc.devices = Object.fromEntries([
    radar('living', living, 5.2, 2.8, 200),
    radar('kitchen', kitchen, 1, 2.7, 300),
    radar('bedroom', bedroom, 11.6, 8.5, 225),
    radar('hallway', hallway, 6, 5, 270),
    scanner('living', living, 8.2, 0.3, '00:00:5E:00:53:01'),
    scanner('kitchen', kitchen, 4.2, 0.3, '00:00:5E:00:53:02'),
    scanner('bedroom', bedroom, 7.9, 8.7, '00:00:5E:00:53:03'),
    [
      'door_front',
      device('Front door contact', 'contact', 'hallway', placed(9.2, 3.9, 1), {
        ha: { device_ids: ['dev-door'], bindings: { contact: 'binary_sensor.apartment_door_open' }, scanner_source: null },
      }),
    ],
    ['spare', device('Spare sensor in the drawer', 'other', null, placed(0, 0, null, { pos: null, cert: 'guess' }))],
  ]);
  doc.questions = [
    { id: 'Q1', text: 'Does the hallway radar see into the bathroom?', refs: ['radar_hallway'], answer: null, answered_at: null },
  ];
  doc.measurements = [
    {
      id: 'M1',
      prio: 'A',
      text: 'Height of the bedroom radar above the floor, in cm.',
      refs: ['radar_bedroom'],
      answer: null,
      answered_at: null,
      applied: false,
    },
  ];
  doc.phones = [{ name: 'Test phone', bermuda_address: 'test-beacon-address', person: 'person.kristine' }];
  doc.observations = ['The radar in the hallway also fires when the front door opens.'];
  const problems = validateMapDoc(doc);
  if (problems.length > 0) throw new Error(`The invented plan is invalid: ${problems.join('; ')}`);
  return doc;
}

export function addMap(h: HouseBuilder): void {
  const at = iso(h.now - 3 * 86_400_000);
  h.systemData.sensor_map = plan(at);
  const suggestion = emptySuggestDoc(at, 4);
  suggestion.items = [
    {
      id: 's-1',
      kind: 'placement',
      device_key: 'radar_hallway',
      placement: placed(6.4, 5.1, 2.4, { facing: { state: 'known', deg: 270 }, fov_deg: 120 }),
      reason: 'Measured against the doorway',
    },
  ];
  h.systemData.sensor_map_suggest = suggestion;
  h.systemData.sensor_map_fingerprints = emptyFingerprintDoc(at);
  h.ws['bluetooth/subscribe_scanner_details'] = (_message, context) => {
    context.event({
      add: ['00:00:5E:00:53:01', '00:00:5E:00:53:02', '00:00:5E:00:53:03'].map(source => ({
        source,
        name: `Scanner ${source.slice(-2)}`,
        adapter: 'proxy',
        scanner_type: 'remote',
      })),
    });
    return null;
  };
  h.ws['config_entries/get'] = () => [{ entry_id: 'entry-1', domain: 'esphome' }];
}
