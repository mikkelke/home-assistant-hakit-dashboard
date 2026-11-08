import { useMemo, useSyncExternalStore } from 'react';
import { useHass } from '@hakit/core';
import { cookDemoMode, cookDemoSnapshot, subscribeCookDemo, type CookDemoSnapshot } from './demoStore';
import { COOK_LIVE_ENTITY, COOK_LOG_ENTITY, COOK_STATE_ENTITY, type CookEntityId } from './entities';
import { parseCookLive, parseCookLog, parseCookState, type CookEntity } from './model';

const noDemo = () => () => {};
const nothing = () => null;
export function useCookDemo(): CookDemoSnapshot | null {
  const demo = cookDemoMode() != null;
  return useSyncExternalStore(demo ? subscribeCookDemo : noDemo, demo ? cookDemoSnapshot : nothing, nothing);
}

export function useCookEntity(entityId: CookEntityId): CookEntity {
  const live = useHass(store => store.entities?.[entityId]) as CookEntity;
  const demo = useCookDemo();
  return cookDemoMode() != null ? demo?.entities[entityId] : live;
}

export function useCookState() {
  const entity = useCookEntity(COOK_STATE_ENTITY);
  return useMemo(() => parseCookState(entity), [entity]);
}

export function useCookLive() {
  const entity = useCookEntity(COOK_LIVE_ENTITY);
  return useMemo(() => parseCookLive(entity), [entity]);
}

export function useCookLog() {
  const entity = useCookEntity(COOK_LOG_ENTITY);
  return useMemo(() => parseCookLog(entity), [entity]);
}
