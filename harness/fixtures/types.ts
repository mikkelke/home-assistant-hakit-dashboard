export type Attributes = Record<string, unknown>;

export interface StatRow {
  mean?: number;
  min?: number;
  max?: number;
  state?: number;
  sum?: number;
  change?: number;
}

/** One statistic's row for the bucket [startMs, endMs); null leaves the bucket out, as before the statistic existed. */
export type StatSource = (startMs: number, endMs: number) => StatRow | null;

/** A recorded state, from `t` on. */
export interface HistoryPoint {
  t: number;
  state: string;
  attributes?: Attributes;
}

export interface StateSeed {
  state: string;
  attributes: Attributes;
  lastChanged: number;
  lastUpdated: number;
}

export interface Viewer {
  id: string;
  name: string;
  isAdmin: boolean;
}

export interface AreaEntry {
  area_id: string;
  name: string;
  icon: string | null;
  picture: string | null;
  floor_id: string | null;
  aliases: string[];
  labels: string[];
}

export interface DeviceEntry {
  id: string;
  name: string;
  area_id: string | null;
  manufacturer: string | null;
  model: string | null;
  config_entries: string[];
  disabled_by: string | null;
  identifiers: unknown[];
  connections: unknown[];
}

export interface RegistryEntry {
  entity_id: string;
  device_id?: string;
  area_id?: string;
  name?: string;
  icon?: string;
  platform: string;
  hidden?: boolean;
  category?: 'config' | 'diagnostic';
}

export interface ServiceCall {
  domain: string;
  service: string;
  data: Attributes;
  target: Attributes | undefined;
  returnResponse: boolean;
}

export interface WsMessage {
  id?: number;
  type: string;
  [key: string]: unknown;
}

export class HaError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface WsContext {
  fixture: Fixture;
  /** Sends an event to the subscription this message opened. */
  event(payload: unknown): void;
}

export type WsHandler = (message: WsMessage, context: WsContext) => unknown;

/** A service call's answer: what `return_response` hands back. Services without one answer with an empty response. */
export type ServiceHandler = (data: Attributes, target: Attributes | undefined) => unknown;

export interface RestRoute {
  /** Matched against the request path (no origin, no query). */
  match: RegExp;
  respond(path: string, query: URLSearchParams): { status?: number; contentType?: string; body: string | Buffer };
}

/** Everything the mock Home Assistant answers with. */
export interface Fixture {
  now: number;
  viewer: Viewer;
  config: Attributes;
  states: Map<string, StateSeed>;
  areas: AreaEntry[];
  devices: DeviceEntry[];
  entityRegistry: RegistryEntry[];
  /** `frontend/get_system_data` documents by key. */
  systemData: Record<string, unknown>;
  /** Long-term statistics by statistic id. */
  statistics: Record<string, StatSource>;
  /** Recorded states by entity id, oldest first. */
  history: Record<string, HistoryPoint[]>;
  /** Query parameters the page opens with, such as the app's own coffee preview. */
  query: Record<string, string>;
  /** Services that return a response, by `domain.service`. */
  services: Record<string, ServiceHandler>;
  /** Extra websocket commands, by `type`; they win over the built-in ones. */
  ws: Record<string, WsHandler>;
  rest: RestRoute[];
}
