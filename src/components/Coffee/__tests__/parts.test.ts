// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoffeeState } from '../../../coffee/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@hakit/core', () => ({ useHass: Object.assign(() => undefined, { getState: () => ({ connection: null }) }) }));
vi.mock('@iconify/react', () => ({ Icon: () => null }));

const { CupChip } = await import('../parts');

let root: Root;
beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

function chip(cup: CoffeeState['cup'], machine: CoffeeState['machine']) {
  act(() => root.render(createElement(CupChip, { state: { cup, machine }, big: true })));
  const element = document.querySelector('.coffee-cupchip');
  return element ? `${element.textContent} ${element.classList.contains('is-cof') ? 'lit' : 'dim'}` : null;
}

describe('the Cup chip', () => {
  it('lights once a cup is on, and shows only while the machine is awake to see one', () => {
    expect(chip('present', 'awake')).toBe('Cup on lit');
    expect(chip('absent', 'working')).toBe('No cup dim');
    expect(chip('unknown', 'awake')).toBe('Cup dim');
    expect(chip('present', 'asleep')).toBeNull();
    expect(chip('unknown', null)).toBeNull();
  });
});
