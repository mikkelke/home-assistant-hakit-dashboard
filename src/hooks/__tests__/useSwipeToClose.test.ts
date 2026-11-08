// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSwipeToClose } from '../useSwipeToClose';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A sheet that closes on a swipe; `portal` renders its children into the body, as the app's sheets do. */
function Sheet({ name, onClose, portal = false, children }: { name: string; onClose: () => void; portal?: boolean; children?: ReactNode }) {
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(onClose);
  const panel = createElement(
    'div',
    { 'data-sheet': name, onTouchStart: handleTouchStart, onTouchMove: handleTouchMove, onTouchEnd: handleTouchEnd },
    createElement('span', { 'data-hit': name }, name),
    createElement('button', { 'data-button': name }, 'Press'),
    children
  );
  return portal ? createPortal(panel, document.body) : panel;
}

let root: Root;

const matchMedia = (mobile: boolean) =>
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
    matches: mobile && query === '(max-width: 768px)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

beforeEach(() => {
  matchMedia(true);
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const touch = (type: string, x: number, y: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const points = [{ clientX: x, clientY: y }];
  Object.defineProperties(event, { touches: { value: points }, changedTouches: { value: points } });
  return event;
};

/** A touch from (x0, y0) to (x1, y1) on `target`; returns the touchmove, to tell whether scrolling was cancelled. */
async function drag(target: Element, [x0, y0]: [number, number], [x1, y1]: [number, number]) {
  const move = touch('touchmove', x1, y1);
  await act(async () => {
    target.dispatchEvent(touch('touchstart', x0, y0));
    target.dispatchEvent(move);
    target.dispatchEvent(touch('touchend', x1, y1));
  });
  return move;
}

const hit = (name: string) => document.querySelector(`[data-hit="${name}"]`)!;

describe('a swipe on a sheet', () => {
  it.each([
    ['to the left', [300, 300], [100, 310]],
    ['to the right', [100, 300], [300, 310]],
  ] as const)('closes it when it goes %s', async (_direction, from, to) => {
    const onClose = vi.fn();
    await act(async () => root.render(createElement(Sheet, { name: 'a', onClose })));
    await drag(hit('a'), [...from], [...to]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['short', [100, 300], [140, 300]],
    ['more vertical than horizontal', [100, 100], [200, 400]],
  ] as const)('leaves it open when it is %s', async (_kind, from, to) => {
    const onClose = vi.fn();
    await act(async () => root.render(createElement(Sheet, { name: 'a', onClose })));
    await drag(hit('a'), [...from], [...to]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is ignored when it starts on a button', async () => {
    const onClose = vi.fn();
    await act(async () => root.render(createElement(Sheet, { name: 'a', onClose })));
    await drag(document.querySelector('[data-button="a"]')!, [300, 300], [100, 300]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancels scrolling only for a clear horizontal move', async () => {
    await act(async () => root.render(createElement(Sheet, { name: 'a', onClose: vi.fn() })));
    expect((await drag(hit('a'), [100, 300], [200, 310])).defaultPrevented).toBe(true);
    expect((await drag(hit('a'), [100, 300], [110, 500])).defaultPrevented).toBe(false);
  });

  it('is not listened for off a phone', async () => {
    matchMedia(false);
    const onClose = vi.fn();
    await act(async () => root.render(createElement(Sheet, { name: 'a', onClose })));
    await drag(hit('a'), [300, 300], [100, 300]);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('a sheet over another sheet', () => {
  const stack = (portal: boolean, outerClose: () => void, innerClose: () => void) =>
    createElement(Sheet, { name: 'outer', onClose: outerClose }, createElement(Sheet, { name: 'inner', onClose: innerClose, portal }));

  it.each([false, true])('is the only one a closing swipe closes (portaled: %s)', async portal => {
    const outer = vi.fn();
    const inner = vi.fn();
    await act(async () => root.render(stack(portal, outer, inner)));
    await drag(hit('inner'), [300, 300], [100, 300]);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('leaves the touches of a gesture that closes nothing for the sheet under it to judge', async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const seen: string[] = [];
    await act(async () =>
      root.render(
        createElement('div', { onTouchStart: () => seen.push('start'), onTouchEnd: () => seen.push('end') }, stack(true, outer, inner))
      )
    );
    await drag(hit('inner'), [100, 300], [140, 300]);
    expect(seen).toEqual(['start', 'end']);
    seen.length = 0;
    await drag(hit('inner'), [300, 300], [100, 300]);
    expect(seen).toEqual(['start']);
  });

  it('lets the sheet under it take a swipe that starts there', async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    await act(async () => root.render(stack(true, outer, inner)));
    await drag(hit('outer'), [300, 300], [100, 300]);
    expect(outer).toHaveBeenCalledTimes(1);
    expect(inner).not.toHaveBeenCalled();
  });
});
