// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROBE_PHASES, parseCookState, parseCookLive, type CookState, type CookLive } from '../../../cook/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = vi.hoisted(() => ({
  state: null as CookState | null,
  live: null as CookLive | null,
  anova: undefined as string | undefined,
}));
vi.mock('../../../cook/command', () => ({ sendCookCommand: () => Promise.resolve(null) }));
vi.mock('../../../cook/useCook', () => ({ useCookState: () => fixture.state, useCookLive: () => fixture.live }));
vi.mock('@hakit/core', () => ({
  useHass: (selector: (store: { entities: Record<string, { state: string }> }) => unknown) =>
    selector({ entities: fixture.anova == null ? {} : { 'climate.anova_cooker': { state: fixture.anova } } }),
}));
vi.mock('../useCookTakeover', () => ({ useCookTakeover: () => {} }));
vi.mock('../../Coffee/useClock', () => ({ useClock: () => Date.parse('2026-11-08T18:00:00+01:00') }));
vi.mock('@iconify/react', () => ({ Icon: () => null }));
const { default: CookStage } = await import('../CookStage');

let root: Root;
function show(attributes: Record<string, string> = {}) {
  fixture.state = parseCookState({
    state: 'both',
    attributes: {
      v: '1',
      bath_phase: 'cooking',
      bath_temp: '58',
      bath_target: '58',
      bath_done_at: '2026-11-08T19:40:00+01:00',
      probe_phase: 'tracking',
      probe_preset: 'beef',
      probe_core: '43.5',
      probe_pull: '50',
      probe_serve: '54',
      probe_ambient: '161',
      probe_needle: '450,435,470,490',
      probe_core_index: '1',
      probe_eta: '2026-11-08T18:05:00+01:00',
      next_kind: 'pull',
      ...attributes,
    },
  });
  fixture.live = parseCookLive({
    state: '4',
    attributes: {
      t0: '2026-11-08T17:58:00+01:00',
      step: '30',
      bath: '575,580,580,580',
      core: '420,425,430,435',
      ambient: '1600,1600,1600,1610',
      pull_mark: attributes.probe_phase === 'resting' ? '2' : undefined,
    },
  });
  act(() => root.render(createElement(CookStage, { onClose: () => {} })));
}
beforeEach(() => {
  fixture.anova = undefined;
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('the cooking stage', () => {
  it.each(PROBE_PHASES.filter(phase => phase !== 'off'))('never offers bath start or target while probe is %s', phase => {
    fixture.anova = 'off';
    show({ bath_phase: 'off', probe_phase: phase });
    expect(document.querySelector('.cook-bath-start')).toBeNull();
    expect(document.querySelector('[aria-label="Bath target"]')).toBeNull();
  });
  it.each(['unavailable', 'unknown', undefined])('does not offer idle bath start when Anova is %s', anova => {
    fixture.anova = anova;
    show({ bath_phase: 'off', probe_phase: 'off' });
    expect(document.querySelector('.cook-bath-start')).toBeNull();
  });
  it('offers idle bath start only with a directly reachable Anova', () => {
    fixture.anova = 'off';
    show({ bath_phase: 'off', probe_phase: 'off', bath_last_target: '59.5' });
    expect(document.querySelector('.cook-bath-start')).not.toBeNull();
    expect(document.querySelector('.cook-stepper output')?.textContent).toBe('59.5°');
  });
  it('expands the selected preset chip into the complete grid on tap', () => {
    show();
    const toggle = document.querySelector('.cook-preset-toggle') as HTMLElement;
    expect(toggle.textContent).toBe('54°');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.cook-presets')).toBeNull();
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('.cook-presets button')).toHaveLength(7);
    act(() => toggle.click());
    expect(document.querySelector('.cook-presets')).toBeNull();
  });
  it('leads with a clock time, draws both lanes, and uses one needle', () => {
    show();
    expect(document.querySelector('.cook-cue')?.textContent).toBe('≈ 18:05');
    expect(document.querySelector('.cook-stage-header time')?.textContent).toBe('18:00');
    expect(document.querySelector('.cook-chart-line.is-core')?.getAttribute('d')).toContain('L');
    expect(document.querySelector('.cook-chart-line.is-bath')?.getAttribute('d')).toContain('L');
    expect(document.querySelectorAll('.cook-needle path')).toHaveLength(1);
    expect(document.querySelector('.cook-needle-value')?.textContent).toBe('161°');
    expect(document.querySelector('.cook-chart-forecast')).not.toBeNull();
    expect(document.querySelector('.cook-chart-target.is-pull')).not.toBeNull();
    expect(document.querySelector('.cook-chart-target.is-serve')).not.toBeNull();
  });
  it('does not invent a forecast once pulled and shows the real rest interval', () => {
    show({
      probe_phase: 'resting',
      probe_pulled_at: '2026-11-08T17:59:00+01:00',
      probe_pulled_core: '50.2',
      probe_peak: '51',
      probe_carve_at: '2026-11-08T18:14:00+01:00',
      next_kind: 'carve',
    });
    expect(document.querySelector('.cook-cue')?.textContent).toBe('≈ 18:14');
    expect(document.querySelector('.cook-chart-forecast')).toBeNull();
    expect(document.querySelector('.cook-chart-rest')).not.toBeNull();
    expect(document.querySelector('.cook-needle')?.getAttribute('aria-label')).toContain('held since pull');
  });
  it('hides a stale prediction and marks the last observed line', () => {
    show({ probe_stale_since: '2026-11-08T17:59:30+01:00' });
    expect(document.querySelector('.cook-chart-forecast')).toBeNull();
    expect(document.querySelector('.cook-chart-line.is-core.is-stale')).not.toBeNull();
    expect(document.querySelector('.cook-cue')?.textContent).toBe('—');
  });
  it('does not forecast to an expired ETA between the last sample and now', () => {
    show({ probe_eta: '2026-11-08T17:59:45+01:00' });
    expect(document.querySelector('.cook-chart-forecast')).toBeNull();
  });
  it('requires a live series anchor before forecasting', () => {
    show();
    fixture.live = { ...fixture.live!, t0Ms: null };
    act(() => root.render(createElement(CookStage, { onClose: () => {} })));
    expect(document.querySelector('.cook-chart-forecast')).toBeNull();
    expect(document.querySelector('.cook-chart')?.textContent).not.toMatch(/\d{2}:\d{2}/);
  });
  it('keeps a custom pull target within the chart bounds', () => {
    show({ probe_serve: '10', probe_pull: '7' });
    const svg = document.querySelector('.cook-chart > svg')!;
    const bounds = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const target = document.querySelector('.cook-chart-target.is-pull')!;
    const y = Number(target.getAttribute('y1'));
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(bounds[3]);
  });
  it('shows an unavailable state and retains a working Kitchen back button', () => {
    fixture.state = null;
    fixture.live = null;
    const close = vi.fn();
    act(() => root.render(createElement(CookStage, { onClose: close })));
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Cooking state unavailable');
    act(() => (document.querySelector('.cook-back') as HTMLElement).click());
    expect(close).toHaveBeenCalledOnce();
  });
  it('never labels an interrupted cook as done in the rail', () => {
    show({ bath_phase: 'interrupted', bath_stopped_at: '2026-11-08T17:45:00+01:00', probe_phase: 'off', next_kind: '' });
    expect(document.querySelector('.cook-moments')?.textContent).toContain('Stopped17:45');
    expect(document.querySelector('.cook-moments')?.textContent).not.toContain('Now');
  });
});
