// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HassEntities } from '../../../types';
import { WAKE_ALARM_OPEN_EVENT, WAKE_SESSION_ENTITY } from '../wakeSession';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@iconify/react', async () => {
  const { createElement: h } = await import('react');
  return { Icon: ({ icon }: { icon: string }) => h('i', { 'data-icon': icon }) };
});

const { WakeAlarmSession } = await import('../WakeAlarmSession');
const { WakeAlarmStatus } = await import('../WakeAlarmStatus');
let root: Root;
const callService = vi.fn();
const world = (state: string, attributes: Record<string, unknown> = {}): HassEntities => ({
  [WAKE_SESSION_ENTITY]: {
    entity_id: WAKE_SESSION_ENTITY,
    state,
    attributes: { session_id: 'morning', radio_playing: true, ...attributes },
  },
  'input_button.wake_up_now': { entity_id: 'input_button.wake_up_now', state: 'old', attributes: {} },
});
const click = (text: string) => {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent?.includes(text));
  expect(button, text).toBeTruthy();
  act(() => button!.click());
};
const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
const show = (entities: HassEntities) => act(() => root.render(createElement(WakeAlarmSession, { entities, callService })));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T05:30:00Z'));
  callService.mockReset();
  window.history.replaceState(null, '', '/dashboard-rooftop/home');
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  document.body.className = '';
  vi.useRealTimers();
});

