import { describe, expect, it } from 'vitest';
import { readWakeSession, snoozeCountdown, wakeActionCall, wakeActionConfirmed, wakeClock } from '../wakeSession';

const session = (state: string, attributes: Record<string, unknown> = {}) =>
  readWakeSession({ entity_id: 'sensor.wake_alarm_session', state, attributes });

describe('wake session contract', () => {
  it('uses the first-use choice when preferences are absent or malformed', () => {
    expect(session('ringing', { snooze_minutes: 99, snooze_curtain: 'ajar' }).choice).toEqual({ minutes: 10, curtain: 'closed' });
    expect(readWakeSession(undefined).state).toBe('unavailable');
  });

  it('keeps the remembered choice and parses the timezone-bearing return instant', () => {
    const value = session('snoozing', { snooze_minutes: 15, snooze_curtain: 'open', snooze_until: '2026-11-01T06:40:00+01:00' });
    expect(value.choice).toEqual({ minutes: 15, curtain: 'open' });
    expect(value.until).toBe(Date.parse('2026-11-01T05:40:00Z'));
    expect(wakeClock(value.until!)).toBe('06:40');
  });

  it('rounds countdown up and waits at zero instead of starting anything locally', () => {
    expect(snoozeCountdown(60001, 0)).toBe('01:01');
    expect(snoozeCountdown(10, 20)).toBe('00:00');
    expect(snoozeCountdown(null, 0)).toBe('—:—');
  });

  it('calls the script bridge with exact fields and keeps wake-now on its button', () => {
    expect(wakeActionCall('snooze', { minutes: 5, curtain: 'open' })).toEqual({
      domain: 'script',
      service: 'wake_snooze',
      serviceData: { minutes: 5, curtain: 'open' },
    });
    expect(wakeActionCall('dismiss', { minutes: 10, curtain: 'closed' })).toEqual({ domain: 'script', service: 'wake_dismiss' });
    expect(wakeActionCall('cancel', { minutes: 10, curtain: 'closed' }).service).toBe('wake_snooze_cancel');
    expect(wakeActionCall('wake', { minutes: 10, curtain: 'closed' })).toEqual({
      domain: 'input_button',
      service: 'press',
      target: { entity_id: 'input_button.wake_up_now' },
    });
  });

  it('binds each script action to the current session while accepting missing ids', () => {
    const choice = { minutes: 5, curtain: 'open' } as const;
    expect(wakeActionCall('snooze', choice, 'morning').serviceData).toEqual({ minutes: 5, curtain: 'open', session_id: 'morning' });
    expect(wakeActionCall('dismiss', choice, 'morning').serviceData).toEqual({ session_id: 'morning' });
    expect(wakeActionCall('cancel', choice, 'morning').serviceData).toEqual({ session_id: 'morning' });
    expect(wakeActionCall('dismiss', choice).serviceData).toBeUndefined();
    expect(wakeActionCall('cancel', choice, '').serviceData).toBeUndefined();
    expect(wakeActionCall('wake', choice, 'morning')).toEqual(wakeActionCall('wake', choice));
  });

  it('requires AppDaemon state evidence before showing action success', () => {
    const ringing = session('ringing', { session_id: 'one' });
    const snoozing = session('snoozing', { session_id: 'one', snooze_until: '2026-11-01T05:40:00Z' });
    expect(wakeActionConfirmed('snooze', ringing, ringing)).toBe(false);
    expect(wakeActionConfirmed('snooze', ringing, snoozing)).toBe(true);
    expect(wakeActionConfirmed('snooze', ringing, { ...snoozing, id: 'different' })).toBe(false);
    expect(wakeActionConfirmed('dismiss', ringing, ringing)).toBe(false);
    expect(wakeActionConfirmed('dismiss', ringing, session('dismissed', { session_id: 'one' }))).toBe(true);
    expect(wakeActionConfirmed('wake', snoozing, ringing)).toBe(true);
    expect(wakeActionConfirmed('wake', snoozing, session('dismissed', { session_id: 'next', reason: 'radio_kept' }))).toBe(true);
    expect(wakeActionConfirmed('wake', snoozing, { ...snoozing, state: 'dismissed' })).toBe(false);
    expect(wakeActionConfirmed('dismiss', ringing, session('dismissed', { session_id: 'different' }))).toBe(false);
  });
});
