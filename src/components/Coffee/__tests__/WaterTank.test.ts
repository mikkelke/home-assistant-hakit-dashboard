// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const connection = vi.hoisted(() => ({ current: null as { sendMessagePromise: (message: unknown) => Promise<unknown> } | null }));
vi.mock('@hakit/core', () => ({ useHass: { getState: () => ({ connection: connection.current }) } }));
vi.mock('@iconify/react', () => ({ Icon: ({ icon }: { icon: string }) => createElement('i', { 'data-icon': icon }) }));

const { PausedFill, WaterChip, WaterPrompt, WaterSheet } = await import('../WaterTank');

const USUAL = { totalMl: 255 };
const tank = (tankLeftMl: number | null) => ({ tankMl: 946, tankLeftMl });

let root: Root;
let sent: { op?: string; data?: string }[];
beforeEach(() => {
  sent = [];
  connection.current = {
    sendMessagePromise: message => {
      sent.push((message as { service_data: { op?: string; data?: string } }).service_data);
      return Promise.resolve(null);
    },
  };
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

const render = (node: ReturnType<typeof createElement>) => act(() => root.render(node));
const flush = () => act(async () => {});

describe('the water chip', () => {
  const chip = () => document.querySelector('.coffee-waterchip') as HTMLElement;
  const show = (tankLeftMl: number | null, onOpen = vi.fn()) => {
    render(createElement(WaterChip, { state: tank(tankLeftMl), usual: USUAL, big: true, onOpen }));
    return onOpen;
  };

  it('says the cups of the usual that are left', () => {
    show(640);
    expect(chip().textContent).toBe('≈ 2 cups');
    expect(chip().className).toContain('is-sky');
    expect(chip().getAttribute('aria-label')).toBe('Water tank, ≈ 2 cups');
  });

  it('turns amber once the usual no longer fits', () => {
    show(150);
    expect(chip().textContent).toBe('under a cup');
    expect(chip().className).toContain('is-warn');
  });

  it('says so while the level is not known', () => {
    show(null);
    expect(chip().textContent).toBe('Water unknown');
    expect(chip().className).not.toMatch(/is-(sky|warn)/);
    expect(chip().getAttribute('aria-label')).toBe('Water tank, level not known');
  });

  it('opens the sheet when tapped', () => {
    const onOpen = show(640);
    act(() => chip().click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('the water sheet', () => {
  const NOW = Date.parse('2026-10-25T10:00:00Z');
  const note = () => document.querySelector('.coffee-sheet-note')?.textContent;
  const show = (state: { tankMl: number | null; tankLeftMl: number | null; tankFilledAtMs: number | null }, onClose = vi.fn()) => {
    render(createElement(WaterSheet, { state, usual: USUAL, nowMs: NOW, onClose }));
    return onClose;
  };
  const filled = () =>
    [...document.querySelectorAll('.coffee-sheet button')].find(button => button.textContent === 'Filled') as HTMLElement;

  it('says what is counted, in cups of the usual, and when the tank was filled', () => {
    show({ ...tank(640), tankFilledAtMs: Date.parse('2026-10-24T08:10:00Z') });
    expect(document.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('Water tank');
    expect(note()).toBe('About 640 ml left · ≈ 2 cups of the usual · filled Yesterday 10:10');
  });

  it('says under a cup rather than 0 cups', () => {
    show({ ...tank(150), tankFilledAtMs: null });
    expect(note()).toBe('About 150 ml left · under a cup of the usual');
  });

  it('explains that the count starts with the first fill while the level is not known', () => {
    show({ ...tank(null), tankFilledAtMs: null });
    expect(note()).toBe('The level is not counted yet. Fill the tank, then tap Filled to start the count.');
  });

  it('registers the fill once and closes', async () => {
    const onClose = show({ ...tank(150), tankFilledAtMs: null });
    act(() => filled().click());
    await flush();
    expect(sent).toEqual([{ op: 'water_filled', data: '{}' }]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the water prompt', () => {
  const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('.coffee-cupwait button')];
  const show = (busy = false) => {
    const onFilled = vi.fn();
    const onAnyway = vi.fn();
    render(createElement(WaterPrompt, { short: { leftMl: 148, needMl: 315 }, size: 'md', busy, onFilled, onAnyway }));
    return { onFilled, onAnyway };
  };

  it('asks for the tank with what is left and what the cup needs', () => {
    show();
    expect(document.querySelector('.coffee-cupwait b')?.textContent).toBe('Fill the water tank');
    expect(document.querySelector('.coffee-cupwait small')?.textContent).toBe('About 148 ml left · this cup needs 315 ml');
    expect(buttons().map(button => button.textContent)).toEqual(['Start anyway', 'Filled']);
  });

  it('calls the handler of the button tapped', () => {
    const { onFilled, onAnyway } = show();
    act(() => buttons()[1].click());
    expect(onFilled).toHaveBeenCalledTimes(1);
    expect(onAnyway).not.toHaveBeenCalled();
    act(() => buttons()[0].click());
    expect(onAnyway).toHaveBeenCalledTimes(1);
  });

  it('leaves both buttons dead while the fill is being registered', () => {
    const { onFilled, onAnyway } = show(true);
    expect(buttons().every(button => button.disabled)).toBe(true);
    act(() => buttons()[1].click());
    act(() => buttons()[0].click());
    expect(onFilled).not.toHaveBeenCalled();
    expect(onAnyway).not.toHaveBeenCalled();
  });
});

describe('Filled on a brew paused for water', () => {
  const PAUSED_AT = Date.parse('2026-10-25T09:00:00Z');
  const button = () => document.querySelector('.coffee-cupwait-btns button') as HTMLButtonElement;
  const show = (tankFilledAtMs: number | null, pausedSinceMs: number | null = PAUSED_AT) =>
    render(createElement(PausedFill, { state: { tankFilledAtMs, pausedSinceMs }, size: 'xl' }));

  it('tells the coffee app the tank is full, and sends nothing else, the machine resuming by itself', async () => {
    show(Date.parse('2026-10-23T05:10:00Z'));
    expect(button().textContent).toBe('Filled');
    expect(button().disabled).toBe(false);
    act(() => button().click());
    await flush();
    expect(sent).toEqual([{ op: 'water_filled', data: '{}' }]);
  });

  it('is dimmed with a check once a fill has been registered since the pause began', async () => {
    show(PAUSED_AT + 4000);
    expect(button().disabled).toBe(true);
    expect(button().querySelector('[data-icon="mdi:check"]')).not.toBeNull();
    act(() => button().click());
    await flush();
    expect(sent).toEqual([]);
  });

  it('stays live while the pause began after the last fill, or began at a time not known', () => {
    show(PAUSED_AT - 1000);
    expect(button().disabled).toBe(false);
    show(PAUSED_AT + 4000, null);
    expect(button().disabled).toBe(false);
    show(null);
    expect(button().disabled).toBe(false);
    expect(button().querySelector('[data-icon="mdi:water-plus"]')).not.toBeNull();
  });
});
