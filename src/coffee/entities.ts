/** The coffee app's entities (AppDaemon CoffeeMachine, contract v1) and the HA pieces the dashboard calls. */

export const COFFEE_STATE_ENTITY = 'sensor.coffee_state';
export const COFFEE_LIVE_ENTITY = 'sensor.coffee_live';
export const COFFEE_BASELINE_ENTITY = 'sensor.coffee_baseline';
export const COFFEE_BEANS_ENTITY = 'sensor.coffee_beans';
export const COFFEE_BREWS_ENTITY = 'sensor.coffee_brews';
export const COFFEE_RECIPES_ENTITY = 'sensor.coffee_recipes';
export const COFFEE_ADVICE_ENTITY = 'sensor.coffee_advice';

export const COFFEE_ENTITY_IDS = [
  COFFEE_STATE_ENTITY,
  COFFEE_LIVE_ENTITY,
  COFFEE_BASELINE_ENTITY,
  COFFEE_BEANS_ENTITY,
  COFFEE_BREWS_ENTITY,
  COFFEE_RECIPES_ENTITY,
  COFFEE_ADVICE_ENTITY,
] as const;

export type CoffeeEntityId = (typeof COFFEE_ENTITY_IDS)[number];

/** The contract version every coffee entity carries in `v`. */
export const COFFEE_CONTRACT_VERSION = '1';

/** `script.coffee_command`: fires `coffee_command` in the caller's context, because only an admin may fire an event
 * over the websocket. */
export const COFFEE_COMMAND_SCRIPT = 'coffee_command';

/** `shell_command.coffee_recent`: the last 60 days of curves from /media/coffee/recent.json. */
export const COFFEE_RECENT_SERVICE = 'coffee_recent';

/** The HA user the wine-fridge tablet is signed in as. */
export const COFFEE_TABLET_VIEWER = 'Rooftop';

/** HA area the machine stands in. */
export const COFFEE_AREA_ID = 'kitchen';

/** Where an admin imports an xBloom share link: the integration's options flow. */
export const XBLOOM_INTEGRATION_PATH = '/config/integrations/integration/xbloom';

/** The usual top-up, in grams, and the size the beans bar is drawn against. */
export const BEANS_TOP_UP_G = 250;
