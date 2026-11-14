import type { HassEntity, ServiceCallArgs } from '../../types';

export const WAKE_SESSION_ENTITY = 'sensor.wake_alarm_session';
export const WAKE_ALARM_OPEN_EVENT = 'wakeAlarmOpen';
export const WAKE_ALARM_HASH = '#wake-alarm';
export type SnoozeMinutes = 5 | 10 | 15;
export type SnoozeCurtain = 'closed' | 'open';
export type WakeAction = 'snooze' | 'dismiss' | 'keep' | 'cancel' | 'wake';
export interface SnoozeChoice {
  minutes: SnoozeMinutes;
  curtain: SnoozeCurtain;
}
export interface WakeSession {
  state: 'idle' | 'ringing' | 'snoozing' | 'dismissed' | 'stopped' | 'unavailable';
  id: string;
  reason: string;
  startedAt: number | null;
  until: number | null;
  radioPlaying: boolean;
  choice: SnoozeChoice;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

export function readWakeSession(entity: HassEntity | undefined): WakeSession {
  const attrs = entity?.attributes ?? {};
  const raw = entity?.state;
  const state = raw === 'idle' || raw === 'ringing' || raw === 'snoozing' || raw === 'dismissed' || raw === 'stopped' ? raw : 'unavailable';
  return {
    state,
    id: typeof attrs.session_id === 'string' ? attrs.session_id : '',
    reason: typeof attrs.reason === 'string' ? attrs.reason : '',
    startedAt: timestamp(attrs.started_at),
    until: timestamp(attrs.snooze_until),
    radioPlaying: attrs.radio_playing !== false,
    choice: {
      minutes: attrs.snooze_minutes === 5 || attrs.snooze_minutes === 15 ? attrs.snooze_minutes : 10,
      curtain: attrs.snooze_curtain === 'open' ? 'open' : 'closed',
    },
  };
}

export function activeWakeSession(session: WakeSession): boolean {
  return session.state === 'ringing' || session.state === 'snoozing';
}

export function wakeClock(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit' }).format(ms);
}

export function snoozeCountdown(until: number | null, now: number): string {
  if (until == null) return '—:—';
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function wakeActionCall(action: WakeAction, choice: SnoozeChoice, sessionId?: string): ServiceCallArgs {
  if (action === 'wake') return { domain: 'input_button', service: 'press', target: { entity_id: 'input_button.wake_up_now' } };
  const serviceData = {
    ...(action === 'snooze' ? { minutes: choice.minutes, curtain: choice.curtain } : {}),
    ...(action === 'keep' ? { keep_radio: true } : {}),
    ...(sessionId ? { session_id: sessionId } : {}),
  };
  return {
    domain: 'script',
    service: action === 'snooze' ? 'wake_snooze' : action === 'cancel' ? 'wake_snooze_cancel' : 'wake_dismiss',
    ...(Object.keys(serviceData).length ? { serviceData } : {}),
  };
}

export function wakeActionConfirmed(action: WakeAction, before: WakeSession, after: WakeSession): boolean {
  if (action === 'wake') {
    if (after.state === 'dismissed') return after.id !== before.id;
    return after.state === 'ringing' && (before.state !== 'ringing' || before.id !== after.id);
  }
  if (action === 'snooze')
    return after.id === before.id && after.state === 'snoozing' && (before.state !== 'snoozing' || before.until !== after.until);
  return after.id === before.id && (after.state === 'dismissed' || after.state === 'stopped' || after.state === 'idle');
}
