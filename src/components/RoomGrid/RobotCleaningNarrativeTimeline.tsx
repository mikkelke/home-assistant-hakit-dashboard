import { useState, useEffect } from 'react';
import { useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import { ROBOT_CLEANING_NARRATIVE_ENTITY, VACUUM_ENTITY } from '../../config/entities';
import '../Timeline/Timeline.css';

interface ConnectionWithAuth {
  options?: { auth?: { accessToken?: string }; accessToken?: string };
  auth?: { accessToken?: string };
}

type HistoryItem = { entity_id?: string; state?: string; last_changed?: string; last_updated?: string };

function parseHistoryResponse(data: unknown): HistoryItem[] {
  if (data && Array.isArray(data) && data.length > 0) {
    if (Array.isArray(data[0])) {
      return data[0] as HistoryItem[];
    }
    return data as HistoryItem[];
  }
  return [];
}

function vacuumIconAndColor(vacuumState: string | null): { icon: string; color: string } {
  if (!vacuumState) {
    return { icon: 'mdi:circle', color: '#a1a1aa' };
  }
  const stateLower = vacuumState.toLowerCase();
  const vacuumIconMap: Record<string, string> = {
    cleaning: 'mdi:robot-vacuum',
    returning: 'mdi:home-import-outline',
    docked: 'mdi:battery-charging',
    paused: 'mdi:pause-circle',
    idle: 'mdi:robot-vacuum-variant',
    error: 'mdi:alert-circle',
    unavailable: 'mdi:robot-vacuum-off',
    unknown: 'mdi:help-circle',
  };
  const vacuumColorMap: Record<string, string> = {
    cleaning: '#22c55e',
    returning: '#3b82f6',
    docked: '#71717a',
    paused: '#fbbf24',
    idle: '#a1a1aa',
    error: '#ef4444',
    unavailable: '#a1a1aa',
    unknown: '#a1a1aa',
  };
  return {
    icon: vacuumIconMap[stateLower] || 'mdi:robot-vacuum',
    color: vacuumColorMap[stateLower] || '#71717a',
  };
}

/** Vacuum history points sorted ascending by time; return state at last change <= tMs. */
function vacuumStateAtTime(sortedAsc: { state: string; t: number }[], tMs: number): string | null {
  let lo = 0;
  let hi = sortedAsc.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid].t <= tMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans >= 0 ? sortedAsc[ans].state : null;
}

