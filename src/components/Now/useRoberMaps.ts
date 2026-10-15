import { useEffect, useMemo, useState } from 'react';
import type { HouseEpisode } from '../../home/houseEvents';
import { fetchMapsIndex, type MapEntry } from '../Vacuum/maps';
import { SESSION_MAP_LAG_MS } from '../Vacuum/sessionRooms';

/** The Rober2 maps index, read while the timeline shows rows: as they arrive, and again once the newest Rober2 row's
 * last map has had time to land. */
export function useRoberMaps(episodes: readonly HouseEpisode[]): MapEntry[] {
  const settledMs = useMemo(() => {
    if (episodes.length === 0) return null;
    const times = episodes.flatMap(episode => episode.rows.filter(row => row.icon === 'mdi:robot-vacuum').map(row => row.tsMs));
    return times.length > 0 ? Math.max(...times) + SESSION_MAP_LAG_MS : 0;
  }, [episodes]);
  const [entries, setEntries] = useState<MapEntry[]>([]);
  useEffect(() => {
    if (settledMs == null) return;
    let live = true;
    const timer = setTimeout(
      () => {
        fetchMapsIndex()
          .then(maps => {
            if (live) setEntries(maps);
          })
          .catch(() => {});
      },
      Math.max(0, settledMs - Date.now())
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [settledMs]);
  return entries;
}
