import { describe, expect, it } from 'vitest';
import { resolveEntityArea, type RegistryInput } from '../rooms';

const registry: RegistryInput = {
  entities: {
    'sensor.washer_plug_power': { area_id: 'bathroom', device_id: 'd1' },
    'sensor.dryer_plug_power': { device_id: 'd2' },
    'sensor.athom_plug_power': { device_id: 'd3', area_id: null },
    'sensor.ghost_power': { area_id: 'deleted_area' },
  },
  devices: { d1: { area_id: 'kitchen' }, d2: { area_id: 'kitchen' }, d3: { area_id: null } },
  areas: {
    bathroom: { area_id: 'bathroom', name: 'Bathroom' },
    kitchen: { area_id: 'kitchen', name: 'Køkken' },
    claudias_room: { area_id: 'claudias_room', name: "Claudia's Room" },
    living: { area_id: 'living', name: 'Living' },
    living_room: { area_id: 'living_room', name: 'Living Room' },
  },
};

describe('resolveEntityArea', () => {
  it('prefers the entity area, then the device area', () => {
    expect(resolveEntityArea('sensor.washer_plug_power', registry)).toBe('bathroom');
    expect(resolveEntityArea('sensor.dryer_plug_power', registry)).toBe('kitchen');
  });

  it('falls back to the longest matching area prefix of the object id', () => {
    expect(resolveEntityArea('sensor.living_room_tv_power', registry)).toBe('living_room');
    expect(resolveEntityArea('sensor.living_lamp_power', registry)).toBe('living');
    expect(resolveEntityArea('sensor.claudias_room_heater_power', registry)).toBe('claudias_room');
    expect(resolveEntityArea('sensor.kokken_kettle_power', registry)).toBe('kitchen');
    expect(resolveEntityArea('sensor.ghost_power', registry)).toBeNull();
  });

  it('returns null when nothing fits', () => {
    expect(resolveEntityArea('sensor.athom_plug_power', registry)).toBeNull();
    expect(resolveEntityArea('sensor.livingroom_power', registry)).toBeNull();
  });
});
