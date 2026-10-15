import { zoneAt } from './geometry';
import type { Fingerprint, WifiBand, Zone } from './mapDoc';
import { median } from './wifi';

/** Where the colours of the coverage layer change, in dBm: at -55 or better is strong, down to -65 good, down to -72
 * fair, and weaker than that weak. */
export const DBM_STEPS = [-55, -65, -72] as const;

export type DbmBucket = 'strong' | 'good' | 'fair' | 'weak';
export const DBM_BUCKETS: readonly DbmBucket[] = ['strong', 'good', 'fair', 'weak'];

export const BUCKET_LABEL: Record<DbmBucket, string> = {
  strong: '-55 or better',
  good: '-55 to -65',
  fair: '-65 to -72',
  weak: 'weaker than -72',
};

export const BUCKET_SHORT: Record<DbmBucket, string> = { strong: '≥ -55', good: '≥ -65', fair: '≥ -72', weak: '< -72' };

export function dbmBucket(dbm: number): DbmBucket {
  if (dbm >= DBM_STEPS[0]) return 'strong';
  if (dbm >= DBM_STEPS[1]) return 'good';
  if (dbm >= DBM_STEPS[2]) return 'fair';
  return 'weak';
}

export interface CoveragePoint {
  /** The fingerprint it comes from. */
  id: string;
  x: number;
  y: number;
  dbm: number;
  bssid: string | null;
  /** The access point device key the BSSID table gives, or null when there is no BSSID or the table does not list it. */
  ap: string | null;
  band: WifiBand | null;
}

/** The captures that hold a signal reading. A survey point that was captured more than once counts once, by its newest
 * capture. */
export function coveragePoints(items: readonly Fingerprint[], aps: Readonly<Record<string, string>>): CoveragePoint[] {
  const newest = new Map<string, Fingerprint>();
  const loose: Fingerprint[] = [];
  for (const item of items) {
    if (item.wifi.dbm === null) continue;
    if (item.survey_id === null) loose.push(item);
    else {
      const known = newest.get(item.survey_id);
      if (!known || item.at >= known.at) newest.set(item.survey_id, item);
    }
  }
  return [...loose, ...newest.values()]
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .map(item => ({
      id: item.id,
      x: item.pos.x,
      y: item.pos.y,
      dbm: item.wifi.dbm as number,
      bssid: item.wifi.bssid,
      ap: item.wifi.bssid === null ? null : (aps[item.wifi.bssid] ?? null),
      band: item.wifi.band,
    }));
}

export const ALL_APS = 'all';

export interface ApChoice {
  /** `all`, `ap:<device key>` or `bssid:<BSSID>` for one the table does not list. */
  id: string;
  label: string;
  count: number;
}

/** The last three bytes of a BSSID, enough to tell the access points of one site apart. */
export const shortBssid = (bssid: string): string => bssid.split(':').slice(-3).join(':');

/** The filter choices for the points shown: all, then each access point and each unlisted BSSID that has a point. */
export function apChoices(points: readonly CoveragePoint[], nameOf: (key: string) => string | undefined): ApChoice[] {
  const counts = new Map<string, ApChoice>();
  for (const point of points) {
    if (point.ap === null && point.bssid === null) continue;
    const id = point.ap !== null ? `ap:${point.ap}` : `bssid:${point.bssid}`;
    const known = counts.get(id);
    if (known) known.count += 1;
    else
      counts.set(id, {
        id,
        label: point.ap !== null ? (nameOf(point.ap) ?? `AP ${point.ap.slice(0, 4)}`) : `Unlisted ${shortBssid(point.bssid as string)}`,
        count: 1,
      });
  }
  const listed = [...counts.values()].sort((a, b) => a.label.localeCompare(b.label));
  return [{ id: ALL_APS, label: 'All APs', count: points.length }, ...listed];
}

export function matchesAp(point: CoveragePoint, choice: string): boolean {
  if (choice === ALL_APS) return true;
  return point.ap !== null ? choice === `ap:${point.ap}` : choice === `bssid:${point.bssid}`;
}

export interface RoomCoverage {
  zone_id: string;
  /** The median of the dBm of the points inside the zone. */
  dbm: number;
  bucket: DbmBucket;
  count: number;
}

/** One entry for each zone that has a point inside it; a point on a boundary or outside every zone belongs to none. */
export function roomCoverage(points: readonly CoveragePoint[], zones: readonly Zone[]): RoomCoverage[] {
  const byZone = new Map<string, number[]>();
  for (const point of points) {
    const zone = zoneAt(zones, point.x, point.y);
    if (zone) byZone.set(zone.zone_id, [...(byZone.get(zone.zone_id) ?? []), point.dbm]);
  }
  return zones.flatMap(zone => {
    const values = byZone.get(zone.zone_id);
    const dbm = values ? median(values) : null;
    return values && dbm !== null ? [{ zone_id: zone.zone_id, dbm, bucket: dbmBucket(dbm), count: values.length }] : [];
  });
}
