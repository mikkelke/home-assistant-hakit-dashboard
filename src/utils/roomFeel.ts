import { roomFeelSensorId } from '../config/entities';
import type { HassEntities } from '../types';

export type MouldRisk = 'low' | 'watch' | 'high';

const MOULD_RISKS: readonly MouldRisk[] = ['low', 'watch', 'high'];

export interface RoomFeelModel {
  /** False when the area has no `sensor.<area>_feel` entity in the registry at all. */
  present: boolean;
  /** True when present and its state is an actual reading (not unavailable/unknown). */
  available: boolean;
  tempC: number | null;
  rh: number | null;
  dewPointC: number | null;
  floorTempC: number | null;
  floorSpreadC: number | null;
  airingHelps: boolean;
  mouldRisk: MouldRisk | null;
  stale: boolean;
  sourceCount: number;
  headline: string;
  detail: string;
}

export const EMPTY_ROOM_FEEL: RoomFeelModel = {
  present: false,
  available: false,
  tempC: null,
  rh: null,
  dewPointC: null,
  floorTempC: null,
  floorSpreadC: null,
  airingHelps: false,
  mouldRisk: null,
  stale: false,
  sourceCount: 0,
  headline: '',
  detail: '',
};

function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const key = String(value ?? '')
    .trim()
    .toLowerCase();
  return key === 'true' || key === 'on' || key === 'yes' || key === '1';
}

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: unknown): string {
  if (value == null) return '';
  const text = String(value).trim();
  return text.length > 0 && text !== 'None' ? text : '';
}

function toMouldRisk(value: unknown): MouldRisk | null {
  const key = String(value ?? '')
    .trim()
    .toLowerCase();
  return (MOULD_RISKS as readonly string[]).includes(key) ? (key as MouldRisk) : null;
}

/**
 * Parses an area's fused `sensor.<area>_feel` (AppDaemon RoomFeel) into a typed model. Absent or
 * `unavailable`/`unknown` collapses to a single "not available" shape so callers don't have to
 * re-check state themselves — mirrors `deriveFireSafety`'s pattern for the smoke alarm. Never
 * exposes the raw `sources`/`excluded` lists, only a count — housemates don't need entity ids.
 */
export function deriveRoomFeel(entities: HassEntities | undefined, areaId: string | undefined | null): RoomFeelModel {
  const sensorId = roomFeelSensorId(areaId);
  const entity = sensorId ? entities?.[sensorId] : undefined;
  if (!entity) return EMPTY_ROOM_FEEL;

  const state = entity.state;
  const available = state != null && state !== '' && state !== 'unknown' && state !== 'unavailable';
  if (!available) return { ...EMPTY_ROOM_FEEL, present: true };

  const a = entity.attributes ?? {};
  const sources = Array.isArray(a.sources) ? a.sources : [];

  return {
    present: true,
    available: true,
    tempC: toNumber(state),
    rh: toNumber(a.rh),
    dewPointC: toNumber(a.dew_point_c),
    floorTempC: toNumber(a.floor_temp_c),
    floorSpreadC: toNumber(a.floor_spread_c),
    airingHelps: toBool(a.airing_helps),
    mouldRisk: toMouldRisk(a.mould_risk),
    stale: toBool(a.stale),
    sourceCount: sources.length,
    headline: toText(a.headline),
    detail: toText(a.detail),
  };
}
