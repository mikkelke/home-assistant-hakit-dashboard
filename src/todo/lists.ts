import { attrStr, type HassEntity } from '../types';

export interface TodoList {
  id: string;
  name: string;
  icon: string;
}

const DEFAULT_ICON = 'mdi:format-list-checkbox';

const KNOWN_ICONS: Record<string, string> = {
  'todo.indkob': 'mdi:cart-outline',
  'todo.firma_indkob': 'mdi:storefront-outline',
  'todo.husk_hjemme': 'mdi:home-outline',
  'todo.husk_kontor': 'mdi:office-building-outline',
  'todo.net_kob': 'mdi:package-variant-closed',
  'todo.todo': 'mdi:format-list-checks',
};

export const isTodoEntityId = (entityId: string) => entityId.startsWith('todo.');

/** A list named by its entity's friendly name, with the icon Home Assistant gives it, else the one this dashboard knows. */
export function toTodoList(entity: HassEntity): TodoList {
  const icon = entity.attributes?.icon;
  return {
    id: entity.entity_id,
    name: attrStr(entity.attributes?.friendly_name, entity.entity_id),
    icon: typeof icon === 'string' && icon.startsWith('mdi:') ? icon : (KNOWN_ICONS[entity.entity_id] ?? DEFAULT_ICON),
  };
}

export function sortLists(lists: readonly TodoList[]): TodoList[] {
  return [...lists].sort((a, b) => a.name.localeCompare(b.name, 'da') || a.id.localeCompare(b.id));
}
