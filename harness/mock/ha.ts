import type { Page } from '@playwright/test';
import { historyDuringPeriod, listStatisticIds, statisticsDuringPeriod } from './recorder';
import { HaError, type Fixture, type ServiceCall, type StateSeed, type WsContext, type WsHandler, type WsMessage } from '../fixtures/types';

const HA_VERSION = '2026.10.1';

const NUMERIC_DEVICE_CLASSES = ['battery', 'humidity', 'illuminance', 'power', 'energy', 'temperature', 'pressure', 'wind_speed'];

const SERVICES: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries({
    light: ['turn_on', 'turn_off', 'toggle'],
    switch: ['turn_on', 'turn_off', 'toggle'],
    input_boolean: ['turn_on', 'turn_off', 'toggle'],
    input_button: ['press'],
    input_select: ['select_option'],
    input_number: ['set_value'],
    input_text: ['set_value'],
    input_datetime: ['set_datetime'],
    button: ['press'],
    select: ['select_option'],
    number: ['set_value'],
    climate: ['set_temperature', 'set_hvac_mode', 'turn_on', 'turn_off'],
    cover: ['open_cover', 'close_cover', 'set_cover_position', 'stop_cover'],
    media_player: ['media_play', 'media_pause', 'volume_set', 'select_source', 'play_media', 'join', 'unjoin'],
    vacuum: ['start', 'pause', 'return_to_base'],
    lock: ['lock', 'unlock'],
    script: ['turn_on'],
    todo: ['add_item', 'update_item', 'remove_completed_items'],
    weather: ['get_forecasts'],
    shell_command: ['coffee_recent'],
  }).map(([domain, services]) => [domain, Object.fromEntries(services.map(name => [name, { name, description: '', fields: {} }]))])
);

export interface MockHa {
  calls: ServiceCall[];
  /** Websocket commands nothing answered. */
  misses: Set<string>;
  /** Replaces or adds a state and tells every open entity subscription. */
  setState(entityId: string, state: string, attributes?: Record<string, unknown>): void;
}

function compress(seed: StateSeed) {
  return { s: seed.state, a: seed.attributes, c: 'ctx', lc: seed.lastChanged / 1000, lu: seed.lastUpdated / 1000 };
}

function entityList(fixture: Fixture) {
  return [...fixture.states].map(([entity_id, seed]) => ({
    entity_id,
    state: seed.state,
    attributes: seed.attributes,
    last_changed: new Date(seed.lastChanged).toISOString(),
    last_updated: new Date(seed.lastUpdated).toISOString(),
    context: { id: 'ctx', parent_id: null, user_id: null },
  }));
}

function builtins(fixture: Fixture, mock: MockHa): Record<string, WsHandler> {
  const { viewer } = fixture;
  const document = (message: WsMessage): { value: unknown } => ({ value: fixture.systemData[String(message.key)] ?? null });
  return {
    supported_features: () => null,
    'auth/current_user': () => ({
      id: viewer.id,
      name: viewer.name,
      is_owner: viewer.isAdmin,
      is_admin: viewer.isAdmin,
      credentials: [],
      mfa_modules: [],
    }),
    get_config: () => fixture.config,
    get_services: () => SERVICES,
    get_states: () => entityList(fixture),
    'config/area_registry/list': () => fixture.areas,
    'config/floor_registry/list': () => [],
    'config/device_registry/list': () => fixture.devices,
    'config/entity_registry/list': () => fixture.entityRegistry,
    'config/entity_registry/list_for_display': () => ({
      entity_categories: { 0: 'config', 1: 'diagnostic' },
      entities: fixture.entityRegistry.map(entry => ({
        ei: entry.entity_id,
        di: entry.device_id,
        ai: entry.area_id,
        en: entry.name,
        ic: entry.icon,
        pl: entry.platform,
        hb: entry.hidden,
        ec: entry.category === 'config' ? 0 : entry.category === 'diagnostic' ? 1 : undefined,
      })),
    }),
    'config/auth/list': () => {
      if (!viewer.isAdmin) throw new HaError('unauthorized', 'Unauthorized');
      return [
        {
          id: viewer.id,
          username: viewer.name.toLowerCase(),
          name: viewer.name,
          is_owner: true,
          is_active: true,
          system_generated: false,
          group_ids: ['system-admin'],
          local_only: false,
        },
      ];
    },
    'sensor/numeric_device_classes': () => ({ numeric_device_classes: NUMERIC_DEVICE_CLASSES }),
    'frontend/subscribe_user_data': (_message, context) => {
      context.event({ value: null });
      return null;
    },
    'frontend/get_system_data': document,
    'frontend/subscribe_system_data': (message, context) => {
      context.event(document(message));
      return null;
    },
    'frontend/set_system_data': message => {
      fixture.systemData[String(message.key)] = message.value;
      return null;
    },
    'recorder/statistics_during_period': message => statisticsDuringPeriod(fixture, message),
    'recorder/list_statistic_ids': () => listStatisticIds(fixture),
    'history/history_during_period': message => historyDuringPeriod(fixture, message),
    subscribe_events: () => null,
    unsubscribe_events: () => null,
    call_service: message => {
      const domain = String(message.domain);
      const service = String(message.service);
      const data = (message.service_data ?? {}) as Record<string, unknown>;
      const target = message.target as Record<string, unknown> | undefined;
      mock.calls.push({ domain, service, data, target, returnResponse: message.return_response === true });
      const context = { id: 'ctx', parent_id: null, user_id: viewer.id };
      if (message.return_response !== true) return { context };
      return { context, response: fixture.services[`${domain}.${service}`]?.(data, target) ?? {} };
    },
  };
}

