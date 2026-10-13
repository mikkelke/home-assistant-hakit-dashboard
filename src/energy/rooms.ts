/** Which area (room) an entity belongs to, from registry-shaped data. Pure. */

export interface AreaLike {
  area_id: string;
  name: string;
}

export interface RegistryInput {
  entities: Readonly<Record<string, { area_id?: string | null; device_id?: string | null } | undefined>>;
  devices: Readonly<Record<string, { area_id?: string | null } | undefined>>;
  areas: Readonly<Record<string, AreaLike | undefined>>;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The entity's own area, else its device's area, else the area whose id or name is the longest
 * prefix of the entity's object id (`sensor.kitchen_plug_power` -> `kitchen`). Null when none fits. */
export function resolveEntityArea(entityId: string, registry: RegistryInput): string | null {
  const entry = registry.entities[entityId];
  if (entry?.area_id && registry.areas[entry.area_id]) return entry.area_id;
  const deviceArea = entry?.device_id ? registry.devices[entry.device_id]?.area_id : null;
  if (deviceArea && registry.areas[deviceArea]) return deviceArea;

  const objectId = entityId.slice(entityId.indexOf('.') + 1);
  let best: { areaId: string; length: number } | null = null;
  for (const area of Object.values(registry.areas)) {
    if (!area) continue;
    for (const prefix of new Set([area.area_id, slug(area.name)])) {
      if (!prefix || (objectId !== prefix && !objectId.startsWith(`${prefix}_`))) continue;
      if (!best || prefix.length > best.length) best = { areaId: area.area_id, length: prefix.length };
    }
  }
  return best?.areaId ?? null;
}
