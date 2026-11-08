// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCookState } from '../../../cook/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@iconify/react', () => ({ Icon: ({ icon }: { icon: string }) => createElement('i', { 'data-icon': icon }) }));
const { MomentsRail } = await import('../parts');
const NOW = Date.parse('2026-11-08T18:40:00+01:00');
let root: Root;
beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});
function show(bath: string, probe: string, attributes: Record<string, string> = {}) {
  const state = parseCookState({ state: 'both', attributes: { bath_phase: bath, probe_phase: probe, ...attributes } })!;
  act(() => root.render(createElement(MomentsRail, { state, nowMs: NOW, steps: true })));
}
const icons = () => [...document.querySelectorAll('[data-icon]')].map(node => node.getAttribute('data-icon'));
const current = () => [...document.querySelectorAll('[aria-current="step"]')].map(node => node.textContent);

describe('cooking header step icons', () => {
  it('gives all bath and probe steps distinct icons', () => {
    show('chilling', 'resting');
    expect(icons()).toEqual([
      'mdi:fire',
      'mdi:food-steak',
      'mdi:timer-sand',
      'mdi:check-circle-outline',
      'mdi:snowflake',
      'mdi:fridge-outline',
      'mdi:thermometer',
      'mdi:tray-arrow-up',
      'mdi:timer-sand-complete',
      'mdi:knife',
    ]);
    expect(current()).toEqual(['Chill', 'Resting']);
  });
  it.each([
    ['heating', 'Heating'],
    ['too_hot', 'Heating'],
    ['ready', 'Bag in'],
    ['cooking', 'Cooking'],
    ['done', 'Done'],
    ['chilled', 'Fridge'],
    ['interrupted', 'Stopped'],
  ])('marks the active bath step for %s', (phase, label) => {
    show(phase, 'off');
    expect(current()).toEqual([label]);
    if (phase === 'interrupted') expect(document.querySelector('.cook-steps')?.textContent).not.toContain('Done');
    if (!['chilling', 'chilled'].includes(phase)) {
      expect(icons()).not.toContain('mdi:fridge-outline');
      expect(icons()).not.toContain('mdi:snowflake');
    }
  });
  it.each([
    ['tracking', 'Tracking'],
    ['near', 'Tracking'],
    ['pull', 'Pull'],
    ['resting', 'Resting'],
    ['carve', 'Carve'],
  ])('marks the active probe step for %s', (phase, label) => {
    show('off', phase);
    expect(current()).toEqual([label]);
    expect(icons()).not.toContain('mdi:fire');
  });
  it('retains low water and lost alarms in the header', () => {
    show('cooking', 'tracking', { bath_low_water: '1', probe_stale_since: new Date(NOW - 120_000).toISOString() });
    expect(current()).toEqual(['Low water', 'Probe lost', 'Cooking', 'Tracking']);
  });
});
