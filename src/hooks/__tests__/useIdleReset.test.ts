// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTE_ADOPTED_EVENT } from '../../utils/navigation';
import { IDLE_RESET_MS, isTextEntryFocused, useIdleReset } from '../useIdleReset';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MINUTE = 60_000;

function Probe({ blocked, onIdle }: { blocked: boolean; onIdle: () => void }) {
  useIdleReset({ timeoutMs: IDLE_RESET_MS, blocked, onIdle });
  return null;
}

let root: Root;
const onIdle = vi.fn();

const mount = (blocked = false) => act(() => root.render(createElement(Probe, { blocked, onIdle })));
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const touch = (type: string) => act(() => void document.body.dispatchEvent(new Event(type, { bubbles: true })));

// A page the system suspended: the clock moves on, the timer does not run.
const sleep = (ms: number) => vi.setSystemTime(Date.now() + ms);
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse('2026-11-07T12:00:00Z'));
  onIdle.mockReset();
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  setVisibility('visible');
  vi.useRealTimers();
});

describe('the idle window', () => {
  it('is three minutes', () => {
    expect(IDLE_RESET_MS).toBe(3 * MINUTE);
  });

  it('calls onIdle once after three idle minutes, and not again without activity', () => {
    mount();
    wait(IDLE_RESET_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();
    wait(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    wait(30 * MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it.each(['pointerdown', 'keydown', 'wheel', 'touchstart'])('is postponed by a %s', type => {
    mount();
    wait(2 * MINUTE);
    touch(type);
    wait(2 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
    wait(MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('is postponed by a scroll inside a nested element, which does not bubble', () => {
    const list = document.body.appendChild(document.createElement('div'));
    mount();
    wait(2 * MINUTE);
    act(() => void list.dispatchEvent(new Event('scroll')));
    wait(2 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
    wait(MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('is postponed by a link the dashboard follows', () => {
    mount();
    wait(2 * MINUTE);
    act(() => void window.dispatchEvent(new Event(ROUTE_ADOPTED_EVENT)));
    wait(2 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
    wait(MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('counts a burst of scrolling from its last event, with one timer', () => {
    mount();
    const timers = vi.getTimerCount();
    for (let i = 0; i < 100; i++) {
      wait(1_000);
      touch('wheel');
    }
    expect(vi.getTimerCount()).toBe(timers);
    wait(IDLE_RESET_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();
    wait(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('goes idle again after activity that follows a reset', () => {
    mount();
    wait(IDLE_RESET_MS);
    expect(onIdle).toHaveBeenCalledTimes(1);
    touch('pointerdown');
    wait(IDLE_RESET_MS - 1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    wait(1);
    expect(onIdle).toHaveBeenCalledTimes(2);
  });

  it('does not count the route event its own reset dispatches as activity', () => {
    onIdle.mockImplementation(() => window.dispatchEvent(new Event(ROUTE_ADOPTED_EVENT)));
    mount();
    wait(IDLE_RESET_MS);
    expect(onIdle).toHaveBeenCalledTimes(1);
    wait(30 * MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('stops for good when the component unmounts', () => {
    mount();
    wait(MINUTE);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    wait(10 * MINUTE);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    setVisibility('visible');
    expect(onIdle).not.toHaveBeenCalled();
    root = createRoot(document.body.appendChild(document.createElement('div')));
  });
});

describe('what holds it back', () => {
  it('does nothing while blocked, and goes idle at the first check after the block lifts', () => {
    mount(true);
    wait(IDLE_RESET_MS);
    wait(IDLE_RESET_MS);
    expect(onIdle).not.toHaveBeenCalled();
    mount(false);
    wait(IDLE_RESET_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();
    wait(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('does nothing while a text field has focus, and goes idle once it loses it', () => {
    const input = document.body.appendChild(document.createElement('input'));
    mount();
    input.focus();
    wait(IDLE_RESET_MS);
    wait(IDLE_RESET_MS);
    expect(onIdle).not.toHaveBeenCalled();
    input.blur();
    wait(IDLE_RESET_MS);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('is not held back by a focused button', () => {
    const button = document.body.appendChild(document.createElement('button'));
    mount();
    button.focus();
    wait(IDLE_RESET_MS);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});

describe('a page that comes back to the foreground', () => {
  it('is idle at once after more than three minutes, without waiting for its timer', () => {
    mount();
    setVisibility('hidden');
    sleep(3 * MINUTE + 1);
    expect(onIdle).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is left alone when it was away for less than three minutes', () => {
    mount();
    setVisibility('hidden');
    sleep(3 * MINUTE - 1);
    setVisibility('visible');
    expect(onIdle).not.toHaveBeenCalled();
    wait(IDLE_RESET_MS);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('counts from the last touch, not from when it went away', () => {
    mount();
    wait(2 * MINUTE);
    setVisibility('hidden');
    sleep(2 * MINUTE);
    setVisibility('visible');
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('is left alone while blocked or while a text field has focus', () => {
    const input = document.body.appendChild(document.createElement('input'));
    mount(true);
    sleep(10 * MINUTE);
    setVisibility('visible');
    expect(onIdle).not.toHaveBeenCalled();
    mount(false);
    input.focus();
    setVisibility('visible');
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('does not reset again when it already did while away', () => {
    mount();
    setVisibility('hidden');
    wait(IDLE_RESET_MS);
    expect(onIdle).toHaveBeenCalledTimes(1);
    sleep(2 * IDLE_RESET_MS);
    setVisibility('visible');
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('is not reset when it goes to the background', () => {
    mount();
    sleep(10 * MINUTE);
    setVisibility('hidden');
    expect(onIdle).not.toHaveBeenCalled();
  });
});

describe('isTextEntryFocused', () => {
  const focusOn = (element: HTMLElement) => {
    document.body.appendChild(element);
    element.focus();
    return isTextEntryFocused();
  };
  const input = (type: string) => Object.assign(document.createElement('input'), { type });

  it('is false when nothing has focus', () => {
    expect(isTextEntryFocused()).toBe(false);
  });

  it.each(['text', 'search', 'email', 'password', 'number', 'tel', 'url', 'date'])('is true for a %s input', type => {
    expect(focusOn(input(type))).toBe(true);
  });

  it.each(['checkbox', 'radio', 'range', 'button', 'submit', 'color', 'file'])('is false for a %s input', type => {
    expect(focusOn(input(type))).toBe(false);
  });

  it('is true for a textarea and a contenteditable element', () => {
    expect(focusOn(document.createElement('textarea'))).toBe(true);
    document.body.innerHTML = '';
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    editable.tabIndex = 0;
    expect(focusOn(editable)).toBe(true);
  });

  it('is false for a button and a plain focusable element', () => {
    expect(focusOn(document.createElement('button'))).toBe(false);
    document.body.innerHTML = '';
    const plain = document.createElement('div');
    plain.tabIndex = 0;
    expect(focusOn(plain)).toBe(false);
  });
});
