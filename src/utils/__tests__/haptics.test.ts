// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hapticTick, installTapHaptics, stepTicker } from '../haptics';

let uninstall: () => void;
let vibrate: ReturnType<typeof vi.fn>;

function tap(el: Element) {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 100, clientY: 100 }));
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

  it('ticks for role controls and data-tap elements, not for a pointer cursor alone', () => {
    mount(
      '<div role="switch" id="s"></div><div role="tab" id="t"></div><svg data-tap id="c"></svg><div id="p" style="cursor: pointer"></div>'
    );
    for (const id of ['s', 't', 'c', 'p']) tap(document.getElementById(id)!);
    expect(vibrate).toHaveBeenCalledTimes(3);
  });

  it('ticks a backdrop close but not a tap inside its dialog', () => {
    mount('<div data-backdrop id="scrim"><div role="dialog"><p id="body">Text</p><button id="x">Close</button></div></div>');
    tap(document.getElementById('body')!);
    expect(vibrate).not.toHaveBeenCalled();
    tap(document.getElementById('scrim')!);
    tap(document.getElementById('x')!);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('ticks a tap on a list item text, and stays quiet in a data-tap="off" gap', () => {
    mount(
      '<li><div class="list-item" data-tap><button role="checkbox"></button><span id="text">Milk</span></div></li><div role="button"><span data-tap="off" id="gap"><button id="q"></button></span></div>'
    );
    tap(document.getElementById('text')!);
    expect(vibrate).toHaveBeenCalledTimes(1);
    tap(document.getElementById('gap')!);
    expect(vibrate).toHaveBeenCalledTimes(1);
    tap(document.getElementById('q')!);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('stays quiet when the press travels into a swipe or a scroll', () => {
    mount('<div role="button" id="row"></div>');
    const row = document.getElementById('row')!;
    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
    row.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 160, clientY: 104 }));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
    row.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(vibrate).not.toHaveBeenCalled();
    tap(row);
    expect(vibrate).toHaveBeenCalledTimes(1);
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
    strip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
    hapticTick();
    strip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 104, clientY: 100 }));
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

describe('stepTicker', () => {
  it('ticks once per tenth crossed during a drag', () => {
    const ticks = stepTicker();
    ticks.begin(0.05);
    for (const f of [0.08, 0.12, 0.18, 0.25, 0.29, 0.31, 0.33]) ticks.move(f);
    expect(vibrate).toHaveBeenCalledTimes(3);
  });

  it('stays quiet for a small drag inside one step', () => {
    const ticks = stepTicker();
    ticks.begin(0.41);
    ticks.move(0.43);
    ticks.move(0.49);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('adds no tick for the release click of a slider drag', () => {
    mount('<input type="range" id="r" />');
    const range = document.getElementById('r')!;
    const ticks = stepTicker();
    range.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
    ticks.begin(0.2);
    ticks.move(0.35);
    ticks.end();
    range.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('never ticks for a value that changes outside a drag', () => {
    const ticks = stepTicker();
    ticks.move(0.9);
    ticks.begin(0.1);
    ticks.end();
    ticks.move(0.5);
    expect(vibrate).not.toHaveBeenCalled();
  });
});
