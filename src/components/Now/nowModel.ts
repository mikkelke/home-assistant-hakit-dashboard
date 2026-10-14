/** The rows of the `#now` timeline: what the house did, what runs now, and what comes next. Pure. */
import { HOME_TIME_ZONE } from '../../config/plan';
import type { ApplianceCycle } from '../../energy/applianceRun';
import { homeDayKey, homeDayStartMs, nextHomeDayStartMs } from '../../energy/homeTime';
import { houseEventKind, type HouseEpisode, type HouseEvent } from '../../home/houseEvents';
import type { HouseUpcomingKind, HouseUpcomingRow } from '../../home/houseUpcoming';
import type { MarkerRow } from '../../home/markers';
import { isQuietAt, type QuietHours } from '../../home/quietHours';
import type { UpcomingAppliance, UpcomingItem } from '../../home/upcoming';
import type { NowFocusKind } from '../../utils/navigation';

export { timelineMarkers, type MarkerRow } from '../../home/markers';

export interface PastRow {
  type: 'past';
  /** The episode id, which the resolver also returns. */
  id: string;
  episode: HouseEpisode;
  atMs: number;
  /** HA area id a tap opens; null when no single room owns the row. */
  areaId: string | null;
  /** Hidden from part of the household. */
  restricted: boolean;
}

/** A running or paused appliance. It sits on the NOW line, and its card carries the ETA, so no separate
 * done row repeats it. */
export interface RunningRow {
  type: 'running';
  id: string;
  item: UpcomingAppliance;
  /** Cycle start; null when unknown. */
  atMs: number | null;
  areaId: string;
}

export interface PlanRow {
  type: 'plan';
  id: string;
  item: Exclude<UpcomingItem, UpcomingAppliance>;
  atMs: number | null;
  areaId: string;
}

/** A `sensor.house_upcoming` card: maintenance, a train or a rain forecast. */
export interface UpRow {
  type: 'up';
  id: string;
  row: HouseUpcomingRow;
  atMs: number | null;
}

export type FutureRow = PlanRow | MarkerRow | UpRow;

export const UP_TONES: Record<HouseUpcomingKind, string> = { rain: 'sky', train: 'mint', maint: 'slate' };

export interface NowTimeline {
  /** Oldest first. */
  past: PastRow[];
  running: RunningRow[];
  /** Soonest first; untimed last. */
  future: FutureRow[];
}

const AREA_BY_KIND: Partial<Record<NowFocusKind, string>> = {
  ring: 'hallway',
  washer: 'guest_bathroom',
  dryer: 'guest_bathroom',
  dish: 'kitchen',
  wake: 'bedroom',
};

/** Icon prefixes of generic rows that still name one room: the front door and its lock, and Rober2's
 * dock in the kitchen. */
const AREA_BY_ICON_PREFIX: readonly (readonly [string, string])[] = [
  ['mdi:lock', 'hallway'],
  ['mdi:door', 'hallway'],
  ['mdi:bell', 'hallway'],
  ['mdi:robot-vacuum', 'kitchen'],
];

export function episodeAreaId(episode: HouseEpisode): string | null {
  const byKind = AREA_BY_KIND[episode.kind];
  if (byKind) return byKind;
  const areas = episode.rows.map(row => AREA_BY_ICON_PREFIX.find(([prefix]) => row.icon.startsWith(prefix))?.[1] ?? null);
  return areas.every(area => area != null && area === areas[0]) ? areas[0] : null;
}

const isRestricted = (row: HouseEvent) => row.audience === 'admin' || row.audienceUsers != null;

/** Whether the running card may say the ETA falls in quiet hours: only for a running cycle whose ETA is
 * known and still ahead. */
export function etaInQuietHours(cycle: Pick<ApplianceCycle, 'status' | 'etaMs' | 'overrun'>, quiet: QuietHours): boolean {
  return cycle.status === 'running' && cycle.etaMs != null && !cycle.overrun && isQuietAt(quiet, cycle.etaMs);
}

const byTime = (a: { atMs: number | null }, b: { atMs: number | null }) => (a.atMs ?? Infinity) - (b.atMs ?? Infinity) || 0;

export function buildNowTimeline(
  episodes: readonly HouseEpisode[],
  upcoming: readonly UpcomingItem[],
  markers: readonly MarkerRow[] = [],
  upRows: readonly HouseUpcomingRow[] = []
): NowTimeline {
  const past = [...episodes].reverse().map(
    (episode): PastRow => ({
      type: 'past',
      id: episode.id,
      episode,
      atMs: episode.startMs,
      areaId: episodeAreaId(episode),
      restricted: episode.rows.some(isRestricted),
    })
  );
  const running: RunningRow[] = [];
  const future: FutureRow[] = [];
  for (const item of upcoming) {
    if (item.type === 'appliance') {
      running.push({ type: 'running', id: item.id, item, atMs: item.cycle.startMs, areaId: item.appliance.areaId });
    } else {
      future.push({ type: 'plan', id: item.id, item, atMs: item.atMs, areaId: item.areaId });
    }
  }
  future.push(...markers, ...upRows.map((row): UpRow => ({ type: 'up', id: row.id, row, atMs: row.atMs })));
  running.sort(byTime);
  future.sort(byTime);
  return { past, running, future };
}

/** The kind a row's tone comes from. */
export function rowTone(row: Pick<HouseEvent, 'icon'>): string {
  const kind = houseEventKind(row);
  if (kind === 'ring') return 'gold';
  if (kind === 'washer' || kind === 'dryer' || kind === 'dish') return 'sky';
  if (kind === 'wake') return 'gold';
  const name = row.icon.replace(/^mdi:/, '');
  if (/^(door|lock)/.test(name)) return 'rose';
  if (/^basket/.test(name)) return 'mint';
  if (/^(television|radio|cast|speaker)/.test(name)) return 'purple';
  if (/^robot/.test(name)) return 'green';
  if (/^(hand-back|lightbulb|ceiling-light)/.test(name)) return 'light';
  if (/^(blinds|weather|white-balance)/.test(name)) return 'sun';
  if (/^(smoke|fire)/.test(name)) return 'rose';
  return 'slate';
}

const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: HOME_TIME_ZONE });
const DAY_DATE = new Intl.DateTimeFormat('da-DK', { day: '2-digit', month: '2-digit', timeZone: HOME_TIME_ZONE });

/** "Today", "Yesterday", "Tomorrow", else "Sunday 11.10", by the house's calendar days. */
export function dayLabel(atMs: number, nowMs: number): string {
  const key = homeDayKey(atMs);
  if (key === homeDayKey(nowMs)) return 'Today';
  if (key === homeDayKey(homeDayStartMs(nowMs) - 1)) return 'Yesterday';
  if (key === homeDayKey(nextHomeDayStartMs(nowMs))) return 'Tomorrow';
  return `${DAY_LABEL.format(atMs)} ${DAY_DATE.format(atMs)}`;
}

/** The day label each row in time order opens with: one wherever the calendar day changes, counting
 * from today, so rows of today need none. Untimed rows get none and do not count. */
export function dayBreaks(times: readonly (number | null)[], nowMs: number): (string | null)[] {
  let day = homeDayKey(nowMs);
  return times.map(atMs => {
    if (atMs == null || homeDayKey(atMs) === day) return null;
    day = homeDayKey(atMs);
    return dayLabel(atMs, nowMs);
  });
}
