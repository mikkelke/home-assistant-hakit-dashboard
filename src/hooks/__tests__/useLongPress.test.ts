// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLongPress } from '../useLongPress';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let button: HTMLButtonElement;
const onHold = vi.fn();
const onTap = vi.fn();
const counts = () => [onHold.mock.calls.length, onTap.mock.calls.length];

function Button() {
  const hold = useLongPress(onHold);
  return createElement('button', { type: 'button', onClick: onTap, ...hold });
}

const pointer = (type: string, init: PointerEventInit = {}) =>
  act(() => {
    button.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0, ...init })
    );
  });

const click = () =>
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });

const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  onHold.mockClear();
  onTap.mockClear();
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(createElement(Button)));
  button = host.querySelector('button') as HTMLButtonElement;
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('useLongPress', () => {
  it('fires once after 1.5 s and swallows the click its release makes', () => {
    pointer('pointerdown');
    wait(1499);
    expect(onHold).not.toHaveBeenCalled();
    wait(1);
    expect(onHold).toHaveBeenCalledTimes(1);
    pointer('pointerup');
    click();
    wait(5000);
    expect(counts()).toEqual([1, 0]);
  });

  it('leaves a short press to the tap', () => {
    pointer('pointerdown');
    wait(1000);
    pointer('pointerup');
    click();
    wait(2000);
    expect(counts()).toEqual([0, 1]);
  });

  it('is cancelled by a move past the slop but not by a small drift', () => {
    pointer('pointerdown');
    pointer('pointermove', { clientX: 11 });
    wait(2000);
    expect(onHold).not.toHaveBeenCalled();
    pointer('pointerdown');
    pointer('pointermove', { clientX: 3, clientY: 3 });
    wait(1500);
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it('is cancelled when the browser takes the touch for a scroll', () => {
    pointer('pointerdown');
    pointer('pointercancel');
    wait(2000);
    expect(onHold).not.toHaveBeenCalled();
  });

  it('does not swallow the next tap when the platform sent no click after a hold', () => {
    pointer('pointerdown');
    wait(1500);
    pointer('pointerup');
    pointer('pointerdown');
    pointer('pointerup');
    click();
    expect(counts()).toEqual([1, 1]);
  });

  it('ignores a right-button mouse hold', () => {
    pointer('pointerdown', { pointerType: 'mouse', button: 2 });
    wait(2000);
    expect(onHold).not.toHaveBeenCalled();
  });

  it("fires at the platform's own long press and not again when the timer would have", () => {
    pointer('pointerdown');
    wait(500);
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => {
      button.dispatchEvent(menu);
    });
    expect(onHold).toHaveBeenCalledTimes(1);
    wait(2000);
    pointer('pointerup');
    click();
    expect(counts()).toEqual([1, 0]);
  });

  it('keeps the context menu away', () => {
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => {
      button.dispatchEvent(menu);
    });
    expect(menu.defaultPrevented).toBe(true);
  });
});
