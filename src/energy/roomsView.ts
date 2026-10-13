/** Rooms for the Energy page: device sensors grouped into HA areas, and the Live flow diagram's
 * nodes. Pure.
 *
 * Accounting follows `assembleDevices` and `assembleLivePower`: a child meter (`included_in_stat`)
 * is already part of its parent's reading, so only top-level devices are summed, and every device
 * belongs to the room of its top-level ancestor. Rooms plus Untracked therefore add up to the grid. */
import { FLOW_MAX_ROOMS } from '../config/energy';
import type { LiveDeviceUsage, LivePowerView } from './assemble';
import type { DevicePref, DeviceUsage, EnergyDevices } from './types';

export interface RoomInfo {
  name: string;
  icon?: string | null;
}

export interface RoomUsage {
  /** Area id; '' for devices no area could be found for. */
  key: string;
  name: string;
  icon: string;
  /** Live draw of the room's top-level devices; null when none of them has a reading. */
  watts: number | null;
  kWh: number;
  costKr: number | null;
  /** The room's top-level devices for the period, children nested, kWh descending. */
  devices: DeviceUsage[];
  /** The room's biggest single live draw, a child meter rather than the parent that contains it. */
  top: { name: string; watts: number } | null;
  running: boolean;
}

export interface RoomsView {
  rooms: RoomUsage[];
  untracked: { watts: number | null; kWh: number | null; costKr: number | null };
}

export interface GroupRoomsInput {
  prefs: readonly DevicePref[];
  areaOf: (entityId: string) => string | null;
  areas: Readonly<Record<string, RoomInfo | undefined>>;
  devices: EnergyDevices | null;
  live: LivePowerView | null;
  runningAreas?: ReadonlySet<string>;
}

const NO_ROOM: RoomInfo = { name: 'No room', icon: 'mdi:help-circle-outline' };

/** Room key of every device: the area of its top-level ancestor. */
function roomKeys(prefs: readonly DevicePref[], areaOf: (entityId: string) => string | null): Map<string, string> {
  const byId = new Map(prefs.map(pref => [pref.statId, pref]));
  const keys = new Map<string, string>();
  for (const pref of prefs) {
    let top = pref;
    const seen = new Set<string>();
    while (top.parentStatId && byId.has(top.parentStatId) && !seen.has(top.statId)) {
      seen.add(top.statId);
      top = byId.get(top.parentStatId)!;
    }
    keys.set(pref.statId, areaOf(top.statId) ?? '');
  }
  return keys;
}

function leaves(device: LiveDeviceUsage): LiveDeviceUsage[] {
  return device.children?.length ? device.children : [device];
}

export function groupRooms({ prefs, areaOf, areas, devices, live, runningAreas }: GroupRoomsInput): RoomsView {
  const keyOf = roomKeys(prefs, areaOf);
  const rooms = new Map<string, RoomUsage>();
  const roomFor = (statId: string): RoomUsage => {
    const key = keyOf.get(statId) ?? '';
    let room = rooms.get(key);
    if (!room) {
      const info = (key && areas[key]) || NO_ROOM;
      room = {
        key,
        name: info.name,
        icon: info.icon || 'mdi:home-outline',
        watts: null,
        kWh: 0,
        costKr: 0,
        devices: [],
        top: null,
        running: runningAreas?.has(key) ?? false,
      };
      rooms.set(key, room);
    }
    return room;
  };

  for (const pref of prefs) if (!pref.parentStatId || !keyOf.has(pref.parentStatId)) roomFor(pref.statId);

  for (const device of devices?.devices ?? []) {
    const room = roomFor(device.statId);
    room.devices.push(device);
    room.kWh += device.kWh;
    room.costKr = room.costKr == null || device.costKr == null ? null : room.costKr + device.costKr;
  }

  for (const device of live?.devices ?? []) {
    const room = roomFor(device.statId);
    room.watts = (room.watts ?? 0) + device.watts;
    for (const leaf of leaves(device)) if (!room.top || leaf.watts > room.top.watts) room.top = { name: leaf.name, watts: leaf.watts };
  }

  if (!devices) for (const room of rooms.values()) room.costKr = null;

  return {
    rooms: Array.from(rooms.values()).sort((a, b) => b.kWh - a.kWh || (b.watts ?? 0) - (a.watts ?? 0)),
    untracked: {
      watts: live?.untrackedWatts ?? null,
      kWh: devices?.untracked.kWh ?? null,
      costKr: devices?.untracked.costKr ?? null,
    },
  };
}

export interface FlowNode {
  key: string;
  icon: string;
  watts: number;
  /** Share of the house's draw, 0..1. */
  share: number;
  strokeWidth: number;
  /** One dash cycle in seconds; null when nothing flows. */
  dashSeconds: number | null;
  running: boolean;
  untracked?: true;
}

/** Line width for a share of the house's draw: thin floor, capped so one room never swamps the rest. */
export function flowStrokeWidth(share: number): number {
  return Math.min(7, Math.max(1.2, 1.2 + 6.2 * share));
}

/** Dash cycle for a draw: faster with more watts, between 0,6 s and 2,4 s; null below 1 W. */
export function flowDashSeconds(watts: number): number | null {
  if (!(watts >= 1)) return null;
  return Math.min(2.4, Math.max(0.6, 60 / watts));
}

/** The flow diagram's nodes, biggest first: rooms drawing power (at most `maxRooms`; the smallest
 * share one node beyond that), then Untracked. Shares are of `gridW` when known. */
export function flowNodes(
  rooms: readonly RoomUsage[],
  untrackedW: number | null,
  gridW: number | null,
  maxRooms = FLOW_MAX_ROOMS
): FlowNode[] {
  const drawing = rooms.filter(room => (room.watts ?? 0) >= 1).sort((a, b) => (b.watts ?? 0) - (a.watts ?? 0));
  const shown = drawing.length > maxRooms ? drawing.slice(0, maxRooms - 1) : drawing;
  const rest = drawing.slice(shown.length);
  const parts = shown.map(room => ({ key: room.key, icon: room.icon, watts: room.watts ?? 0, running: room.running }));
  if (rest.length > 0) {
    parts.push({
      key: 'other-rooms',
      icon: 'mdi:dots-horizontal',
      watts: rest.reduce((sum, room) => sum + (room.watts ?? 0), 0),
      running: rest.some(room => room.running),
    });
  }
  const untracked = untrackedW != null && untrackedW >= 1 ? untrackedW : 0;
  const total = gridW != null && gridW > 0 ? gridW : parts.reduce((sum, part) => sum + part.watts, untracked);
  const node = (part: (typeof parts)[number]): FlowNode => {
    const share = total > 0 ? Math.min(1, part.watts / total) : 0;
    return { ...part, share, strokeWidth: flowStrokeWidth(share), dashSeconds: flowDashSeconds(part.watts) };
  };
  const nodes = parts.map(node);
  if (untracked > 0) {
    nodes.push({ ...node({ key: 'untracked', icon: 'mdi:dots-horizontal', watts: untracked, running: false }), untracked: true });
  }
  return nodes;
}
