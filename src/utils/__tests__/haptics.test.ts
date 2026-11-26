// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hapticTick, installTapHaptics } from '../haptics';

let uninstall: () => void;
let vibrate: ReturnType<typeof vi.fn>;

function tap(el: Element) {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function mount(html: string) {
  document.body.innerHTML = html;
}

beforeEach(() => {
  vibrate = vi.fn();
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
  uninstall = installTapHaptics(window);
});

afterEach(() => {
  uninstall();
  document.body.innerHTML = '';
});

describe('installTapHaptics', () => {
  it('ticks once for a tap on a button, also when its handler stops propagation', () => {
    mount('<div class="card"><button id="b"><span id="label">Go</span></button></div>');
    document.getElementById('b')!.addEventListener('click', e => e.stopPropagation());
    tap(document.getElementById('label')!);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('ticks for role controls and pointer-cursor elements', () => {
    mount('<div role="switch" id="s"></div><div role="tab" id="t"></div><div id="p" style="cursor: pointer"></div>');
    for (const id of ['s', 't', 'p']) tap(document.getElementById(id)!);
    expect(vibrate).toHaveBeenCalledTimes(3);
  });

  it('stays quiet on empty card space and on disabled controls', () => {
    mount(
      '<div class="card" id="c"><p id="text">21.4°</p></div><button id="d" disabled></button><div role="button" aria-disabled="true" id="a"></div>'
    );
    for (const id of ['c', 'text', 'd', 'a']) tap(document.getElementById(id)!);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('gives a slider drag no second tick from its release click', () => {
    mount('<div role="button" id="strip"></div>');
    const strip = document.getElementById('strip')!;
    strip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    hapticTick();
    strip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    strip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('gives a completed hold no second tick, and ticks the next tap again', () => {
    mount('<button id="hold"></button>');
    const hold = document.getElementById('hold')!;
    hold.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    hapticTick();
    hold.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(vibrate).toHaveBeenCalledTimes(1);
    tap(hold);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });
});
