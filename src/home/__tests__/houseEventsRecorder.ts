import type { Connection } from 'home-assistant-js-websocket';
import { vi } from 'vitest';

export const HOUSE_EVENTS_ID = 'sensor.house_events';

/** One feed row as the backend writes it. */
export interface LoggedRow {
  ts: string;
  icon: string;
  text: string;
  cause?: string;
  effect?: string;
  by?: string;
  audience?: string;
  audience_users?: string[];
}

export const HISTORY_MESSAGE = 'history/history_during_period';

interface HistoryRequest {
  type: string;
  start_time: string;
  end_time: string;
  entity_ids: string[];
  include_start_time_state: boolean;
}

/** A stand-in for the recorder behind `history/history_during_period` for a `sensor.house_events` that writes a state a
 * little after each new row, carrying the newest `cap` rows. `log` is every row, oldest first. Answers in the
 * compressed shape the websocket sends: `s`, `a`, and `lu` in seconds, the start state stamped with the window's start. */
export function fakeRecorder(log: readonly LoggedRow[], options: { cap?: number; lagMs?: number } = {}) {
  const { cap = 40, lagMs = 16 } = options;
  const states = log.map((_, index) => ({
    atMs: Date.parse(log[index].ts) + lagMs,
    events: log.slice(Math.max(0, index + 1 - cap), index + 1).reverse(),
  }));
  const compressed = (atMs: number, events: readonly LoggedRow[]) => ({
    s: events[0]?.ts ?? '',
    a: { friendly_name: 'House events', icon: 'mdi:timeline-clock-outline', events },
    lu: atMs / 1000,
  });
  const sendMessagePromise = vi.fn(async (message: HistoryRequest) => {
    if (message.type !== HISTORY_MESSAGE) return {};
    const startMs = Date.parse(message.start_time);
    const endMs = Date.parse(message.end_time);
    const before = message.include_start_time_state ? states.filter(state => state.atMs < startMs).at(-1) : undefined;
    const inside = states.filter(state => state.atMs >= startMs && state.atMs < endMs);
    const rows = [...(before ? [compressed(startMs, before.events)] : []), ...inside.map(state => compressed(state.atMs, state.events))];
    return rows.length > 0 ? { [HOUSE_EVENTS_ID]: rows } : {};
  });
  return { connection: { sendMessagePromise } as unknown as Connection, sendMessagePromise };
}

/** `count` rows of one kind, `stepMs` apart, the last at `endIso`, oldest first. */
export function loggedRows(count: number, endIso: string, stepMs: number, text = 'Door opened'): LoggedRow[] {
  const endMs = Date.parse(endIso);
  return Array.from({ length: count }, (_, index) => ({
    ts: new Date(endMs - (count - 1 - index) * stepMs).toISOString(),
    icon: 'mdi:door-open',
    text: `${text} ${index + 1}`,
  }));
}

/** The history requests among the calls a mocked `sendMessagePromise` has had, whatever else the view asked the connection. */
export function historyRequests(sendMessagePromise: { mock: { calls: unknown[][] } }) {
  return sendMessagePromise.mock.calls.map(([message]) => message as HistoryRequest).filter(message => message.type === HISTORY_MESSAGE);
}
