/** Dashboard commands to the coffee app. They go through `script.coffee_command`, which fires `coffee_command` in the
 * caller's own context: HA lets only an admin fire an event over the websocket, and the housemates and the tablet are
 * not admins. */
import { useHass } from '@hakit/core';
import { coffeeDemoMode } from './demoStore';
import { COFFEE_COMMAND_SCRIPT } from './entities';
import type { PersonKey, Taste } from './model';

export interface CoffeeCommands {
  start: {
    variant: 'usual' | 'base' | 'tweak';
    dose?: number;
    ratio?: number;
    grind_size?: number;
    temperature?: number;
    /** Brews the recipe named like this bag's beans, whatever the usual is. */
    bean_id?: string;
  };
  cup_confirmed: Record<string, never>;
  cancel: Record<string, never>;
  stop: Record<string, never>;
  pause: Record<string, never>;
  resume: Record<string, never>;
  connect: Record<string, never>;
  notify: { person: PersonKey | 'none' };
  picked_up: { brew_id: string };
  rate: { brew_id: string; taste: Taste };
  beans_add: { grams: number; bean_id?: string; new_name?: string };
  beans_empty: { bean_id: string };
  beans_retag: { brew_id: string; bean_id: string };
  beans_undo: { op_id: string };
  water_filled: Record<string, never>;
  select: { recipe_id: string };
  save_brew: { brew_id: string; new_name?: string };
  trial_accept: { advice_id: string };
  trial_undo: { advice_id: string };
  trial_keep: { advice_id: string };
  trial_revert: { advice_id: string };
  advice_dismiss: { advice_id: string };
  advisor_reply: { advice_id: string; text: string };
}

export type CoffeeOp = keyof CoffeeCommands;

/** The longest reply the advisor takes. */
export const ADVISOR_REPLY_MAX = 500;

/** The longest name the coffee app keeps for beans. */
export const BEAN_NAME_MAX = 40;

/** A bean name as the coffee app keeps it: ASCII only, white space collapsed, at most `BEAN_NAME_MAX` characters. */
export function cleanBeanName(name: string): string {
  const ascii = Array.from(name, char => (char.charCodeAt(0) < 128 ? char : '')).join('');
  return ascii.split(/\s+/).filter(Boolean).join(' ').slice(0, BEAN_NAME_MAX).trim();
}

/** Whether a cleaned bean name still has a letter or digit in it, which the coffee app needs to take it. */
export const nameableBeans = (cleaned: string): boolean => /[A-Za-z0-9]/.test(cleaned);

/** The websocket message that runs the script with one op. */
export function coffeeCommandMessage<Op extends CoffeeOp>(op: Op, data: CoffeeCommands[Op]) {
  return {
    type: 'call_service' as const,
    domain: 'script',
    service: COFFEE_COMMAND_SCRIPT,
    service_data: { op, data: JSON.stringify(data) },
  };
}

type Sender = (message: ReturnType<typeof coffeeCommandMessage>) => Promise<unknown>;

const liveSender: Sender = message => {
  const connection = useHass.getState().connection;
  if (!connection) return Promise.reject(new Error('Not connected to Home Assistant'));
  return connection.sendMessagePromise(message);
};

/** Sends one command. A `?coffee_demo=` preview never reaches the machine. */
export function sendCoffeeCommand<Op extends CoffeeOp>(op: Op, data: CoffeeCommands[Op], send: Sender = liveSender): Promise<unknown> {
  if (coffeeDemoMode() != null) return Promise.resolve(null);
  try {
    return send(coffeeCommandMessage(op, data)).catch(error => {
      console.debug(`coffee_command ${op} failed:`, error);
      throw error;
    });
  } catch (error) {
    return Promise.reject(error);
  }
}
