/** What the next chip offers: the soonest timed thing the viewer sees, of any kind. Pure. */
import type { NowFocus } from '../utils/navigation';
import type { HouseEventViewer } from './houseEvents';
import { isUpcomingFor, type HouseUpcomingRow } from './houseUpcoming';
import { MARKERS, type MarkerRow } from './markers';
import { nextTimedItem, upcomingFocus, type UpcomingItem } from './upcoming';

function itemIcon(item: UpcomingItem): string {
  if (item.type === 'appliance') return item.appliance.config.icon;
  return item.type === 'wake' ? 'mdi:alarm' : 'mdi:robot-vacuum';
}

function itemName(item: UpcomingItem): string {
  if (item.type === 'appliance') return `${item.appliance.config.label} ${item.id === 'coffee' ? 'ready' : 'done'}`;
  return item.type === 'wake' ? 'Wake alarm' : 'Rober2';
}

/** What the next chip offers, and the exact timeline item its tap focuses. */
export interface NextUp {
  itemId: string;
  /** The identity a link to it carries; null for items no link names. */
  focus: NowFocus | null;
  atMs: number;
  icon: string;
  name: string;
}

/** The soonest timed thing `viewer` sees, of any kind: a running appliance or the alarm, a marker, or a
 * `sensor.house_upcoming` row addressed to them. Markers come from `timelineMarkers`, which leaves out
 * quiet hours that are on now. */
export function nextUp(
  items: readonly UpcomingItem[],
  markers: readonly MarkerRow[],
  rows: readonly HouseUpcomingRow[],
  viewer: HouseEventViewer
): NextUp | null {
  const item = nextTimedItem(items);
  const candidates: NextUp[] = [
    ...(item?.atMs != null
      ? [{ itemId: item.id, focus: upcomingFocus(item), atMs: item.atMs, icon: itemIcon(item), name: itemName(item) }]
      : []),
    ...markers.map(marker => ({
      itemId: marker.id,
      focus: null,
      atMs: marker.atMs,
      icon: MARKERS[marker.id].icon,
      name: MARKERS[marker.id].word,
    })),
    ...rows.flatMap(row =>
      row.atMs != null && isUpcomingFor(row, viewer)
        ? [{ itemId: row.id, focus: null, atMs: row.atMs, icon: row.icon, name: row.title }]
        : []
    ),
  ];
  return candidates.reduce<NextUp | null>((best, next) => (best == null || next.atMs < best.atMs ? next : best), null);
}