export async function mockHa(page: Page, fixture: Fixture): Promise<MockHa> {
  const streams = new Set<(payload: unknown) => void>();
  const mock: MockHa = {
    calls: [],
    misses: new Set(),
    setState(entityId, state, attributes) {
      const previous = fixture.states.get(entityId);
      const seed: StateSeed = {
        state,
        attributes: attributes ?? previous?.attributes ?? {},
        lastChanged: fixture.now,
        lastUpdated: fixture.now,
      };
      fixture.states.set(entityId, seed);
      const payload = previous ? { c: { [entityId]: { '+': compress(seed) } } } : { a: { [entityId]: compress(seed) } };
      streams.forEach(emit => emit(payload));
    },
  };
  const handlers: Record<string, WsHandler> = { ...builtins(fixture, mock), ...fixture.ws };

  await page.routeWebSocket(/\/api\/websocket$/, ws => {
    const send = (payload: unknown) => ws.send(JSON.stringify(payload));
    const mine = new Set<(payload: unknown) => void>();
    send({ type: 'auth_required', ha_version: HA_VERSION });

    ws.onMessage(raw => {
      const message = JSON.parse(String(raw)) as WsMessage;
      if (message.type === 'auth') {
        send({ type: 'auth_ok', ha_version: HA_VERSION });
        return;
      }
      const id = message.id;
      if (id === undefined) return;
      if (message.type === 'ping') {
        send({ id, type: 'pong' });
        return;
      }
      const event = (payload: unknown) => send({ id, type: 'event', event: payload });
      if (message.type === 'subscribe_entities') {
        streams.add(event);
        mine.add(event);
        send({ id, type: 'result', success: true, result: null });
        event({ a: Object.fromEntries([...fixture.states].map(([entityId, seed]) => [entityId, compress(seed)])) });
        return;
      }
      const handler = handlers[message.type];
      if (!handler) {
        mock.misses.add(message.type);
        send({ id, type: 'result', success: false, error: { code: 'unknown_command', message: `Unknown command: ${message.type}` } });
        return;
      }
      const context: WsContext = { fixture, event };
      Promise.resolve()
        .then(() => handler(message, context))
        .then(
          result => send({ id, type: 'result', success: true, result }),
          (error: unknown) => {
            if (!(error instanceof HaError)) mock.misses.add(`${message.type}: ${String(error)}`);
            const failure = error instanceof HaError ? error : new HaError('home_assistant_error', String(error));
            send({ id, type: 'result', success: false, error: { code: failure.code, message: failure.message } });
          }
        );
    });
    ws.onClose(() => mine.forEach(emit => streams.delete(emit)));
  });

  return mock;
}
