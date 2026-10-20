/** `?coffee_demo=<scenario>` previews the coffee surfaces with made-up entities. The scenarios are their own chunk and
 * load only on a demo URL; every coffee reader asks here first. A demo never sends a command. */
import type { CoffeeEntity } from './state';
import type { CoffeeRecentData } from './recent';

export const COFFEE_DEMO_SCENARIOS = [
  'idle',
  'building',
  'live',
  'paused_no_water',
  'lost_link',
  'ready',
  'trial',
  'trial_brewed',
  'start_failed',
  'asleep',
  'awaiting_cup',
] as const;
export type CoffeeDemoScenario = (typeof COFFEE_DEMO_SCENARIOS)[number];

export interface CoffeeDemoSnapshot {
  entities: Readonly<Record<string, CoffeeEntity>>;
  recent: CoffeeRecentData | null;
}

function readScenario(): CoffeeDemoScenario | null {
  try {
    const value = new URLSearchParams(window.location.search).get('coffee_demo');
    return (COFFEE_DEMO_SCENARIOS as readonly (string | null)[]).includes(value) ? (value as CoffeeDemoScenario) : null;
  } catch {
    return null;
  }
}

const scenario = typeof window === 'undefined' ? null : readScenario();
let snapshot: CoffeeDemoSnapshot | null = null;
const listeners = new Set<() => void>();

export function coffeeDemoMode(): CoffeeDemoScenario | null {
  return scenario;
}

export function coffeeDemoSnapshot(): CoffeeDemoSnapshot | null {
  return snapshot;
}

export function subscribeCoffeeDemo(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (scenario) {
  void import('./demo').then(({ coffeeDemo, coffeeDemoTicks }) => {
    const anchorMs = Date.now();
    const publish = () => {
      snapshot = coffeeDemo(scenario, anchorMs, Date.now());
      listeners.forEach(listener => listener());
    };
    publish();
    if (coffeeDemoTicks(scenario)) setInterval(publish, 1000);
  });
}

const COFFEE_PREFIX = 'sensor.coffee_';

/** `read` with the demo's coffee entities laid over it. */
export function withCoffeeDemo<R extends (entityId: string) => unknown>(read: R): R {
  if (!scenario) return read;
  return ((entityId: string) => (entityId.startsWith(COFFEE_PREFIX) ? snapshot?.entities[entityId] : read(entityId))) as R;
}
