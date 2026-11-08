import { useHass } from '@hakit/core';
import { cookDemoMode } from './demoStore';
import { COOK_COMMAND_SCRIPT } from './entities';
import type { PresetKey } from './model';

export interface CookCommands {
  bath_start: { target: number };
  bath_stop: Record<string, never>;
  bag_in: { minutes: number };
  bath_extend: { minutes: number };
  chill: Record<string, never>;
  bath_clear: Record<string, never>;
  silence: Record<string, never>;
  probe_preset: { key: Exclude<PresetKey, 'custom'> } | { key: 'custom'; serve: number };
  probe_pulled: Record<string, never>;
  probe_done: Record<string, never>;
}

export type CookOp = keyof CookCommands;

export function cookCommandMessage<Op extends CookOp>(op: Op, data: CookCommands[Op]) {
  return {
    type: 'call_service' as const,
    domain: 'script',
    service: COOK_COMMAND_SCRIPT,
    service_data: { op, data: JSON.stringify(data) },
  };
}

type Sender = (message: ReturnType<typeof cookCommandMessage>) => Promise<unknown>;
const liveSender: Sender = message => {
  const connection = useHass.getState().connection;
  return connection ? connection.sendMessagePromise(message) : Promise.reject(new Error('Not connected to Home Assistant'));
};

export function sendCookCommand<Op extends CookOp>(op: Op, data: CookCommands[Op], send: Sender = liveSender): Promise<unknown> {
  if (cookDemoMode() != null) return Promise.resolve(null);
  try {
    return send(cookCommandMessage(op, data));
  } catch (error) {
    return Promise.reject(error);
  }
}
