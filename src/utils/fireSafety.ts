import { FIRE_SAFETY_SENSOR } from '../config/entities';
import type { HassEntities, HassEntity } from '../types';
import { normalizeAirBand, type AirBand } from './airQuality';

export type FirePhase = 'clear' | 'pre_alarm' | 'alarm' | 'hushed' | 'cooldown' | 'offline';

export type FireFault = 'offline' | 'battery_low' | 'test_overdue' | null;

export interface FireSafetyModel {
  /** False when the sensor is missing or unknown — everything else then reads as clear. */
  present: boolean;
  phase: FirePhase;
  headline: string;
  detail: string;
  since: Date | null;
  hushedUntil: Date | null;
  hushedBy: string | null;
  hushCount: number;
  ackBy: string | null;
  batteryPct: number | null;
  batteryLow: boolean;
  lastTest: Date | null;
  testOverdue: boolean;
  deviceAvailable: boolean;
  cookingUntil: Date | null;
  iaq: number | null;
  iaqBand: AirBand;
  eco2: number | null;
  eco2Band: AirBand;
  dryRun: boolean;
  /** The single most important health problem, or null. */
  fault: FireFault;
}

/** Event dispatched by HomePulse chips and listened to by FireAlarmTakeover to open the fire sheet. */
export const FIRE_SAFETY_OPEN_EVENT = 'openFireSafety';

const PHASES: FirePhase[] = ['clear', 'pre_alarm', 'alarm', 'hushed', 'cooldown', 'offline'];

export function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const key = String(value ?? '')
    .trim()
    .toLowerCase();
  return key === 'true' || key === 'on' || key === 'yes' || key === '1';
}

function toDate(value: unknown): Date | null {
  if (value == null || value === '' || value === 'None') return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 && text !== 'None' ? text : null;
}

export const CLEAR_FIRE_SAFETY: FireSafetyModel = {
  present: false,
  phase: 'clear',
  headline: 'All clear',
  detail: '',
  since: null,
  hushedUntil: null,
  hushedBy: null,
  hushCount: 0,
  ackBy: null,
  batteryPct: null,
  batteryLow: false,
  lastTest: null,
  testOverdue: false,
  deviceAvailable: true,
  cookingUntil: null,
  iaq: null,
  iaqBand: 'unknown',
  eco2: null,
  eco2Band: 'unknown',
  dryRun: false,
  fault: null,
};

export function deriveFireSafety(entities: HassEntities | undefined, entity?: HassEntity): FireSafetyModel {
  const sensor = entity ?? entities?.[FIRE_SAFETY_SENSOR];
  const rawPhase = String(sensor?.state ?? '')
    .trim()
    .toLowerCase();
  if (!sensor || !PHASES.includes(rawPhase as FirePhase)) return CLEAR_FIRE_SAFETY;

  const a = sensor.attributes ?? {};
  const phase = rawPhase as FirePhase;
  const deviceAvailable = a.device_available == null ? phase !== 'offline' : toBool(a.device_available);
  const batteryLow = toBool(a.battery_low);
  const testOverdue = toBool(a.test_overdue);
  const fault: FireFault =
    phase === 'offline' || !deviceAvailable ? 'offline' : batteryLow ? 'battery_low' : testOverdue ? 'test_overdue' : null;

  return {
    present: true,
    phase,
    headline: toText(a.headline) ?? CLEAR_FIRE_SAFETY.headline,
    detail: toText(a.detail) ?? '',
    since: toDate(a.since),
    hushedUntil: toDate(a.hushed_until),
    hushedBy: toText(a.hushed_by),
    hushCount: toNumber(a.hush_count) ?? 0,
    ackBy: toText(a.ack_by),
    batteryPct: toNumber(a.battery),
    batteryLow,
    lastTest: toDate(a.last_test),
    testOverdue,
    deviceAvailable,
    cookingUntil: toDate(a.cooking_until),
    iaq: toNumber(a.iaq),
    iaqBand: normalizeAirBand(a.iaq_band),
    eco2: toNumber(a.eco2),
    eco2Band: normalizeAirBand(a.eco2_band),
    dryRun: toBool(a.dry_run),
    fault,
  };
}

export function isCooking(model: FireSafetyModel, now: Date = new Date()): boolean {
  return model.cookingUntil != null && model.cookingUntil.getTime() > now.getTime();
}

/** "8:42" — minutes:seconds until `until`, never negative. */
export function formatCountdown(until: Date | null, now: Date = new Date()): string {
  if (!until) return '0:00';
  const total = Math.max(0, Math.round((until.getTime() - now.getTime()) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function faultLabel(fault: FireFault): string | null {
  switch (fault) {
    case 'offline':
      return 'Smoke alarm not responding';
    case 'battery_low':
      return 'Smoke alarm battery low';
    case 'test_overdue':
      return 'Smoke alarm test overdue';
    default:
      return null;
  }
}
