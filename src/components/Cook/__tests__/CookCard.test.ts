// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BATH_PHASES, PROBE_PHASES, parseCookState, type CookState } from '../../../cook/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = vi.hoisted(() => ({ state: null as CookState | null, viewer: 'Mikkel', anova: undefined as string | undefined }));
const send = vi.hoisted(() => vi.fn(() => Promise.resolve(null)));
const NOW = Date.parse('2026-11-08T18:00:00+01:00');
vi.mock('../../../cook/useCook', () => ({ useCookState: () => fixture.state, useCookLive: () => null }));
vi.mock('@hakit/core', () => ({
  useHass: (selector: (store: { entities: Record<string, { state: string }> }) => unknown) =>
    selector({ entities: fixture.anova == null ? {} : { 'climate.anova_cooker': { state: fixture.anova } } }),
}));
vi.mock('../../../cook/command', () => ({ sendCookCommand: send }));
vi.mock('../../../hooks/useViewer', () => ({ useViewer: () => ({ name: fixture.viewer }) }));
vi.mock('../../../hooks/useNowMs', () => ({ useNowMs: () => Date.parse('2026-11-08T18:00:00+01:00') }));
vi.mock('@iconify/react', () => ({ Icon: () => null }));
const { CookCard } = await import('../CookCard');

function state(bath = 'off', probe = 'off', attributes: Record<string, string> = {}) {
  return parseCookState({
    state: bath === 'off' ? (probe === 'off' ? 'off' : 'probe') : probe === 'off' ? 'bath' : 'both',
    attributes: {
      v: '1',
      bath_phase: bath,
      probe_phase: probe,
      probe_preset: 'beef',
      probe_serve: '54',
      probe_pull: '50',
      probe_core: '43.5',
      probe_ambient: '160',
      probe_needle: '470,435,451,480',
      probe_core_index: '1',
      ...attributes,
    },
  })!;
}
let root: Root;
const button = (label: string) =>
  [...document.querySelectorAll('button')].find(node => node.textContent === label) as HTMLButtonElement | undefined;
const show = (value: CookState | null, onOpenStage = vi.fn()) => {
  fixture.state = value;
  act(() => root.render(createElement(CookCard, { onOpenStage })));
  return onOpenStage;
};
const tap = async (node: Element | undefined | null) => {
  expect(node).toBeTruthy();
  await act(async () => (node as HTMLElement).click());
};

