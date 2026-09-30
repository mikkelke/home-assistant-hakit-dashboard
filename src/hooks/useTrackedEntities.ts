import { useMemo, useState, useSyncExternalStore } from 'react';
import { useHass } from '@hakit/core';
import type { HassEntities } from '../types';

/**
 * The whole dashboard is drawn from one `entities` map, but only a small part of it is ever read. Subscribing to the
 * store directly (`useHass(s => s.entities)`) re-renders the entire tree on every frame from Home Assistant — several
 * a second, most of them for sensors nothing on screen looks at.
 *
 * This hook hands out an `entities` value that behaves exactly like the map but records which entity ids are read
 * through it (in render, in effects, in event handlers — anywhere), and only tells React to re-render when one of
 * THOSE entities actually changes (or, if something enumerates the ids, when entities are added or removed).
 *
 * - Reads always come from the live store, so a component that renders for its own reasons (local state, a modal
 *   opening) sees current values even for an entity it has not read before.
 * - The returned value gets a new identity whenever a re-render is due, so `useMemo(..., [entities])` and
 *   `useEffect(..., [entities])` in the tree keep working unchanged.
 * - It fails toward today's behaviour: anything that reads every entity (`Object.entries`, spread, JSON.stringify)
 *   simply makes every entity count as read. Use {@link peekEntities} for a scan that must not do that.
 * - It also re-renders on a slow heartbeat, and when the page becomes visible again. Parts of the tree derive output
 *   from the clock inside memos keyed on `entities` (relative times, "for at least N minutes" rules) and used to be
 *   refreshed as a side effect of the constant frame churn; the heartbeat bounds how stale that output can get.
 */

const HEARTBEAT_MS = 10_000;

const RAW = Symbol('hass.entities.raw');

function createTracker() {
  const reads = new Set<string>();
  let readsStructure = false;
  const live = (): HassEntities => useHass.getState().entities;

  // The map as of the last re-render we asked for; a later frame only matters if it differs from this in what was read.
  let baseline = live();
  let baselineSize: number | undefined;
  let version = 0;
  let current: HassEntities | undefined;
  let currentVersion = -1;
  const listeners = new Set<() => void>();
  let unsubscribeStore: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const handler: ProxyHandler<HassEntities> = {
    get(_target, prop) {
      if (prop === RAW) {
        readsStructure = true;
        return live();
      }
      if (typeof prop === 'string') reads.add(prop);
      return Reflect.get(live(), prop);
    },
    has(_target, prop) {
      readsStructure = true;
      if (typeof prop === 'string') reads.add(prop);
      return Reflect.has(live(), prop);
    },
    ownKeys() {
      readsStructure = true;
      return Reflect.ownKeys(live());
    },
    getOwnPropertyDescriptor(_target, prop) {
      readsStructure = true;
      const descriptor = Reflect.getOwnPropertyDescriptor(live(), prop);
      return descriptor && { ...descriptor, configurable: true };
    },
  };

  const differsInWhatWasRead = (next: HassEntities): boolean => {
    if (next === baseline) return false;
    if (readsStructure) {
      baselineSize ??= Object.keys(baseline).length;
      if (Object.keys(next).length !== baselineSize) return true;
    }
    for (const id of reads) if (next[id] !== baseline[id]) return true;
    return false;
  };

  const advance = (next: HassEntities) => {
    baseline = next;
    baselineSize = undefined;
    version += 1;
  };

  const refresh = () => {
    advance(live());
    listeners.forEach(notify => notify());
  };

  const refreshIfVisible = () => {
    if (!document.hidden) refresh();
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        unsubscribeStore = useHass.subscribe(state => {
          if (!differsInWhatWasRead(state.entities)) return;
          advance(state.entities);
          listeners.forEach(notify => notify());
        });
        heartbeat = setInterval(refreshIfVisible, HEARTBEAT_MS);
        document.addEventListener('visibilitychange', refreshIfVisible);
      }
      // A frame can land between the render and this subscription.
      const now = live();
      if (differsInWhatWasRead(now)) {
        advance(now);
        listener();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribeStore?.();
          unsubscribeStore = undefined;
          clearInterval(heartbeat);
          heartbeat = undefined;
          document.removeEventListener('visibilitychange', refreshIfVisible);
        }
      };
    },
    getVersion: () => version,
    entities(): HassEntities {
      if (current === undefined || currentVersion !== version) {
        current = new Proxy({} as HassEntities, handler);
        currentVersion = version;
      }
      return current;
    },
  };
}

/** Live `entities` that re-renders the caller only when an entity it has actually read changes. */
export function useTrackedEntities(): HassEntities {
  const [tracker] = useState(createTracker);
  const version = useSyncExternalStore(tracker.subscribe, tracker.getVersion, tracker.getVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is what gives the value a new identity
  return useMemo(() => tracker.entities(), [tracker, version]);
}

/**
 * The live map behind a tracked `entities` value, read without recording which entities are looked at (only that the
 * map was enumerated, so entities being added or removed still count). For a scan that has to look at many entities but
 * only depends on a few of them: find the candidates here, then read the ones that matter through the tracked value so
 * their changes are still noticed. A plain map is returned as-is.
 */
export function peekEntities(entities: HassEntities): HassEntities {
  return (entities as unknown as Record<symbol, HassEntities | undefined>)[RAW] ?? entities;
}
