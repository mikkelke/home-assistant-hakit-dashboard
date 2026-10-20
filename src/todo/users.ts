import { COFFEE_TABLET_VIEWER } from '../coffee/entities';

export interface ListUser {
  id: string;
  label: string;
}

export const TABLET_LABEL = 'Tablet';

/** Accounts the automation runs as; no list is meant for them. */
const SERVICE_ACCOUNTS: ReadonlySet<string> = new Set(['appdaemon', 'nodered']);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The people and devices a list can be shared with, out of the reply of `config/auth/list`: active users that Home Assistant does not
 * keep for itself, without the service accounts and without `selfId`. The user of the kitchen tablet is labelled "Tablet". */
export function shareableUsers(reply: unknown, selfId: string | null): ListUser[] {
  if (!Array.isArray(reply)) return [];
  const users: ListUser[] = [];
  for (const entry of reply) {
    if (!isObject(entry) || typeof entry.id !== 'string' || entry.id === '' || entry.id === selfId) continue;
    if (entry.is_active !== true || entry.system_generated === true) continue;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (name === '' || SERVICE_ACCOUNTS.has(name.toLowerCase())) continue;
    users.push({ id: entry.id, label: name === COFFEE_TABLET_VIEWER ? TABLET_LABEL : name });
  }
  return users.sort((a, b) => a.label.localeCompare(b.label, 'da'));
}
