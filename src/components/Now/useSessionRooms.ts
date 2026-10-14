import { useEffect, useMemo, useState } from 'react';
import type { HouseEpisode } from '../../home/houseEvents';
import { fetchMapsIndex, type MapEntry } from '../Vacuum/maps';
import { roberSessions, sessionRooms } from '../Vacuum/sessionRooms';

/** The room maps of each finished Rober2 round among `episodes`, by finish-row episode id. The map index is fetched only
 * while a finish row is shown, and again once the newest round's last map has had time to land. */
export function useSessionRooms(episodes: readonly HouseEpisode[]): Map<string, MapEntry[]> {
  const sessions = useMemo(() => roberSessions(episodes), [episodes]);
  const settledMs = sessions.length > 0 ? sessions[sessions.length - 1].toMs : null;
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
  return useMemo(() => sessionRooms(sessions, entries), [sessions, entries]);
}
