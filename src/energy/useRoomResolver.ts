import { useMemo } from 'react';
import { useRegistryData } from '@hakit/core';
import { resolveEntityArea } from './rooms';
import type { RoomInfo } from './roomsView';

export interface RoomResolver {
  areaOf: (entityId: string) => string | null;
  areas: Record<string, RoomInfo>;
}

/** Entity -> area lookups from hakit's registry data (entity area, device area, entity-id prefix). */
export function useRoomResolver(): RoomResolver {
  const entities = useRegistryData('entitiesRegistryDisplay');
  const devices = useRegistryData('devices');
  const areaRegistry = useRegistryData('areas');

  return useMemo(() => {
    const registry = { entities, devices, areas: areaRegistry };
    const cache = new Map<string, string | null>();
    const areas: Record<string, RoomInfo> = {};
    for (const area of Object.values(areaRegistry)) areas[area.area_id] = { name: area.name, icon: area.icon ?? null };
    return {
      areas,
      areaOf: (entityId: string) => {
        if (!cache.has(entityId)) cache.set(entityId, resolveEntityArea(entityId, registry));
        return cache.get(entityId) ?? null;
      },
    };
  }, [entities, devices, areaRegistry]);
}
