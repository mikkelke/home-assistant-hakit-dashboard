import { useCallback, useRef, useSyncExternalStore } from 'react';
import { useHass } from '@hakit/core';
import type { EntityLike } from '../../sensorMap/live';

type States = readonly (EntityLike | undefined)[];
const NONE: States = [];

/**
 * The live state of a handful of entities, for one component. It re-renders only when one of those entities
 * changes, which is what keeps a presence flip from touching anything but the marker and footprint it belongs
 * to: the snapshot is the same array until an entity it holds is replaced.
 */
export function useEntityStates(ids: readonly string[]): States {
  const key = ids.join('\n');
  const cache = useRef<{ key: string; list: States }>({ key: '', list: NONE });
  const getSnapshot = useCallback(() => {
    const entities = useHass.getState().entities as Record<string, EntityLike | undefined>;
    const next = key === '' ? NONE : key.split('\n').map(id => entities[id]);
    const previous = cache.current;
    if (previous.key === key && previous.list.length === next.length && previous.list.every((entity, i) => entity === next[i]))
      return previous.list;
    cache.current = { key, list: next };
    return next;
  }, [key]);
  return useSyncExternalStore(useHass.subscribe, getSnapshot);
}

/** The entities of `ids` by id, for the rules in `live.ts`. */
export function statesById(ids: readonly string[], states: States): Record<string, EntityLike | undefined> {
  const out: Record<string, EntityLike | undefined> = {};
  ids.forEach((id, index) => {
    out[id] = states[index];
  });
  return out;
}
