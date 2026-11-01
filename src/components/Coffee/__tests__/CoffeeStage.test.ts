// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sent = vi.hoisted(() => [] as { op?: string; data?: string }[]);
const entities = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('@hakit/core', () => {
  const connection = {
    sendMessagePromise: (message: { service_data: { op?: string; data?: string } }) => {
      sent.push(message.service_data);
      return Promise.resolve(null);
    },
  };
  const state = () => ({ entities: entities.current, hassUrl: '', connection });
  return { useHass: Object.assign(<T>(selector: (snapshot: ReturnType<typeof state>) => T): T => selector(state()), { getState: state }) };
});
vi.mock('@iconify/react', () => ({ Icon: () => null }));

const { default: CoffeeStage } = await import('../CoffeeStage');

const coffeeState = (state: string, attributes: Record<string, string>) => ({
  'sensor.coffee_state': {
    entity_id: 'sensor.coffee_state',
    state,
    attributes: { v: '1', machine: 'awake', link: 'connected', ...attributes },
  },
});

let root: Root;
beforeEach(() => {
  sent.length = 0;
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent === label) ?? null;
const show = () => act(() => root.render(createElement(CoffeeStage, { onClose: () => {} })));

describe('the stage after a brew', () => {
  it('goes back to the brew screen on New cup and counts a waiting cup as picked up', () => {
    entities.current = coffeeState('ready', { brew_id: 'c1', ready_at: new Date().toISOString() });
    show();
    expect(button('Hold 1 s to brew')).toBeNull();
    act(() => (button('New cup') as HTMLElement).click());
    expect(sent.map(command => command.op)).toEqual(['picked_up']);
    expect(document.querySelector('.cs-side.is-idle')).not.toBeNull();
  });

  it('goes back without a pickup once the cup is already taken', () => {
    entities.current = coffeeState('picked_up', { brew_id: 'c1' });
    show();
    act(() => (button('New cup') as HTMLElement).click());
    expect(sent).toEqual([]);
    expect(document.querySelector('.cs-side.is-idle')).not.toBeNull();
  });
});