beforeEach(() => {
  fixture.viewer = 'Mikkel';
  fixture.anova = undefined;
  send.mockClear();
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('the Kitchen cooking card', () => {
  it('is absent when both lanes are off without a reachable Anova or the app is unavailable', () => {
    show(state());
    expect(document.querySelector('.cook-card')).toBeNull();
    show(null);
    expect(document.querySelector('.cook-card')).toBeNull();
  });
  it.each(['unavailable', 'unknown', undefined])('hides the idle card when Anova is %s, despite cached bath values', anova => {
    fixture.anova = anova;
    show(state('off', 'off', { bath_temp: '58', bath_last_target: '58' }));
    expect(document.querySelector('.cook-card')).toBeNull();
  });
  it.each(['off', 'heat'])('offers one collapsed Sous vide row when idle and Anova is %s', async anova => {
    fixture.anova = anova;
    fixture.viewer = 'Rooftop';
    const open = show(state('off', 'off', { bath_last_target: '62.5' }));
    expect(document.querySelectorAll('.cook-card')).toHaveLength(1);
    expect(document.querySelector('.appliance-title')?.textContent).toBe('Sous vide');
    expect(document.querySelector('.cook-card-body')).toBeNull();
    await tap(document.querySelector('.appliance-header'));
    expect(open).not.toHaveBeenCalled();
    expect(document.querySelector('.cook-stepper output')?.textContent).toBe('62.5°');
    expect(button('Hold to start bath')).toBeTruthy();
    expect(document.querySelector('.cook-hero')).toBeNull();
    expect(document.querySelector('.cook-chart')).toBeNull();
  });
  it.each(PROBE_PHASES.filter(phase => phase !== 'off'))('never offers bath start or target while probe is %s', phase => {
    fixture.anova = 'off';
    show(state('off', phase));
    expect(button('Hold to start bath')).toBeUndefined();
    expect(document.querySelector('[aria-label="Bath target"]')).toBeNull();
  });
  it('removes idle controls if Anova becomes unavailable while expanded', async () => {
    fixture.anova = 'off';
    show(state());
    await tap(document.querySelector('.appliance-header'));
    expect(button('Hold to start bath')).toBeTruthy();
    fixture.anova = 'unavailable';
    show(state());
    expect(document.querySelector('.cook-card')).toBeNull();
  });
  it.each(BATH_PHASES.filter(phase => phase !== 'off'))('opens the bath lane in %s', phase => {
    show(state(phase));
    expect(document.querySelector('.cook-card-body')).not.toBeNull();
    expect(document.querySelector('.cook-bath-lane')).not.toBeNull();
  });
  it.each(PROBE_PHASES.filter(phase => phase !== 'off'))('opens the one probe lane in %s', phase => {
    show(state('off', phase));
    expect(document.querySelectorAll('.cook-needle')).toHaveLength(1);
    expect(document.querySelectorAll('.cook-needle path')).toHaveLength(1);
  });
  it('shows an approximate pull time, and preserves it when near', () => {
    for (const phase of ['tracking', 'near']) {
      show(state('off', phase, { probe_eta: '2026-11-08T18:05:00+01:00' }));
      expect(document.querySelector('.cook-cue')?.textContent).toBe('≈ 18:05');
      expect(document.querySelector('.appliance-word')?.textContent).toBe('Pull ≈ 18:05');
    }
    expect(document.querySelector('.cook-hero.is-act')).not.toBeNull();
  });
  it.each(['interrupted', 'too_hot'])('keeps the published probe moment ahead of the %s bath', phase => {
    show(state(phase, 'pull', { next_kind: 'pull', probe_eta: new Date(NOW).toISOString() }));
    expect(document.querySelector('.cook-hero .cook-label')?.textContent).toBe('Pull');
    expect(document.querySelector('.cook-cue')?.textContent).toBe('Now');
  });
  it('renders a published lost alarm even before a timestamp is available', () => {
    show(state('off', 'tracking', { next_kind: 'lost' }));
    expect(document.querySelector('.cook-card.is-alarm')).not.toBeNull();
    expect(document.querySelector('.cook-hero .cook-label')?.textContent).toBe('Probe lost');
  });
  it('shows a dash without a stable ETA and does not infer one from temperatures', () => {
    show(state('off', 'tracking'));
    expect(document.querySelector('.cook-cue')?.textContent).toBe('—');
  });
  it('keeps a short stalled reading separate from a lost probe alarm', () => {
    show(
      state('off', 'tracking', { probe_stale_since: new Date(NOW - 60_000).toISOString(), probe_eta: new Date(NOW + 60_000).toISOString() })
    );
    expect(document.querySelector('.cook-cue')?.textContent).toBe('—');
    expect(document.querySelector('.cook-card.is-alarm')).toBeNull();
    show(state('off', 'tracking', { probe_stale_since: new Date(NOW - 91_000).toISOString() }));
    expect(document.querySelector('.cook-card.is-alarm')).not.toBeNull();
    expect(document.querySelector('.cook-hero')?.textContent).toContain('No reading since');
  });
  it('calls an interrupted bath stopped and displays its stop time', () => {
    show(state('interrupted', 'off', { bath_stopped_at: '2026-11-08T17:45:00+01:00' }));
    expect(document.querySelector('.cook-hero')?.textContent).toContain('Stopped17:45');
    expect(document.querySelector('.cook-hero')?.textContent).not.toContain('Done');
  });
  it('shows the low water alarm over another active lane and silences by tap', async () => {
    show(state('cooking', 'pull', { bath_low_water: '1' }));
    expect(document.querySelector('.cook-hero')?.textContent).toContain('Low water');
    await tap(button('Silence'));
    expect(send).toHaveBeenCalledWith('silence', {});
  });
  it('requires a Pulled tap and never advances automatically from temperatures', async () => {
    show(state('off', 'pull', { probe_core: '51.2' }));
    expect(send).not.toHaveBeenCalled();
    await tap(button('Pulled'));
    expect(send).toHaveBeenCalledWith('probe_pulled', {});
  });
  it('preselects the last bag duration and sends the selected number of minutes', async () => {
    show(state('ready', 'off', { bath_last_minutes: '180' }));
    expect(button('3:00')?.getAttribute('aria-pressed')).toBe('true');
    await tap(button('1:00'));
    await tap(button('Bag in · 1:00'));
    expect(send).toHaveBeenCalledWith('bag_in', { minutes: 60 });
  });
  it('extends and chills a completed bath without stopping its heater', async () => {
    show(state('done'));
    await tap(button('+30 min'));
    expect(send).toHaveBeenLastCalledWith('bath_extend', { minutes: 30 });
    await tap(button('Ice water'));
    expect(send).toHaveBeenLastCalledWith('chill', {});
  });
  it('marks a carved roast done only on tap', async () => {
    show(state('off', 'carve'));
    await tap(button('Carved'));
    expect(send).toHaveBeenCalledWith('probe_done', {});
  });
  it('starts the bath only after a full one-second hold, using the last target', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fixture.anova = 'off';
    show(state('off', 'off', { bath_last_target: '62.5' }));
    await tap(document.querySelector('.appliance-header'));
    const start = button('Hold to start bath')!;
    await tap(start);
    expect(send).not.toHaveBeenCalled();
    act(() => start.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    act(() => vi.advanceTimersByTime(999));
    expect(send).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(send).toHaveBeenCalledWith('bath_start', { target: 62.5 });
  });
  it('holds stop for a second and does not turn a short press into a stop', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    show(state('cooking'));
    const stop = button('Hold to stop bath')!;
    act(() => stop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    act(() => vi.advanceTimersByTime(500));
    act(() => stop.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })));
    act(() => vi.advanceTimersByTime(500));
    expect(send).not.toHaveBeenCalled();
    act(() => stop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(send).toHaveBeenCalledWith('bath_stop', {});
  });
  it('offers the agreed preset table and custom temperatures', async () => {
    show(state('off', 'tracking'));
    expect(document.querySelector('.cook-presets')).toBeNull();
    expect(document.querySelector('.cook-preset-toggle')?.textContent).toBe('54°');
    expect(document.querySelector('.cook-preset-toggle')?.getAttribute('aria-expanded')).toBe('false');
    await tap(document.querySelector('.cook-preset-toggle'));
    expect(document.querySelector('.cook-presets')?.querySelectorAll('button')).toHaveLength(7);
    const pork = document.querySelector('button[aria-label="pork, serve 63 degrees, pull at 60"]') as HTMLElement;
    await tap(pork);
    expect(send).toHaveBeenLastCalledWith('probe_preset', { key: 'pork' });
    expect(document.querySelector('.cook-presets')).toBeNull();
    await tap(document.querySelector('.cook-preset-toggle'));
    await tap(document.querySelector('button[aria-label="Custom serve temperature"]'));
    await tap(button('Use 54°'));
    expect(send).toHaveBeenLastCalledWith('probe_preset', { key: 'custom', serve: 54 });
    expect(document.querySelector('.cook-presets')).toBeNull();
  });
  it('shows the selected custom serve temperature in the collapsed preset chip', () => {
    show(state('off', 'tracking', { probe_preset: 'custom', probe_serve: '61.5' }));
    expect(document.querySelector('.cook-preset-toggle')?.textContent).toBe('61.5°');
    expect(document.querySelector('.cook-preset-toggle')?.getAttribute('aria-label')).toContain('custom 61.5 degrees');
  });
  it('reopens for a new episode after the previous card was collapsed', async () => {
    show(state('cooking'));
    await tap(document.querySelector('.appliance-header'));
    expect(document.querySelector('.cook-card-body')).toBeNull();
    show(state());
    show(state('heating'));
    expect(document.querySelector('.cook-card-body')).not.toBeNull();
  });
  it('opens the stage on the tablet and the body on a phone', async () => {
    fixture.viewer = 'Rooftop';
    const open = show(state('cooking'));
    expect(document.querySelector('.cook-card-body')).toBeNull();
    await tap(document.querySelector('.appliance-header'));
    expect(open).toHaveBeenCalledOnce();
  });
});