function formatTimeAgo(timestamp: string): string {
  const then = new Date(timestamp).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}${diffMin === 1 ? ' minute' : ' minutes'} ago`;
  if (diffHr < 24) return `${diffHr}${diffHr === 1 ? ' hour' : ' hours'} ago`;
  if (diffDay < 7) return `${diffDay}${diffDay === 1 ? ' day' : ' days'} ago`;

  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) {
    return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAbsoluteTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface RobotCleaningNarrativeTimelineProps {
  hassUrl: string | null;
  /** When false, no network fetch (e.g. modal closed). */
  enabled: boolean;
  hours?: number;
  limit?: number;
  /** When true, dot/icon/color from vacuum phase at each narrative timestamp. */
  showPhaseTrack?: boolean;
}

export function RobotCleaningNarrativeTimeline({
  hassUrl,
  enabled,
  hours = 168,
  limit = 100,
  showPhaseTrack = true,
}: RobotCleaningNarrativeTimelineProps) {
  const [rows, setRows] = useState<{ narrative: string; last_changed: string; icon: string; color: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const connection = useHass((state: unknown) => (state as { connection?: ConnectionWithAuth | null }).connection ?? undefined);

  const getAccessToken = (): string | null => {
    try {
      if (!connection) return null;
      const conn = connection as ConnectionWithAuth;
      if (conn.options?.auth?.accessToken) return conn.options.auth.accessToken;
      if (conn.options?.accessToken) return conn.options.accessToken;
      if (conn.auth?.accessToken) return conn.auth.accessToken;
      return null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (!enabled || !hassUrl) {
      setLoading(false);
      setRows([]);
      if (!hassUrl && enabled) {
        setError('Home Assistant URL not configured');
      } else {
        setError(null);
      }
      return;
    }

    const fetchEntityHistory = async (targetEntityId: string): Promise<HistoryItem[]> => {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);
      const apiUrl = `/api/history/period/${startTime.toISOString()}`;
      const url = new URL(apiUrl, window.location.origin);
      url.searchParams.set('filter_entity_id', targetEntityId);
      url.searchParams.set('end_time', endTime.toISOString());
      url.searchParams.set('significant_changes_only', '0');
      url.searchParams.set('minimal_response', '0');

      const accessToken = getAccessToken();
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${response.statusText}${errorText ? `. ${errorText.substring(0, 100)}` : ''}`);
      }

      const data = await response.json();
      return parseHistoryResponse(data);
    };

    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);

        const narrativeRaw = await fetchEntityHistory(ROBOT_CLEANING_NARRATIVE_ENTITY);
        if (cancelled) return;

        const narrativeEvents = narrativeRaw
          .map(item => ({
            state: item.state || '',
            last_changed: item.last_changed || item.last_updated || new Date().toISOString(),
          }))
          .filter(e => {
            const sl = e.state.toLowerCase();
            return e.state.length > 0 && sl !== 'unknown' && sl !== 'unavailable';
          });

        narrativeEvents.sort((a, b) => new Date(b.last_changed).getTime() - new Date(a.last_changed).getTime());
        const limited = narrativeEvents.slice(0, limit);

        let vacuumSortedAsc: { state: string; t: number }[] = [];
        if (showPhaseTrack) {
          const vacuumRaw = await fetchEntityHistory(VACUUM_ENTITY);
          if (cancelled) return;
          vacuumSortedAsc = vacuumRaw
            .map(item => ({
              state: item.state || 'unknown',
              t: new Date(item.last_changed || item.last_updated || 0).getTime(),
            }))
            .filter(p => !Number.isNaN(p.t))
            .sort((a, b) => a.t - b.t);
        }

        const merged = limited.map(n => {
          const tMs = new Date(n.last_changed).getTime();
          const vState = showPhaseTrack ? vacuumStateAtTime(vacuumSortedAsc, tMs) : null;
          const { icon, color } = showPhaseTrack ? vacuumIconAndColor(vState) : { icon: 'mdi:circle', color: '#a1a1aa' };
          return {
            narrative: n.state,
            last_changed: n.last_changed,
            icon,
            color,
          };
        });

        if (!cancelled) setRows(merged);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load history');
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getAccessToken stable via connection
  }, [enabled, hassUrl, hours, limit, showPhaseTrack, connection]);

  if (!enabled) {
    return null;
  }

  if (loading) {
    return (
      <div className='timeline-loading'>
        <Icon icon='mdi:loading' className='timeline-spinner' />
        <span>Loading timeline...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className='timeline-error'>
        <Icon icon='mdi:alert-circle' />
        <span>{error}</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className='timeline-empty'>
        <Icon icon='mdi:timeline-outline' />
        <span>No events found</span>
      </div>
    );
  }

  return (
    <div className='timeline-container'>
      <div className='timeline-events'>
        {rows.map((row, index) => {
          const isLast = index === rows.length - 1;
          return (
            <div key={`${row.last_changed}-${index}`} className='timeline-event'>
              <div className='timeline-line-container'>
                <div className='timeline-dot' style={{ backgroundColor: row.color }}>
                  <Icon icon={row.icon} />
                </div>
                {!isLast && <div className='timeline-line' />}
              </div>
              <div className='timeline-content'>
                <div className='timeline-header'>
                  <span className='timeline-state'>{row.narrative}</span>
                  <span className='timeline-time'>{formatTimeAgo(row.last_changed)}</span>
                </div>
                <div className='timeline-details'>
                  <span className='timeline-absolute-time'>{formatAbsoluteTime(row.last_changed)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
