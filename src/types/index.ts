// Home Assistant Entity Types
export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

export interface HassEntities {
  [entity_id: string]: HassEntity;
}

// Area Types
export interface Area {
  area_id: string;
  name: string;
  icon?: string;
  picture?: string;
}

// Speaker Types
export interface Speaker {
  id: string;
  name: string;
}

// Component Props
export interface StatusItemProps {
  icon: string;
  label: string;
  count: number;
  countDisplay?: string;
  active?: boolean;
}

export interface PersonStatusProps {
  entity: string;
  entities: HassEntities;
  hassUrl: string | null;
}

export interface RoomCardProps {
  area: Area;
  entities: HassEntities;
  onClick: () => void;
  isSelected: boolean;
  hassUrl: string | null;
}

export interface RoomDetailProps {
  area: Area;
  entities: HassEntities;
  hassUrl: string | null;
  callService: CallServiceFunction | undefined;
  onClose: () => void;
  isMobile: boolean;
}

export interface SonosPlayerProps {
  entityId: string;
  entities: HassEntities;
  hassUrl: string | null;
  callService: CallServiceFunction | undefined;
}

// Service Call Types
export interface ServiceCallArgs {
  domain: string;
  service: string;
  target?: { entity_id: string | string[] };
  serviceData?: Record<string, unknown>;
}

export type CallServiceFunction = (args: ServiceCallArgs) => void;

/** Safe coerce entity attribute to number; use default if missing or NaN. */
export function attrNum(value: unknown, defaultVal: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultVal;
}

/** Safe coerce entity attribute to string array. */
export function attrStringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

/** Safe coerce entity attribute to string. */
export function attrStr(value: unknown, defaultVal = ''): string {
  if (value == null) return defaultVal;
  return typeof value === 'string' ? value : String(value);
}
