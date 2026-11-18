// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sent = vi.hoisted(() => [] as { op?: string; data?: string }[]);
const entities = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('@hakit/core', () => {
  const connection = {
    sendMessagePromise: (message: { service_data?: { op?: string; data?: string } }) => {
      if (message.service_data?.op) sent.push(message.service_data);
      return Promise.resolve(null);
    },
  };
  const state = () => ({ entities: entities.current, hassUrl: '', connection });
  return { useHass: Object.assign(<T>(selector: (snapshot: ReturnType<typeof state>) => T): T => selector(state()), { getState: state }) };
});
vi.mock('@iconify/react', () => ({ Icon: () => null }));
vi.mock('../../../hooks/useViewer', () => ({ useViewer: () => ({ name: 'Kristine', isAdmin: false }) }));

const { default: CoffeeStage } = await import('../CoffeeStage');
const { CoffeeCard } = await import('../CoffeeCard');
const { WrongBeans } = await import('../WrongBeans');
const { parseCoffeeBeans } = await import('../../../coffee/model');
const { bagBrews, beanColors } = await import('../../../coffee/view');

const NOW = Date.parse('2026-11-18T12:00:00Z');
const bag = (id: string, name: string) => ({
  bean_id: id,
  bean_name: name,
  remaining: '300',
  brews_left: '20',
  low: 'no',
  added_at: '2026-11-10T06:00:00+00:00',
  recipe_id: '',
});
const openBags = (...bags: ReturnType<typeof bag>[]) => parseCoffeeBeans({ state: '600', attributes: { v: '1', bags } });
const TWO = openBags(bag('b1', 'Daybreak'), bag('b2', 'Signature Brew'));
const THREE = openBags(bag('b1', 'Daybreak'), bag('b2', 'Signature Brew'), bag('b3', 'Guji'));
const brewAt = (hoursAgo: number, beanName: string | null = 'Daybreak') => ({ id: 'c7', atMs: NOW - hoursAgo * 3_600_000, beanName });

let root: Root;
beforeEach(() => {
  const kept = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    },
  });
  sent.length = 0;
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

const tap = (element: Element | null) => act(() => (element as HTMLElement).click());
const chip = () => document.querySelector('.coffee-wrong-chip') as HTMLElement | null;
const options = () => [...document.querySelectorAll('.coffee-wrong-opt')] as HTMLElement[];
const retags = () => sent.filter(command => command.op === 'beans_retag').map(command => JSON.parse(command.data ?? '{}'));

describe('the wrong-beans correction', () => {
  const show = (brew: ReturnType<typeof brewAt> | null, beans = TWO) =>
    act(() => root.render(createElement(WrongBeans, { brew, beans, nowMs: NOW })));

  it('shows the beans the brew is booked under, and nothing else until it is tapped', () => {
    show(brewAt(3));
    expect(chip()?.textContent).toBe('Daybreak · Wrong beans?');
    expect(chip()?.getAttribute('aria-expanded')).toBe('false');
    expect(options()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('asks only Wrong beans? of a brew booked under no beans', () => {
    show(brewAt(3, null));
    expect(chip()?.textContent).toBe('Wrong beans?');
  });

  it('is not there with one open bag, for a brew a day old, or without a brew', () => {
    show(brewAt(3), openBags(bag('b1', 'Daybreak')));
    expect(chip()).toBeNull();
    show(brewAt(24));
    expect(chip()).toBeNull();
    show(brewAt(23.5));
    expect(chip()).not.toBeNull();
    show(null);
    expect(chip()).toBeNull();
  });

  it('offers the other open bags on a tap, in the colours of the bean picker', () => {
    show(brewAt(3), THREE);
    tap(chip());
    expect(chip()?.getAttribute('aria-expanded')).toBe('true');
    const colors = beanColors(['b1', 'b2', 'b3']);
    expect(options().map(option => [option.textContent, option.style.getPropertyValue('--bean')])).toEqual([
      ['Signature Brew', colors.b2],
      ['Guji', colors.b3],
    ]);
    const pickerColors = bagBrews(
      parseCoffeeBeans({
        state: '600',
        attributes: { v: '1', bags: ['b1', 'b2', 'b3'].map(id => ({ ...bag(id, id), recipe_id: 'r' })) },
      }),
      null
    ).map(item => item.color);
    expect(pickerColors).toEqual([colors.b1, colors.b2, colors.b3]);
  });

  it('retags the brew to the bag tapped, once, and folds away', () => {
    show(brewAt(3));
    tap(chip());
    tap(options()[0]);
    expect(retags()).toEqual([{ brew_id: 'c7', bean_id: 'b2' }]);
    expect(options()).toEqual([]);
    expect(chip()?.getAttribute('aria-expanded')).toBe('false');
  });

  it('folds away without sending anything when the chip is tapped again', () => {
    show(brewAt(3));
    tap(chip());
    tap(chip());
    expect(options()).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe('where the correction shows', () => {
  const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  const place = (phase: string, brewHoursAgo: number, bags = ['b1', 'b2']) => {
    entities.current = {
      'sensor.coffee_state': {
        entity_id: 'sensor.coffee_state',
        state: phase,
        attributes: { v: '1', machine: 'awake', link: 'connected', brew_id: 'c9', cup: 'present', tank_ml: '946', ready_at: iso(0.01) },
      },
      'sensor.coffee_brews': {
        entity_id: 'sensor.coffee_brews',
        state: iso(0),
        attributes: {
          v: '1',
          brews: [
            { id: 'c9', at: iso(brewHoursAgo), outcome: 'complete', recipe_name: 'Daybreak', bean_name: 'Daybreak', variant: 'usual' },
          ],
        },
      },
      'sensor.coffee_beans': {
        entity_id: 'sensor.coffee_beans',
        state: '600',
        attributes: { v: '1', bags: bags.map(id => bag(id, id === 'b1' ? 'Daybreak' : 'Signature Brew')) },
      },
    };
  };
  const card = () => {
    act(() => root.render(createElement(CoffeeCard, { onOpenStage: () => {} })));
    if (document.querySelector('.cc-tabs') == null) tap(document.querySelector('.appliance-header'));
  };
  const stage = () => act(() => root.render(createElement(CoffeeStage, { onClose: () => {} })));

  it.each([
    ['the last brew on the card', 'idle', card],
    ['the finished brew on the card', 'ready', card],
    ['the finished brew on the stage', 'ready', stage],
  ])('is on %s, and sends the new beans for that brew', (_, phase, mount) => {
    place(phase, 3);
    mount();
    expect(chip()?.textContent).toBe('Daybreak · Wrong beans?');
    tap(chip());
    tap(options()[0]);
    expect(retags()).toEqual([{ brew_id: 'c9', bean_id: 'b2' }]);
  });

  it.each([
    ['card', 'idle', card],
    ['card', 'ready', card],
    ['stage', 'ready', stage],
  ])('is not on the %s (%s) for a brew over a day old', (_, phase, mount) => {
    place(phase, 30);
    mount();
    expect(chip()).toBeNull();
  });

  it.each([
    ['card', 'idle', card],
    ['card', 'ready', card],
    ['stage', 'ready', stage],
  ])('is not on the %s (%s) with one open bag', (_, phase, mount) => {
    place(phase, 3, ['b1']);
    mount();
    expect(chip()).toBeNull();
  });

  it('is big on the stage, for a finger', () => {
    place('ready', 3);
    stage();
    expect(chip()?.className).toContain('is-big');
  });
});