describe('wake alarm sheet', () => {
  it('opens on a live session and snoozes the remembered choice in one tap', async () => {
    show(world('ringing', { snooze_minutes: 15, snooze_curtain: 'open' }));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    click('Snooze 15 min');
    expect(callService).toHaveBeenCalledWith({ domain: 'script', service: 'wake_snooze', serviceData: { minutes: 15, curtain: 'open', session_id: 'morning' } });
    expect(document.body.textContent).toContain('Sending');
    expect(document.body.textContent).not.toContain('A little more sleep.');
    show(world('snoozing', { snooze_minutes: 15, snooze_curtain: 'open', snooze_until: '2026-11-01T05:45:00Z' }));
    expect(document.body.textContent).toContain('15:00');
    expect(document.body.textContent).toContain('Only the radio returns');
  });

  it('discards uncommitted option changes and saves only by sending a snooze', async () => {
    show(world('ringing'));
    await settle();
    click('Change snooze');
    click('Keep room');
    click('15 min');
    expect(callService).not.toHaveBeenCalled();
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Back to alarm"]')!.click());
    click('Snooze 10 min');
    expect(callService).toHaveBeenCalledWith({ domain: 'script', service: 'wake_snooze', serviceData: { minutes: 10, curtain: 'closed', session_id: 'morning' } });
  });

  it('keeps radio-stop separate and waits for the dismissed state', async () => {
    show(world('ringing'));
    await settle();
    click('Stop radio');
    expect(callService).toHaveBeenCalledWith({ domain: 'script', service: 'wake_dismiss', serviceData: { session_id: 'morning' } });
    expect(document.body.textContent).toContain('Good morning');
    show(world('dismissed'));
    expect(document.body.textContent).toContain('Radio stopped.');
    expect(document.body.textContent).toContain('Curtain and light stay as they are.');
    expect([...document.querySelectorAll('button')].some(item => item.textContent?.includes('Snooze'))).toBe(false);
  });

  it('cancels snooze and starts a full wake through the existing button', async () => {
    const sleeping = world('snoozing', { snooze_until: '2026-11-01T05:40:00Z', snooze_curtain: 'open' });
    show(sleeping);
    await settle();
    click('Wake now');
    expect(callService).toHaveBeenLastCalledWith({
      domain: 'input_button',
      service: 'press',
      target: { entity_id: 'input_button.wake_up_now' },
    });
    show(world('ringing', { session_id: 'next' }));
    show(sleeping);
    click('Cancel snooze');
    expect(callService).toHaveBeenLastCalledWith({ domain: 'script', service: 'wake_snooze_cancel', serviceData: { session_id: 'morning' } });
    show(world('dismissed'));
    expect(document.body.textContent).toContain('Snooze cancelled.');
  });

  it('uses the server cancellation reason after opening from a phone action', async () => {
    window.history.replaceState(null, '', '/dashboard-rooftop/home#wake-alarm');
    show(world('dismissed', { reason: 'snooze_cancelled' }));
    await settle();
    expect(document.body.textContent).toContain('Snooze cancelled.');
  });

  it('opens the options deep link, including after the sensor arrives', async () => {
    window.history.replaceState(null, '', '/dashboard-rooftop/home#wake-alarm=options');
    show({});
    await settle();
    expect(document.body.textContent).toContain('Alarm status unavailable.');
    show(world('ringing', { snooze_minutes: 5, snooze_curtain: 'open' }));
    await settle();
    expect(document.body.textContent).toContain('Snooze your way.');
    expect(document.querySelector('[aria-pressed="true"]')?.textContent).toContain('Keep room');
    click('Snooze 5 min');
    expect(callService).toHaveBeenCalledWith({ domain: 'script', service: 'wake_snooze', serviceData: { minutes: 5, curtain: 'open', session_id: 'morning' } });
  });

  it('closing the sheet sends no command and foreground reopens the active session', async () => {
    show(world('ringing'));
    await settle();
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Close alarm sheet"]')!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(callService).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new Event('focus')));
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('offers snooze when audio already stopped but the session is still open', async () => {
    show(world('ringing', { radio_playing: false }));
    await settle();
    expect(document.body.textContent).toContain('The radio has stopped.');
    expect(document.body.textContent).not.toContain('DR P3 is playing');
    click('Snooze 10 min');
    expect(callService).toHaveBeenCalledOnce();
  });

  it('shows a recoverable error when the server never acknowledges', async () => {
    show(world('ringing'));
    await settle();
    click('Snooze 10 min');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Try again');
    click('Snooze 10 min');
    expect(callService).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['ringing', 'Stop radio'],
    ['snoozing', 'Cancel snooze'],
  ])('retains focus when %s controls disappear after acknowledgment', async (state, label) => {
    show(world(state, { snooze_until: '2026-11-01T05:40:00Z' }));
    await settle();
    const target = [...document.querySelectorAll('button')].find(button => button.textContent?.includes(label))!;
    act(() => {
      target.focus();
      target.click();
    });
    show(world('dismissed'));
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(target.isConnected).toBe(false);
    expect(panel.contains(document.activeElement)).toBe(true);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(panel.contains(document.activeElement)).toBe(true);

    const behind = document.body.appendChild(document.createElement('button'));
    act(() => behind.focus());
    expect(panel.contains(document.activeElement)).toBe(false);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => window.dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(true);
    expect(panel.contains(document.activeElement)).toBe(true);
    act(() => behind.focus());
    const backwards = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    act(() => window.dispatchEvent(backwards));
    expect(backwards.defaultPrevented).toBe(true);
    expect(document.activeElement?.textContent).toBe('Done');
  });

  it('keeps focus in the sheet and escape closes without dismissing', async () => {
    show(world('ringing'));
    await settle();
    expect(document.activeElement?.getAttribute('role')).toBe('dialog');
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close alarm sheet');
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(callService).not.toHaveBeenCalled();
  });
});

describe('compact wake state', () => {
  it('shows a countdown and opens the global sheet from the card', () => {
    const opened = vi.fn();
    window.addEventListener(WAKE_ALARM_OPEN_EVENT, opened);
    act(() => root.render(createElement(WakeAlarmStatus, { entities: world('snoozing', { snooze_until: '2026-11-01T05:40:00Z' }) })));
    expect(document.body.textContent).toContain('Snoozing · 10:00');
    click('Open alarm');
    expect(opened).toHaveBeenCalledOnce();
    window.removeEventListener(WAKE_ALARM_OPEN_EVENT, opened);
  });
});
