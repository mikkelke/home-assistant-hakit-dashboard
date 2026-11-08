export const COOK_STATE_ENTITY = 'sensor.cook_state';
export const COOK_LIVE_ENTITY = 'sensor.cook_live';
export const COOK_LOG_ENTITY = 'sensor.cook_log';
export const COOK_ENTITY_IDS = [COOK_STATE_ENTITY, COOK_LIVE_ENTITY, COOK_LOG_ENTITY] as const;
export type CookEntityId = (typeof COOK_ENTITY_IDS)[number];
export const COOK_COMMAND_SCRIPT = 'cook_command';
export const COOK_TABLET_VIEWER = 'Rooftop';
export const COOK_AREA_ID = 'kitchen';
