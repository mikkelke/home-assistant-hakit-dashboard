// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRICE_FORECAST_ENTITY_ID } from '../../config/energy';
import type { PricePointMs } from '../priceTimeline';
import { home } from './testUtils';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PRICE_ENTITY_ID = 'sensor.energi_data_service';

/** A stand-in for the @hakit/core store: `useHass(selector)` plus getState and subscribe. */
const store = vi.hoisted(() => {
  type State = { entities: Record<string, unknown>; connection: object };
  let state: State = { entities: {}, connection: {} };
  const listeners = new Set<(state: State) => void>();
  return {
    getState: () => state,
    setState(patch: Partial<State>) {
      state = { ...state, ...patch };
      listeners.forEach(listener => listener(state));
    },
    subscribe(listener: (state: State) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock('@hakit/core', async () => {
  const { useSyncExternalStore } = await import('react');
  const useHass = <T>(selector: (state: ReturnType<typeof store.getState>) => T): T =>
    useSyncExternalStore(store.subscribe, () => selector(store.getState()));
  return { useHass: Object.assign(useHass, store) };
});
vi.mock('../useEnergyConfig', () => ({
  useEnergyConfig: () => ({ config: { priceEntityId: 'sensor.energi_data_service' }, loading: false, error: null }),
}));

const { useAppliancePlans } = await import('../useAppliancePlans');

/** One home-time day of hours, as the entities write them: local ISO with its offset. */
function day(date: string, price: (hour: number) => number) {
  return Array.from({ length: 24 }, (_, hour) => ({ hour: `${date}T${String(hour).padStart(2, '0')}:00:00+01:00`, price: price(hour) }));
}

function entity(entityId: string, attributes: Record<string, unknown>) {
  return { entity_id: entityId, state: 'x', attributes };
}

function Timeline() {
  return createElement('pre', null, JSON.stringify(useAppliancePlans().timeline));
}

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(home(2026, 11, 25, 17));
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

async function timelineFor(entities: Record<string, unknown>): Promise<PricePointMs[]> {
  store.setState({ entities });
  await act(async () => {
    root.render(createElement(Timeline));
  });
  return JSON.parse(container.textContent ?? '[]') as PricePointMs[];
}

describe('forecast hours in the plan timeline', () => {
  it('come from the price forecast entity and are marked estimated', async () => {
    const timeline = await timelineFor({
      [PRICE_ENTITY_ID]: entity(PRICE_ENTITY_ID, { raw_today: day('2026-11-25', () => 2), raw_tomorrow: [], tomorrow_valid: false }),
      [PRICE_FORECAST_ENTITY_ID]: entity(PRICE_FORECAST_ENTITY_ID, { forecast: day('2026-11-26', hour => 3 + hour / 100) }),
    });

    expect(timeline).toHaveLength(48);
    expect(timeline.slice(0, 24).every(point => point.price === 2 && point.estimated === undefined)).toBe(true);
    expect(timeline.slice(24).every(point => point.estimated === true)).toBe(true);
    expect(timeline[24]).toEqual({ ms: home(2026, 11, 26, 0), price: 3, estimated: true });
    expect(timeline[47]).toEqual({ ms: home(2026, 11, 26, 23), price: 3.23, estimated: true });
  });

  it('never come from a forecast attribute on the price entity', async () => {
    const timeline = await timelineFor({
      [PRICE_ENTITY_ID]: entity(PRICE_ENTITY_ID, {
        raw_today: day('2026-11-25', () => 2),
        raw_tomorrow: [],
        tomorrow_valid: false,
        forecast: day('2026-11-26', () => 9),
      }),
    });

    expect(timeline).toHaveLength(24);
    expect(timeline.every(point => point.estimated === undefined)).toBe(true);
  });

  it('give way to published prices for the same hour', async () => {
    const timeline = await timelineFor({
      [PRICE_ENTITY_ID]: entity(PRICE_ENTITY_ID, {
        raw_today: day('2026-11-25', () => 2),
        raw_tomorrow: day('2026-11-26', () => 4),
        tomorrow_valid: true,
      }),
      [PRICE_FORECAST_ENTITY_ID]: entity(PRICE_FORECAST_ENTITY_ID, {
        forecast: [...day('2026-11-26', () => 9), ...day('2026-11-27', () => 5)],
      }),
    });

    expect(timeline).toHaveLength(72);
    expect(timeline.slice(24, 48).every(point => point.price === 4 && point.estimated === undefined)).toBe(true);
    expect(timeline.slice(48).every(point => point.price === 5 && point.estimated === true)).toBe(true);
  });
});
