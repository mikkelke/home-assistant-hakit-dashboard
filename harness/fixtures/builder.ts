import type {
  AreaEntry,
  Attributes,
  DeviceEntry,
  Fixture,
  HistoryPoint,
  RegistryEntry,
  RestRoute,
  ServiceHandler,
  StateSeed,
  StatSource,
  Viewer,
  WsHandler,
} from './types';

const MINUTE = 60_000;

export type Reading = string | number | null;

export interface Put {
  /** Minutes since the state last changed. */
  ago?: number;
}

/** Collects a synthetic Home Assistant: states, registries, documents and the commands pages need. */
export class HouseBuilder {
  readonly states = new Map<string, StateSeed>();
  readonly areas: AreaEntry[] = [];
  readonly devices: DeviceEntry[] = [];
  readonly entityRegistry: RegistryEntry[] = [];
  readonly systemData: Record<string, unknown> = {};
  readonly statistics: Record<string, StatSource> = {};
  readonly history: Record<string, HistoryPoint[]> = {};
  readonly query: Record<string, string> = {};
  readonly services: Record<string, ServiceHandler> = {};
  readonly ws: Record<string, WsHandler> = {};
  readonly rest: RestRoute[] = [];

  readonly now: number;
  readonly viewer: Viewer;

  constructor(now: number, viewer: Viewer) {
    this.now = now;
    this.viewer = viewer;
  }

  /** Sets an entity. `null` reads as `unavailable`, the way a dead device does. */
  put(entityId: string, state: Reading, attributes: Attributes = {}, { ago = 45 }: Put = {}): this {
    const changed = this.now - ago * MINUTE;
    this.states.set(entityId, {
      state: state === null ? 'unavailable' : String(state),
      attributes,
      lastChanged: changed,
      lastUpdated: changed,
    });
    return this;
  }

  /** Keeps an entity's attributes and turns its state into `unavailable`. */
  kill(entityId: string): this {
    const seed = this.states.get(entityId);
    if (seed) this.states.set(entityId, { ...seed, state: 'unavailable' });
    return this;
  }

  remove(entityId: string): this {
    this.states.delete(entityId);
    return this;
  }

  area(areaId: string, name: string, icon: string): this {
    this.areas.push({ area_id: areaId, name, icon, picture: null, floor_id: null, aliases: [], labels: [] });
    return this;
  }

  toFixture(config: Attributes): Fixture {
    return {
      now: this.now,
      viewer: this.viewer,
      config,
      states: this.states,
      areas: this.areas,
      devices: this.devices,
      entityRegistry: this.entityRegistry,
      systemData: this.systemData,
      statistics: this.statistics,
      history: this.history,
      query: this.query,
      services: this.services,
      ws: this.ws,
      rest: this.rest,
    };
  }
}
