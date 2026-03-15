import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import type { HassEntities, CallServiceFunction } from '../../types';
import {
  VACUUM_ENTITY,
  VACUUM_BATTERY_SENSOR,
  VACUUM_CLEANING_PROGRESS_SENSOR,
  VACUUM_CURRENT_ROOM_INPUT,
  VACUUM_CURRENT_ROOM_SENSOR,
  VACUUM_MAP_IMAGE_ENTITY,
  ROBOT_MAPS_PATH,
} from '../../config/entities';
import { useSwipeToClose } from '../../hooks';
import './VacuumCard.css';

type BatteryHistoryPoint = { t: number; value: number };

interface VacuumCardProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

export function VacuumCard({ entities, callService }: VacuumCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Entity IDs from config/entities.ts
  const vacuum = entities?.[VACUUM_ENTITY];
  const cleaningProgressRaw = entities?.[VACUUM_CLEANING_PROGRESS_SENSOR]?.state;
  const cleaningProgress =
    cleaningProgressRaw !== undefined &&
    cleaningProgressRaw !== null &&
    cleaningProgressRaw !== 'unknown' &&
    cleaningProgressRaw !== 'unavailable'
      ? Number(cleaningProgressRaw)
      : undefined;
  const targetRoomRaw = entities?.[VACUUM_CURRENT_ROOM_INPUT]?.state; // ordered room
  const liveRoomRaw = entities?.[VACUUM_CURRENT_ROOM_SENSOR]?.state; // currently cleaning room
  const liveMapImage = entities?.[VACUUM_MAP_IMAGE_ENTITY];
  // Map numeric/string room IDs to display names (customize for your setup)
  const roomIdToName: Record<string, string> = {
    '17': 'Hallway',
    '22': 'Kitchen cook side',
    '25': 'Kitchen dining side',
    '18': 'Living room',
    '21': 'Dining room',
    '23': 'Office',
    '16': 'Kristines room',
    '20': 'Bedroom',
    '24': 'Bathroom',
    '19': 'Guest bathroom',
  };
  // Map string room names from map entries to display names
  const roomNameMap: Record<string, string> = {
    kitchen: 'Kitchen cook side',
    kitchen_1: 'Kitchen cook side',
    kitchen_2: 'Kitchen dining side',
  };

  // Stuck map entries (robot got stuck) – used for call-to-action elsewhere; hide from room maps grid
  const STUCK_MAP_ROOMS = ['stuck_in_the_office', 'stuck_trying_to_leave_the_office'];

  const formatRoomName = (room: string | undefined) => {
    if (!room) return undefined;
    // First check string name mapping (for map entries)
    const lowerRoom = room.toLowerCase();
    if (roomNameMap[lowerRoom]) return roomNameMap[lowerRoom];
    // Then check numeric ID mapping (for sensor values)
    return roomIdToName[room] || roomIdToName[lowerRoom] || room[0]?.toUpperCase() + room.slice(1).replace('_', ' ');
  };
  const targetRoomName =
    (targetRoomRaw && formatRoomName(targetRoomRaw)) ||
    (typeof targetRoomRaw === 'string' && targetRoomRaw.length > 0 ? targetRoomRaw : undefined);
  const liveRoomName =
    (liveRoomRaw && formatRoomName(liveRoomRaw)) || (typeof liveRoomRaw === 'string' && liveRoomRaw.length > 0 ? liveRoomRaw : undefined);
  const cleaningProgressSafe =
    cleaningProgress !== undefined && !Number.isNaN(cleaningProgress) ? Math.max(0, Math.min(100, cleaningProgress)) : undefined;

  type MapEntry = {
    filename: string;
    timestamp: string;
    datetime?: string;
    room?: string;
    url: string;
  };
  const [maps, setMaps] = useState<MapEntry[] | null>(null);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [mapsLoading, setMapsLoading] = useState(false);
  const mapsLoadedRef = useRef(false);
  const [selectedMap, setSelectedMap] = useState<MapEntry | null>(null);
  const [showLiveMap, setShowLiveMap] = useState(false);
  const [liveMapRefreshKey, setLiveMapRefreshKey] = useState(0);
  const lastLiveMapTsRef = useRef<string | undefined>(undefined);
  const [batteryGraphOpen, setBatteryGraphOpen] = useState(false);
  const [batteryGraphHours, setBatteryGraphHours] = useState<3 | 6 | 12>(3); // 3h default, 6h, 12h
  const [batteryHistory, setBatteryHistory] = useState<BatteryHistoryPoint[]>([]);
  const [batteryHistoryLoading, setBatteryHistoryLoading] = useState(false);
  const [batteryHistoryError, setBatteryHistoryError] = useState<string | null>(null);
  const connection = useHass((s: { connection?: unknown }) => s.connection);
  const getAccessToken = useCallback((): string | null => {
    try {
      if (!connection) return null;
      const c = connection as { options?: { auth?: { accessToken?: string }; accessToken?: string }; auth?: { accessToken?: string } };
      if (c.options?.auth?.accessToken) return c.options.auth.accessToken;
      if (c.options?.accessToken) return c.options.accessToken;
      if (c?.auth?.accessToken) return c.auth.accessToken;
      return null;
    } catch {
      return null;
    }
  }, [connection]);
  const haBase = (
    import.meta.env.VITE_HA_URL && import.meta.env.VITE_HA_URL.length > 0
      ? import.meta.env.VITE_HA_URL
      : typeof window !== 'undefined'
        ? window.location.origin
        : ''
  )?.replace(/\/$/, '');

  const getHaOrigin = () => {
    try {
      return new URL(haBase).origin;
    } catch {
      return '';
    }
  };

  const toHaUrl = (path: string) => {
    if (!path) return '';
    return path.startsWith('http') ? path : `${haBase}${path}`;
  };

  // Group maps by room and get the latest one for each room, sorted alphabetically
  const getLatestMapsByRoom = (entries: MapEntry[]): MapEntry[] => {
    const byRoom = new Map<string, MapEntry>();
    entries.forEach(entry => {
      const roomKey = entry.room || 'unknown';
      const existing = byRoom.get(roomKey);
      if (!existing || (entry.datetime && existing.datetime && entry.datetime > existing.datetime)) {
        byRoom.set(roomKey, entry);
      }
    });
    return Array.from(byRoom.values()).sort((a, b) => {
      const aName = formatRoomName(a.room || a.room?.toString()) || a.room || 'Unknown room';
      const bName = formatRoomName(b.room || b.room?.toString()) || b.room || 'Unknown room';
      return aName.localeCompare(bName); // alphabetical order
    });
  };

  // Format time ago for live map
  const formatTimeAgo = (ts?: string): string => {
    if (!ts) return 'Updating...';
    try {
      const then = new Date(ts).getTime();
      const now = Date.now();
      const diffMs = now - then;
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 5) return 'Just now';
      if (diffSec < 60) return `${diffSec}s ago`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      return `${diffHr}h ago`;
    } catch {
      return 'Updating...';
    }
  };

  const formatMapDate = (datetime?: string, timestamp?: string): string => {
    const formatDateFriendly = (date: Date) => {
      const today = new Date();
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const diffDays = Math.floor((startOfToday.getTime() - startOfDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
      });
    };

    if (datetime) {
      try {
        const date = new Date(datetime);
        return formatDateFriendly(date);
      } catch {
        return datetime;
      }
    }
    if (timestamp) {
      // Format YYYYMMDD_HHMMSS to readable date
      try {
        const year = timestamp.substring(0, 4);
        const month = timestamp.substring(4, 6);
        const day = timestamp.substring(6, 8);
        const hour = timestamp.substring(9, 11);
        const minute = timestamp.substring(11, 13);
        const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
        return formatDateFriendly(date);
      } catch {
        return timestamp;
      }
    }
    return 'Unknown date';
  };

  // Handle map modal open/close with browser history
  const handleOpenMap = (map: MapEntry) => {
    setSelectedMap(map);
    try {
      window.history.pushState({ map: map.filename }, '', window.location.pathname);
    } catch {
      // Silently fail if history API not supported
    }
  };

  const handleCloseMap = () => {
    setSelectedMap(null);
    try {
      window.history.replaceState({ map: null }, '', window.location.pathname);
    } catch {
      // Silently fail if history API not supported
    }
  };

  const handleOpenLiveMap = () => {
    setShowLiveMap(true);
    try {
      window.history.pushState({ liveMap: true }, '', window.location.pathname);
    } catch {
      // Silently fail if history API not supported
    }
  };

  const handleCloseLiveMap = () => {
    setShowLiveMap(false);
    try {
      window.history.replaceState({ liveMap: null }, '', window.location.pathname);
    } catch {
      // Silently fail if history API not supported
    }
  };

  const handleOpenBatteryGraph = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBatteryGraphOpen(true);
    try {
      window.history.pushState({ batteryGraph: true }, '', window.location.pathname);
    } catch {
      /* ignore */
    }
  };
  const handleCloseBatteryGraph = () => {
    setBatteryGraphOpen(false);
    try {
      window.history.replaceState({ batteryGraph: null }, '', window.location.pathname);
    } catch {
      /* ignore */
    }
  };

  // Browser back button support (capture to avoid closing the whole room)
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      // If a map modal is open, close it and stop further handling
      if (selectedMap) {
        event.stopImmediatePropagation();
        setSelectedMap(null);
        try {
          window.history.replaceState({ map: null }, '', window.location.pathname);
        } catch {
          /* ignore */
        }
        return;
      }
      // If live map is open, close it and stop further handling
      if (showLiveMap) {
        event.stopImmediatePropagation();
        setShowLiveMap(false);
        try {
          window.history.replaceState({ liveMap: null }, '', window.location.pathname);
        } catch {
          /* ignore */
        }
        return;
      }
      if (batteryGraphOpen) {
        event.stopImmediatePropagation();
        setBatteryGraphOpen(false);
        try {
          window.history.replaceState({ batteryGraph: null }, '', window.location.pathname);
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('popstate', handlePopState, { capture: true });
    return () => window.removeEventListener('popstate', handlePopState, { capture: true });
  }, [selectedMap, showLiveMap, batteryGraphOpen]);

  // Use standardized swipe-to-close hook for map modal
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(handleCloseMap);

  // Use standardized swipe-to-close hook for live map modal
  const {
    handleTouchStart: handleLiveMapTouchStart,
    handleTouchMove: handleLiveMapTouchMove,
    handleTouchEnd: handleLiveMapTouchEnd,
  } = useSwipeToClose(handleCloseLiveMap);

  const {
    handleTouchStart: handleBatteryGraphTouchStart,
    handleTouchMove: handleBatteryGraphTouchMove,
    handleTouchEnd: handleBatteryGraphTouchEnd,
  } = useSwipeToClose(handleCloseBatteryGraph);

  useEffect(() => {
    if (!isExpanded) return;
    if (mapsLoadedRef.current) return;
    mapsLoadedRef.current = true;
    const load = async () => {
      try {
        setMapsLoading(true);
        const haOrigin = typeof window !== 'undefined' ? getHaOrigin() : '';
        const sameOrigin = typeof window !== 'undefined' && haOrigin === window.location.origin;
        // In dev (not on HA domain), use relative path so Vite proxy intercepts it
        // In prod (on HA domain), also use relative path (same origin)
        // Only use absolute URL if we're in a weird cross-origin prod scenario
        const isDev =
          typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
        const indexUrl = sameOrigin || isDev ? `/local/${ROBOT_MAPS_PATH}/index.json` : toHaUrl(`/local/${ROBOT_MAPS_PATH}/index.json`);
        const res = await fetch(indexUrl, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const entries: MapEntry[] = Array.isArray(data?.maps)
          ? data.maps.map((m: MapEntry) => {
              // Use relative URLs in dev/same-origin so proxy works, absolute in cross-origin prod
              const url = sameOrigin || isDev ? m.url : toHaUrl(m.url);
              return { ...m, url };
            })
          : [];
        setMaps(entries);
        setMapsError(null);
      } catch {
        setMapsError('Could not load maps');
        setMaps([]);
      } finally {
        setMapsLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getHaOrigin/toHaUrl are stable; ROBOT_MAPS_PATH is a constant
  }, [isExpanded]);

  // Live map refresh: react to HA updates only (no fixed polling)
  useEffect(() => {
    if (!showLiveMap) return;
    // Initial refresh when opening
    setLiveMapRefreshKey(prev => prev + 1);
  }, [showLiveMap]);

  useEffect(() => {
    if (!showLiveMap) return;
    const ts = liveMapImage?.last_updated;
    if (ts && ts !== lastLiveMapTsRef.current) {
      lastLiveMapTsRef.current = ts;
      setLiveMapRefreshKey(prev => prev + 1);
    }
  }, [showLiveMap, liveMapImage?.last_updated]);

  // Fetch battery history when graph modal opens
  useEffect(() => {
    if (!batteryGraphOpen) return;
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - batteryGraphHours * 60 * 60 * 1000);
    // Request sensor + vacuum in two separate calls to ensure we always get entity_id right
    const url = new URL(`/api/history/period/${startTime.toISOString()}`, window.location.origin);
    url.searchParams.set('filter_entity_id', `${VACUUM_BATTERY_SENSOR},${VACUUM_ENTITY}`);
    url.searchParams.set('end_time', endTime.toISOString());
    url.searchParams.set('significant_changes_only', '0');
    url.searchParams.set('minimal_response', '0');
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    const token = getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    let cancelled = false;
    setBatteryHistoryLoading(true);
    setBatteryHistoryError(null);
    fetch(url.toString(), { method: 'GET', headers, credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: unknown) => {
        if (cancelled) return;
        const raw = Array.isArray(data) ? data : [];
        console.debug('[VacuumCard] battery history raw rows:', raw.length, raw);
        const points: BatteryHistoryPoint[] = [];
        const push = (iso: string, value: number) => {
          const t = new Date(iso).getTime();
          if (!Number.isNaN(t) && value >= 0 && value <= 100) points.push({ t, value });
        };
        for (const row of raw) {
          // Each row is an array of state-objects for ONE entity.
          // entity_id appears only on the first item – track it per-row.
          const list = Array.isArray(row) ? row : [];
          if (list.length === 0) continue;
          type HAItem = {
            entity_id?: string;
            state?: string;
            last_changed?: string;
            last_updated?: string;
            attributes?: { battery_level?: number };
          };
          const rowEntityId = (list[0] as HAItem).entity_id ?? '';
          console.debug('[VacuumCard] row entity_id:', rowEntityId, 'items:', list.length);
          for (const item of list) {
            const it = item as HAItem;
            const ts = it.last_changed ?? it.last_updated ?? '';
            if (!ts) continue;
            if (rowEntityId === VACUUM_BATTERY_SENSOR) {
              const n = Number(it.state);
              if (!Number.isNaN(n)) push(ts, n);
            } else if (rowEntityId === VACUUM_ENTITY) {
              const lvl = it.attributes?.battery_level;
              if (lvl != null) push(ts, Number(lvl));
            }
          }
        }
        points.sort((a, b) => a.t - b.t);
        console.debug('[VacuumCard] battery history points:', points.length, points.slice(0, 5));
        setBatteryHistory(points);
      })
      .catch((err: unknown) => {
        if (!cancelled) setBatteryHistoryError(err instanceof Error ? err.message : 'Failed to load history');
      })
      .finally(() => {
        if (!cancelled) setBatteryHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [batteryGraphOpen, batteryGraphHours, getAccessToken]);

  if (!vacuum) return null;

  const state = vacuum.state; // cleaning, docked, returning, paused, idle, error, unavailable

  // Determine room status display based on state and room conditions
  const getRoomStatusDisplay = (): string => {
    // When docked, always show Office
    if (state === 'docked') {
      return 'Office';
    }

    // When finished with all rooms (no target room), show current room going to Office
    if (!targetRoomRaw || targetRoomRaw === '' || targetRoomRaw === 'unknown' || targetRoomRaw === 'unavailable') {
      if (liveRoomName) {
        return `${liveRoomName} going to Office`;
      }
      return 'Office';
    }

    // Check if robot is in the ordered room
    // Compare formatted names since raw values might differ (e.g., '25' vs 'kitchen_1' both = 'Kitchen Dining side')
    const isInTargetRoom = liveRoomName && targetRoomName && liveRoomName === targetRoomName;

    // When in the ordered room, show just the target room name
    if (isInTargetRoom && targetRoomName) {
      return targetRoomName;
    }

    // When not in the ordered room, show current room going to target room
    if (liveRoomName && targetRoomName) {
      return `${liveRoomName} going to ${targetRoomName}`;
    }

    // Fallback
    if (targetRoomName) {
      return `Going to ${targetRoomName}`;
    }

    if (liveRoomName) {
      return liveRoomName;
    }

    return 'Office';
  };

  const roomStatusDisplay = getRoomStatusDisplay();

  // Battery level: prefer vacuum attribute, fallback to dedicated sensor
  const batteryAttr = vacuum.attributes?.battery_level;
  const batterySensorRaw = entities?.[VACUUM_BATTERY_SENSOR]?.state;
  const battery =
    batteryAttr !== undefined && batteryAttr !== null
      ? Number(batteryAttr)
      : batterySensorRaw !== undefined && batterySensorRaw !== null && batterySensorRaw !== 'unavailable' && batterySensorRaw !== 'unknown'
        ? Number(batterySensorRaw)
        : undefined;
  const fanSpeed = typeof vacuum.attributes?.fan_speed === 'string' ? vacuum.attributes.fan_speed : undefined;
  const formatFanSpeed = (speed: string | undefined) => {
    if (!speed) return 'Normal';
    switch (speed.toLowerCase()) {
      case 'max_plus':
        return 'Max Plus';
      case 'max':
        return 'Max';
      case 'turbo':
        return 'Turbo';
      case 'high':
        return 'High';
      case 'medium':
        return 'Medium';
      case 'low':
        return 'Low';
      default:
        return speed.charAt(0).toUpperCase() + speed.slice(1);
    }
  };
  const formatState = (s: string | undefined) => {
    if (!s) return 'Unknown';
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const fanSpeedLabel = formatFanSpeed(fanSpeed);
  const stateLabel = formatState(vacuum.state);

  const isActive = state === 'cleaning' || state === 'returning';
  const isIdle = state === 'docked' || state === 'paused' || state === 'idle';
  const isError = state === 'error';
  const isOffline = state === 'unavailable' || !state;

  const getStateIcon = () => {
    switch (state) {
      case 'cleaning':
        return 'mdi:robot-vacuum';
      case 'docked':
        return 'mdi:robot-vacuum-variant';
      case 'returning':
        return 'mdi:home-import-outline';
      case 'paused':
        return 'mdi:pause-circle';
      case 'error':
        return 'mdi:alert-circle';
      default:
        return 'mdi:robot-vacuum';
    }
  };

  return (
    <div className={`vacuum-card ${isExpanded ? 'expanded' : ''} ${isActive ? 'active' : ''}`}>
      {/* Header */}
      <button className='vacuum-header' onClick={() => setIsExpanded(!isExpanded)}>
        <div className='vacuum-header-info'>
          <Icon
            icon={getStateIcon()}
            className={`vacuum-icon ${isActive ? 'working' : isError || isOffline ? 'error' : isIdle ? 'idle' : ''}`}
          />
          <div className='vacuum-status'>
            <span className='vacuum-name'>Robot</span>
            <span className='vacuum-state-text'>{stateLabel}</span>
          </div>
        </div>
        <div className='vacuum-header-right'>
          <div className='vacuum-power-chip' title='Power mode'>
            <Icon icon='mdi:fan' />
            <span>{fanSpeedLabel}</span>
          </div>
          <div
            role='button'
            tabIndex={0}
            className={`vacuum-battery ${state === 'docked' && battery !== undefined && battery < 100 ? 'charging' : ''}`}
            onClick={handleOpenBatteryGraph}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleOpenBatteryGraph(e as unknown as React.MouseEvent);
              }
            }}
            title='Battery level – tap for history'
          >
            {battery !== undefined ? (
              <>
                <Icon
                  icon={
                    state === 'docked' && battery < 100
                      ? 'mdi:battery-charging'
                      : battery > 80
                        ? 'mdi:battery'
                        : battery > 40
                          ? 'mdi:battery-50'
                          : 'mdi:battery-20'
                  }
                />
                <span>{Math.round(battery)}%</span>
              </>
            ) : (
              <>
                <Icon icon='mdi:battery-unknown' />
                <span>—</span>
              </>
            )}
          </div>
          <Icon icon={isExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className='vacuum-content'>
          {/* Cleaning progress - only show when robot is active */}
          {isActive && (cleaningProgressSafe !== undefined || roomStatusDisplay) && (
            <div className='vacuum-progress'>
              <div className='vacuum-progress-header'>
                <Icon icon='mdi:progress-clock' />
                <div className='vacuum-progress-text'>
                  <span className='room'>{roomStatusDisplay}</span>
                </div>
                <div className='vacuum-progress-right'>
                  {cleaningProgressSafe !== undefined && <span className='value'>{Math.round(cleaningProgressSafe)}%</span>}
                  {isActive && liveMapImage && (
                    <button className='vacuum-live-button' onClick={handleOpenLiveMap} title='View live map'>
                      <Icon icon='mdi:map-marker-radius' />
                      <span>Live</span>
                    </button>
                  )}
                </div>
              </div>
              {cleaningProgressSafe !== undefined && (
                <div className='vacuum-progress-bar'>
                  <div className='vacuum-progress-fill' style={{ width: `${cleaningProgressSafe}%` }} />
                </div>
              )}
            </div>
          )}

          {/* Cleaning maps (past runs) */}
          {maps !== null && (
            <div className='vacuum-maps'>
              <div className='vacuum-maps-header'>
                <Icon icon='mdi:map' />
                <div className='vacuum-maps-text'>
                  <span className='label'>Room maps</span>
                </div>
                {mapsLoading && <span className='value'>Loading…</span>}
                {!mapsLoading && mapsError && <span className='value error'>{mapsError}</span>}
              </div>
              {!mapsLoading && !mapsError && maps.length === 0 && <div className='vacuum-maps-empty'>No maps found.</div>}
              {!mapsLoading && maps.length > 0 && (
                <div className='vacuum-maps-list'>
                  {getLatestMapsByRoom(maps.filter(e => !STUCK_MAP_ROOMS.includes(e.room || ''))).map(entry => {
                    const friendlyRoom = formatRoomName(entry.room || entry.room?.toString());
                    const label = friendlyRoom || entry.room || 'Unknown room';
                    const dateStr = formatMapDate(entry.datetime, entry.timestamp);
                    return (
                      <button key={entry.filename} className='vacuum-map-button' onClick={() => handleOpenMap(entry)}>
                        <Icon icon='mdi:map-outline' />
                        <div className='vacuum-map-button-info'>
                          <span className='room'>{label}</span>
                          <span className='date'>{dateStr}</span>
                        </div>
                        <Icon icon='mdi:chevron-right' />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Clean while home toggle */}
          {(() => {
            const cleanWhileHomeId = 'input_boolean.clean_while_home';
            const cleanWhileHome = entities?.[cleanWhileHomeId];
            if (!cleanWhileHome) return null;

            const isEnabled = cleanWhileHome.state === 'on';

            const handleToggle = () => {
              if (!callService) return;
              callService({
                domain: 'input_boolean',
                service: isEnabled ? 'turn_off' : 'turn_on',
                target: { entity_id: cleanWhileHomeId },
              });
            };

            return (
              <button
                className={`vacuum-setting-toggle ${isEnabled ? 'on' : ''}`}
                onClick={handleToggle}
                title={isEnabled ? 'Disable cleaning while home' : 'Enable cleaning while home'}
              >
                <Icon icon='mdi:home-variant' />
                <span className='toggle-label'>Clean while home</span>
                <div className={`toggle-switch ${isEnabled ? 'on' : ''}`}>
                  <div className='toggle-slider' />
                </div>
              </button>
            );
          })()}
        </div>
      )}

      {/* Map Modal */}
      {selectedMap && (
        <>
          <div className='vacuum-map-overlay' onClick={handleCloseMap} />
          <div className='vacuum-map-modal' onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
            <div className='vacuum-map-modal-header'>
              <div className='vacuum-map-modal-title'>
                <Icon icon='mdi:map' />
                <div>
                  <span className='room'>
                    {formatRoomName(selectedMap.room || selectedMap.room?.toString()) || selectedMap.room || 'Unknown room'}
                  </span>
                  <span className='date'>{formatMapDate(selectedMap.datetime, selectedMap.timestamp)}</span>
                </div>
              </div>
              <button className='vacuum-map-modal-close modal-close-button' onClick={handleCloseMap}>
                <Icon icon='mdi:close' />
              </button>
            </div>
            <div className='vacuum-map-modal-content'>
              <img src={selectedMap.url} alt={selectedMap.filename} />
            </div>
          </div>
        </>
      )}

      {/* Live Map Modal */}
      {showLiveMap && liveMapImage && (
        <>
          <div className='vacuum-map-overlay' onClick={handleCloseLiveMap} />
          <div
            className='vacuum-map-modal vacuum-live-map-modal'
            onTouchStart={handleLiveMapTouchStart}
            onTouchMove={handleLiveMapTouchMove}
            onTouchEnd={handleLiveMapTouchEnd}
          >
            <div className='vacuum-map-modal-header'>
              <div className='vacuum-map-modal-title'>
                <Icon icon='mdi:map-marker-radius' />
                <div>
                  <span className='room'>Live Map</span>
                  <span className='date'>{formatTimeAgo(liveMapImage.last_updated)}</span>
                </div>
              </div>
              <button className='vacuum-map-modal-close modal-close-button' onClick={handleCloseLiveMap}>
                <Icon icon='mdi:close' />
              </button>
            </div>
            <div className='vacuum-map-modal-content'>
              <img
                src={(() => {
                  const entityPicture = liveMapImage.attributes?.entity_picture;
                  const pictureUrl = typeof entityPicture === 'string' ? entityPicture : '';
                  const ts = liveMapImage.last_updated || `${Date.now()}`;
                  const cacheBuster = `${ts}-${liveMapRefreshKey}`;
                  if (pictureUrl) {
                    // Preserve existing query params (like token) and append timestamp
                    const baseUrl = pictureUrl.startsWith('http') ? pictureUrl : `${haBase}${pictureUrl}`;
                    const separator = baseUrl.includes('?') ? '&' : '?';
                    return `${baseUrl}${separator}t=${cacheBuster}`;
                  }
                  // Fallback to camera proxy
                  return `${haBase}/api/camera_proxy/${VACUUM_MAP_IMAGE_ENTITY}?t=${cacheBuster}`;
                })()}
                alt='Live map'
                key={`${liveMapImage.last_updated || Date.now()}-${liveMapRefreshKey}`}
                onError={e => {
                  // Fallback to camera proxy if entity_picture fails
                  const target = e.target as HTMLImageElement;
                  if (!target.src.includes('/api/camera_proxy/')) {
                    const ts = liveMapImage.last_updated || `${Date.now()}`;
                    const cacheBuster = `${ts}-${liveMapRefreshKey}`;
                    target.src = `${haBase}/api/camera_proxy/${VACUUM_MAP_IMAGE_ENTITY}?t=${cacheBuster}`;
                  }
                }}
              />
            </div>
          </div>
        </>
      )}

      {/* Battery level history graph modal */}
      {batteryGraphOpen && (
        <>
          <div className='vacuum-map-overlay' onClick={handleCloseBatteryGraph} />
          <div
            className='vacuum-map-modal vacuum-battery-graph-modal'
            onTouchStart={handleBatteryGraphTouchStart}
            onTouchMove={handleBatteryGraphTouchMove}
            onTouchEnd={handleBatteryGraphTouchEnd}
          >
            <div className='vacuum-map-modal-header vacuum-battery-graph-header'>
              <div className='vacuum-map-modal-title'>
                <Icon icon='mdi:battery-charging' />
                <span className='room'>Battery level</span>
              </div>
              <div className='vacuum-battery-graph-range'>
                {([3, 6, 12] as const).map(h => (
                  <button
                    key={h}
                    type='button'
                    className={`vacuum-battery-graph-range-btn ${batteryGraphHours === h ? 'active' : ''}`}
                    onClick={() => setBatteryGraphHours(h)}
                  >
                    {h}h
                  </button>
                ))}
              </div>
              <button className='vacuum-map-modal-close modal-close-button' onClick={handleCloseBatteryGraph}>
                <Icon icon='mdi:close' />
              </button>
            </div>
            <div className='vacuum-battery-graph-content'>
              {batteryHistoryLoading && <div className='vacuum-battery-graph-loading'>Loading…</div>}
              {batteryHistoryError && <div className='vacuum-battery-graph-error'>{batteryHistoryError}</div>}
              {!batteryHistoryLoading && !batteryHistoryError && batteryHistory.length === 0 && (
                <div className='vacuum-battery-graph-empty'>No history data for this period.</div>
              )}
              {!batteryHistoryLoading && !batteryHistoryError && batteryHistory.length === 1 && (
                <div className='vacuum-battery-graph-single'>
                  <Icon icon='mdi:battery' />
                  <span>
                    Battery has been at <strong>{Math.round(batteryHistory[0].value)}%</strong> for the entire period
                  </span>
                </div>
              )}
              {!batteryHistoryLoading &&
                !batteryHistoryError &&
                batteryHistory.length > 1 &&
                (() => {
                  const w = 600;
                  const h = 220;
                  const pad = { top: 16, right: 12, bottom: 32, left: 40 };
                  const tMin = Math.min(...batteryHistory.map(p => p.t));
                  const tMax = Math.max(...batteryHistory.map(p => p.t));
                  // If only 1 point, extend the time window so the dot is centred
                  const tRange = tMax - tMin || batteryGraphHours * 60 * 60 * 1000;
                  const tPlotMin = tMin === tMax ? tMin - tRange / 2 : tMin;
                  const tPlotMax = tMin === tMax ? tMax + tRange / 2 : tMax;
                  const vals = batteryHistory.map(p => p.value);
                  const rawMin = Math.min(...vals);
                  const rawMax = Math.max(...vals);
                  // Always keep at least a 10% window so a flat line renders visibly
                  const vPad = Math.max(5, (rawMax - rawMin) * 0.15);
                  const vMin = Math.max(0, rawMin - vPad);
                  const vMax = Math.min(100, rawMax + vPad);
                  const vRange = vMax - vMin || 10;
                  const x = (t: number) => pad.left + ((t - tPlotMin) / (tPlotMax - tPlotMin)) * (w - pad.left - pad.right);
                  const y = (v: number) => pad.top + (1 - (v - vMin) / vRange) * (h - pad.top - pad.bottom);
                  const pathD = batteryHistory.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.t)} ${y(p.value)}`).join(' ');
                  const formatTime = (ts: number) => {
                    const d = new Date(ts);
                    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                  };
                  return (
                    <div className='vacuum-battery-graph-wrap'>
                      <svg className='vacuum-battery-graph-svg' viewBox={`0 0 ${w} ${h}`} preserveAspectRatio='xMidYMid meet'>
                        <defs>
                          <linearGradient id='vacuum-battery-gradient' x1='0' y1='1' x2='0' y2='0'>
                            <stop offset='0%' stopColor='rgba(52, 211, 153, 0.2)' />
                            <stop offset='100%' stopColor='rgba(52, 211, 153, 0.55)' />
                          </linearGradient>
                        </defs>
                        <path
                          d={`${pathD} L ${x(batteryHistory[batteryHistory.length - 1].t)} ${y(vMin)} L ${x(batteryHistory[0].t)} ${y(vMin)} Z`}
                          fill='url(#vacuum-battery-gradient)'
                        />
                        <path
                          d={pathD}
                          fill='none'
                          stroke='#34d399'
                          strokeWidth='2.5'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          className='vacuum-battery-graph-line'
                        />
                        {/* Horizontal grid lines at nice % values */}
                        {[0, 25, 50, 75, 100]
                          .filter(v => v >= vMin - 1 && v <= vMax + 1)
                          .map(v => (
                            <g key={v}>
                              <line
                                x1={pad.left}
                                y1={y(v)}
                                x2={w - pad.right}
                                y2={y(v)}
                                stroke='rgba(255,255,255,0.1)'
                                strokeDasharray='4,4'
                                strokeWidth='1'
                              />
                              <text x={pad.left - 6} y={y(v) + 4} textAnchor='end' className='vacuum-battery-graph-label'>
                                {v}%
                              </text>
                            </g>
                          ))}
                        {/* x-axis labels */}
                        <text x={pad.left} y={h - 6} textAnchor='start' className='vacuum-battery-graph-label vacuum-battery-graph-axis'>
                          {formatTime(tPlotMin)}
                        </text>
                        <text x={w - pad.right} y={h - 6} textAnchor='end' className='vacuum-battery-graph-label vacuum-battery-graph-axis'>
                          {formatTime(tPlotMax)}
                        </text>
                      </svg>
                    </div>
                  );
                })()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
