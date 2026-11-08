import type { CookEntity } from './model';

export const COOK_DEMO_SCENARIOS = [
  'off',
  'heating',
  'too_hot',
  'ready',
  'cooking',
  'done',
  'chilling',
  'chilled',
  'interrupted',
  'tracking',
  'near',
  'pull',
  'resting',
  'carve',
  'low_water',
  'lost',
  'both',
] as const;
export type CookDemoScenario = (typeof COOK_DEMO_SCENARIOS)[number];
export interface CookDemoSnapshot {
  entities: Readonly<Record<string, CookEntity>>;
}

function readScenario(): CookDemoScenario | null {
  try {
    const value = new URLSearchParams(window.location.search).get('cook_demo');
    return (COOK_DEMO_SCENARIOS as readonly (string | null)[]).includes(value) ? (value as CookDemoScenario) : null;
  } catch {
    return null;
  }
}

const scenario = typeof window === 'undefined' ? null : readScenario();
let snapshot: CookDemoSnapshot | null = null;
const listeners = new Set<() => void>();
export const cookDemoMode = (): CookDemoScenario | null => scenario;
export const cookDemoSnapshot = (): CookDemoSnapshot | null => snapshot;
export function subscribeCookDemo(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (scenario) {
  void import('./demo').then(({ cookDemo }) => {
    const anchorMs = Date.now();
    const publish = () => {
      snapshot = cookDemo(scenario, anchorMs);
      listeners.forEach(listener => listener());
    };
    publish();
  });
}
