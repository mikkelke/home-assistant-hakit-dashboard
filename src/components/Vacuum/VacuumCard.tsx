import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import type { HassEntities, CallServiceFunction } from '../../types';
import { getAccessibleHistoryWindow, getHistoryUrl } from '../../utils/navigation';
import {
  ROBOT_ENABLED_BOOLEAN_ENTITY,
  VACUUM_ENTITY,
  VACUUM_BATTERY_SENSOR,
  VACUUM_CLEANING_PROGRESS_SENSOR,
  VACUUM_CURRENT_ROOM_INPUT,
  VACUUM_CURRENT_ROOM_SENSOR,
  VACUUM_MAP_IMAGE_ENTITY,
  ROBOT_MAPS_PATH,
} from '../../config/entities';
import { useLocalStorageBoolean, useSwipeToClose, useTouchScrollSlopGuard } from '../../hooks';
import { formatRoberRoomName } from './rooms';
import './VacuumCard.css';

// "Rober2" card in the Climate-card grammar (see AC/TonightCard): emerald glyph disc, hero
// number, a gradient day-strip, and icon doors instead of labelled setting rows. The card is
// kitchen-only (RoomDetail decides); every other room gets RoomCleaningToggle's request row.

type BatteryHistoryPoint = { t: number; value: number };

/** One stretch of today the robot actually spent driving, with the room that dominated it. */
type DaySpan = { startMs: number; endMs: number; room?: string };

/** Vacuum states that mean "it is out on the floor" - the day strip paints exactly these. */
const ACTIVE_STATES = new Set(['cleaning', 'returning']);

/** A span narrower than this can't carry its room name without colliding. */
const SPAN_LABEL_MIN_PCT = 6;

interface VacuumCardProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

function formatHHMM(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Clamp a timestamp to 0-100% of [startMs, endMs] so no segment can overflow the track. */
function pctOf(ms: number, startMs: number, endMs: number): number {
  if (!Number.isFinite(ms) || endMs <= startMs) return 0;
  return Math.min(100, Math.max(0, ((ms - startMs) / (endMs - startMs)) * 100));
}

type HistPoint = { t: number; s: string };
type HAHistItem = { entity_id?: string; state?: string; last_changed?: string; last_updated?: string };

/** HA /api/history/period rows -> one sorted state series per entity (entity_id rides on item 0). */
function parseHistorySeries(raw: unknown): Map<string, HistPoint[]> {
  const out = new Map<string, HistPoint[]>();
  const rows = Array.isArray(raw) ? raw : [];
  for (const row of rows) {
    const list = Array.isArray(row) ? row : [];
    if (list.length === 0) continue;
    const id = (list[0] as HAHistItem).entity_id ?? '';
    if (!id) continue;
    const pts: HistPoint[] = [];
    for (const item of list) {
      const it = item as HAHistItem;
      const t = Date.parse(it.last_changed ?? it.last_updated ?? '');
      if (!Number.isFinite(t)) continue;
      pts.push({ t, s: String(it.state ?? '') });
    }
    pts.sort((a, b) => a.t - b.t);
    out.set(id, pts);
  }
  return out;
}

/** Room values that carry no room. */
const isRoomValue = (s: string) => !!s && s !== 'unknown' && s !== 'unavailable' && s !== 'none' && s !== '';

export function VacuumCard({ entities, callService }: VacuumCardProps) {
  // Collapsed by default, remembered across sessions (same pattern as TonightCard/HeatCard).
  const [collapsed, setCollapsed] = useLocalStorageBoolean('robercard-collapsed', true);
  const topSlop = useTouchScrollSlopGuard();
  const barSlop = useTouchScrollSlopGuard();
  // Now-tick: the day strip's right edge is live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Entity IDs from config/entities.ts
  const vacuum = entities?.[VACUUM_ENTITY];
  const vacuumState = vacuum?.state;
  const enabledEntity = entities?.[ROBOT_ENABLED_BOOLEAN_ENTITY];
  const roberOff = enabledEntity?.state === 'off';
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

  // Stuck map entries (robot got stuck) – used for call-to-action elsewhere; hide from room maps grid.
  // Keyed "stuck_…" by the rober2 app; prefix match so the dock room can move without breaking this.
  const isStuckMapRoom = (room?: string) => !!room && room.startsWith('stuck');

  const formatRoomName = formatRoberRoomName;
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
  const [roomsSheetOpen, setRoomsSheetOpen] = useState(false);
  const [showLiveMap, setShowLiveMap] = useState(false);
  const [liveMapRefreshKey, setLiveMapRefreshKey] = useState(0);
  const lastLiveMapTsRef = useRef<string | undefined>(undefined);
  const [batteryGraphOpen, setBatteryGraphOpen] = useState(false);
  const [batteryGraphHours, setBatteryGraphHours] = useState<3 | 6 | 12>(3); // 3h default, 6h, 12h
  const [batteryHistory, setBatteryHistory] = useState<BatteryHistoryPoint[]>([]);
  const [batteryHistoryLoading, setBatteryHistoryLoading] = useState(false);
  const [batteryHistoryError, setBatteryHistoryError] = useState<string | null>(null);
  const [daySpans, setDaySpans] = useState<DaySpan[]>([]);
  const connection = useHass((s: { connection?: unknown }) => s.connection);
  const selectedMapRef = useRef<MapEntry | null>(null);
  const roomsSheetOpenRef = useRef(false);
  const showLiveMapRef = useRef(false);
  const batteryGraphOpenRef = useRef(false);
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

  const modalHistoryUrl = () => getHistoryUrl();

  const withHistoryWindow = (action: (targetWindow: Window) => void) => {
    const targetWindow = getAccessibleHistoryWindow();
    if (!targetWindow) return;
    action(targetWindow);
  };

  // Group maps by room and get the latest one for each room, freshest first (the Rooms sheet
  // reads as "what has been cleaned lately", not as an index).
  const getLatestMapsByRoom = (entries: MapEntry[]): MapEntry[] => {
    const byRoom = new Map<string, MapEntry>();
    entries.forEach(entry => {
      const roomKey = entry.room || 'unknown';
      const existing = byRoom.get(roomKey);
      if (!existing || (entry.datetime && existing.datetime && entry.datetime > existing.datetime)) {
        byRoom.set(roomKey, entry);
      }
    });
    const sortKey = (e: MapEntry) => e.datetime || e.timestamp || '';
    return Array.from(byRoom.values()).sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  };

  // Format time ago for live map
  const formatTimeAgo = (ts?: string): string => {
    if (!ts) return 'Updating...';
    try {
      const then = new Date(ts).getTime();
      const nowMs = Date.now();
      const diffMs = nowMs - then;
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
      if (diffDays === 0) return `Today ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
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
      withHistoryWindow(targetWindow => {
        targetWindow.history.pushState({ map: map.filename }, '', modalHistoryUrl());
      });
    } catch {
      // Silently fail if history API not supported
    }
  };

  const handleCloseMap = () => {
    setSelectedMap(null);
    try {
      withHistoryWindow(targetWindow => {
        targetWindow.history.replaceState({ map: null }, '', modalHistoryUrl());
      });
    } catch {
      // Silently fail if history API not supported
    }
  };

  const handleOpenRoomsSheet = () => {
    setRoomsSheetOpen(true);
    try {
      withHistoryWindow(targetWindow => {
        targetWindow.history.pushState({ roomsSheet: true }, '', modalHistoryUrl());
      });
    } catch {
      // Silently fail if history API not supported
    }
  };

  const handleCloseRoomsSheet = () => {
    setRoomsSheetOpen(false);
    try {
      withHistoryWindow(targetWindow => {
        targetWindow.history.replaceState({ roomsSheet: null }, '', modalHistoryUrl());
      });
    } catch {
      // Silently fail if history API not supported
    }
  };

  const handleOpenLiveMap = () => {
    setShowLiveMap(true);
    try {
      withHistoryWindow(targetWindow => {
        targetWindow.history.pushState({ liveMap: true }, '', modalHistoryUrl());
      });
    } catch {
      // Silently fail if history API not supported
    }
  };

  const handleCloseLiveMap = () => {
    setShowLiveMap(false);
    try {
      withHistoryWindow(targetWindow => {
        targetWindow.history.replaceState({ liveMap: null }, '', modalHistoryUrl());
      });
    } catch {
      // Silently fail if history API not supported
    }
  };

  const handleOpenBatteryGraph = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBatteryGraphOpen(true);
    try {
      withHistoryWindow(targetWindow => {
        targetWindow.history.pushState({ batteryGraph: true }, '', modalHistoryUrl());
      });
    } catch {
      /* ignore */
    }
  };
  const handleCloseBatteryGraph = () => {
    setBatteryGraphOpen(false);
    try {
      withHistoryWindow(targetWindow => {
        targetWindow.history.replaceState({ batteryGraph: null }, '', modalHistoryUrl());
      });
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    selectedMapRef.current = selectedMap;
  }, [selectedMap]);

  useEffect(() => {
    roomsSheetOpenRef.current = roomsSheetOpen;
  }, [roomsSheetOpen]);

  useEffect(() => {
    showLiveMapRef.current = showLiveMap;
  }, [showLiveMap]);

  useEffect(() => {
    batteryGraphOpenRef.current = batteryGraphOpen;
  }, [batteryGraphOpen]);

  useEffect(() => {
    const handleModalBack = (event: Event) => {
      if (selectedMapRef.current) {
        event.preventDefault();
        setSelectedMap(null);
        try {
          withHistoryWindow(targetWindow => {
            targetWindow.history.replaceState({ map: null }, '', modalHistoryUrl());
          });
        } catch {
          /* ignore */
        }
        return;
      }

      if (roomsSheetOpenRef.current) {
        event.preventDefault();
        setRoomsSheetOpen(false);
        try {
          withHistoryWindow(targetWindow => {
            targetWindow.history.replaceState({ roomsSheet: null }, '', modalHistoryUrl());
          });
        } catch {
          /* ignore */
        }
        return;
      }

      if (showLiveMapRef.current) {
        event.preventDefault();
        setShowLiveMap(false);
        try {
          withHistoryWindow(targetWindow => {
            targetWindow.history.replaceState({ liveMap: null }, '', modalHistoryUrl());
          });
        } catch {
          /* ignore */
        }
        return;
      }

      if (batteryGraphOpenRef.current) {
        event.preventDefault();
        setBatteryGraphOpen(false);
        try {
          withHistoryWindow(targetWindow => {
            targetWindow.history.replaceState({ batteryGraph: null }, '', modalHistoryUrl());
          });
        } catch {
          /* ignore */
        }
      }
    };

    window.addEventListener('modalBackButton', handleModalBack);
    return () => window.removeEventListener('modalBackButton', handleModalBack);
  }, []);

  // Browser back button support (capture to avoid closing the whole room)
  useEffect(() => {
    const targetWindow = getAccessibleHistoryWindow();
    if (!targetWindow) return;

    const handlePopState = (event: PopStateEvent) => {
      // If a map modal is open, close it and stop further handling
      if (selectedMap) {
        event.stopImmediatePropagation();
        setSelectedMap(null);
        try {
          withHistoryWindow(targetWindow => {
            targetWindow.history.replaceState({ map: null }, '', modalHistoryUrl());
          });
        } catch {
          /* ignore */
        }
        return;
      }
      // If the rooms sheet is open, close it and stop further handling
      if (roomsSheetOpen) {
        event.stopImmediatePropagation();
        setRoomsSheetOpen(false);
        try {
          withHistoryWindow(targetWindow => {
            targetWindow.history.replaceState({ roomsSheet: null }, '', modalHistoryUrl());
          });
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
          withHistoryWindow(targetWindow => {
            targetWindow.history.replaceState({ liveMap: null }, '', modalHistoryUrl());
          });
        } catch {
          /* ignore */
        }
        return;
      }
      if (batteryGraphOpen) {
        event.stopImmediatePropagation();
        setBatteryGraphOpen(false);
        try {
          withHistoryWindow(targetWindow => {
            targetWindow.history.replaceState({ batteryGraph: null }, '', modalHistoryUrl());
          });
        } catch {
          /* ignore */
        }
      }
    };
    targetWindow.addEventListener('popstate', handlePopState, { capture: true });
    return () => targetWindow.removeEventListener('popstate', handlePopState, { capture: true });
  }, [selectedMap, roomsSheetOpen, showLiveMap, batteryGraphOpen]);

  // Use standardized swipe-to-close hook for map modal
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(handleCloseMap);

  // Use standardized swipe-to-close hook for the rooms sheet
  const {
    handleTouchStart: handleRoomsTouchStart,
    handleTouchMove: handleRoomsTouchMove,
    handleTouchEnd: handleRoomsTouchEnd,
  } = useSwipeToClose(handleCloseRoomsSheet);

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
    if (collapsed) return;
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
  }, [collapsed]);

  // Day strip: today's driving stretches, joined to the room sensor for their labels. One
  // history call, same shape as the battery graph's; re-read whenever the run state changes.
  useEffect(() => {
    if (collapsed || roberOff) return;
    const endTime = new Date();
    const dayStart = new Date(endTime.getFullYear(), endTime.getMonth(), endTime.getDate());
    const url = new URL(`/api/history/period/${dayStart.toISOString()}`, window.location.origin);
    url.searchParams.set('filter_entity_id', `${VACUUM_ENTITY},${VACUUM_CURRENT_ROOM_SENSOR}`);
    url.searchParams.set('end_time', endTime.toISOString());
    url.searchParams.set('significant_changes_only', '0');
    url.searchParams.set('minimal_response', '0');
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    const token = getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    let cancelled = false;
    fetch(url.toString(), { method: 'GET', headers, credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: unknown) => {
        if (cancelled) return;
        const series = parseHistorySeries(data);
        const vacPts = series.get(VACUUM_ENTITY) ?? [];
        const roomPts = (series.get(VACUUM_CURRENT_ROOM_SENSOR) ?? []).filter(p => isRoomValue(p.s));
        const dayStartMs = dayStart.getTime();
        const nowMs = Date.now();

        const spans: DaySpan[] = [];
        let openStart: number | null = null;
        for (const p of vacPts) {
          const active = ACTIVE_STATES.has(p.s);
          if (active && openStart === null) openStart = Math.max(p.t, dayStartMs);
          else if (!active && openStart !== null) {
            if (p.t > openStart) spans.push({ startMs: openStart, endMs: p.t });
            openStart = null;
          }
        }
        if (openStart !== null && nowMs > openStart) spans.push({ startMs: openStart, endMs: nowMs });

        // Join: the room that owned most of a span names it. A span whose rooms don't add up
        // to at least half its length stays UNLABELED - a wrong room name is worse than none.
        for (const span of spans) {
          if (roomPts.length === 0) continue;
          const tally = new Map<string, number>();
          for (let i = 0; i < roomPts.length; i++) {
            const from = roomPts[i].t;
            const to = i + 1 < roomPts.length ? roomPts[i + 1].t : nowMs;
            const overlap = Math.min(to, span.endMs) - Math.max(from, span.startMs);
            if (overlap > 0) tally.set(roomPts[i].s, (tally.get(roomPts[i].s) ?? 0) + overlap);
          }
          let bestRoom = '';
          let bestMs = 0;
          tally.forEach((ms, room) => {
            if (ms > bestMs) {
              bestMs = ms;
              bestRoom = room;
            }
          });
          const spanMs = span.endMs - span.startMs;
          if (bestRoom && spanMs > 0 && bestMs / spanMs >= 0.5) span.room = bestRoom;
        }

        setDaySpans(spans.filter(s => s.endMs > s.startMs));
      })
      .catch(() => {
        if (!cancelled) setDaySpans([]);
      });
    return () => {
      cancelled = true;
    };
  }, [collapsed, roberOff, vacuumState, getAccessToken]);

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
      return 'Claudias Room';
    }

    // When finished with all rooms (no target room), show current room going to Office
    if (!targetRoomRaw || targetRoomRaw === '' || targetRoomRaw === 'unknown' || targetRoomRaw === 'unavailable') {
      if (liveRoomName) {
        return `${liveRoomName} going to Claudias Room`;
      }
      return 'Claudias Room';
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

    return 'Claudias Room';
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
  const isError = state === 'error';
  const isOffline = state === 'unavailable' || !state;

  // The state word compresses the whole card: what it is doing, plus the one number that
  // matters in that mode (charge on the dock, suction out on the floor).
  const stateWord = roberOff
    ? 'Off'
    : state === 'docked' && battery !== undefined
      ? `${stateLabel} · ${Math.round(battery)}%`
      : state === 'cleaning'
        ? `${stateLabel} · ${fanSpeedLabel}`
        : stateLabel;

  const batteryDoorIcon =
    battery === undefined
      ? 'mdi:battery-unknown'
      : state === 'docked' && battery < 100
        ? 'mdi:battery-charging'
        : battery > 80
          ? 'mdi:battery'
          : battery > 40
            ? 'mdi:battery-50'
            : 'mdi:battery-20';

  const togglePower = () => {
    if (!callService || !enabledEntity) return;
    callService({
      domain: 'input_boolean',
      service: enabledEntity.state === 'on' ? 'turn_off' : 'turn_on',
      target: { entity_id: ROBOT_ENABLED_BOOLEAN_ENTITY },
    });
  };

  // Day strip geometry - the bar opens at the first stretch of the day and ends at now.
  const barStartMs = daySpans.length ? daySpans[0].startMs : null;
  const barEndMs = now;
  const showDayStrip = barStartMs != null && barEndMs > barStartMs;

  const heroSubParts = [`battery · ${roomStatusDisplay}`];
  if (isActive && cleaningProgressSafe !== undefined) heroSubParts.push(`${Math.round(cleaningProgressSafe)}% of run done`);

  const roomMapEntries = maps ? getLatestMapsByRoom(maps.filter(e => !isStuckMapRoom(e.room))) : [];

  return (
    <div className='rober-card'>
      {/* Top row - also the collapse/expand tap target (collapsed by default) */}
      <div
        className='rober-top'
        onClick={() => {
          if (topSlop.consumeBlockClick()) return;
          setCollapsed(v => !v);
        }}
        onTouchStart={topSlop.onTouchStart}
        onTouchMove={topSlop.onTouchMove}
        onTouchEnd={topSlop.onTouchEnd}
        onTouchCancel={topSlop.onTouchCancel}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed(v => !v);
          }
        }}
        role='button'
        tabIndex={0}
        aria-expanded={!collapsed}
      >
        <span className={`rober-glyph ${roberOff ? 'is-off' : ''}`}>
          <Icon icon='mdi:robot-vacuum' aria-hidden='true' />
        </span>
        <span className='rober-title'>Rober2</span>
        <span className='rober-top-right'>
          <span className={`rober-state ${roberOff ? 'muted' : isActive ? 'tint' : isError || isOffline ? 'alert' : 'muted'}`}>
            {stateWord}
          </span>
          <Icon icon={collapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'} aria-hidden='true' className='rober-chevron' />
        </span>
      </div>

      {/* Switched off: the card is one word and one door back on. */}
      {!collapsed && roberOff && (
        <div className='rober-doors rober-doors--lone'>
          <button type='button' className='rober-ibtn' onClick={togglePower} aria-label='Turn Rober2 back on' title='Turn on'>
            <Icon icon='mdi:power' aria-hidden='true' />
          </button>
        </div>
      )}

      {/* Expanded content */}
      {!collapsed && !roberOff && (
        <>
          <div className='rober-hero'>
            <div className='rober-hero-value'>
              {battery !== undefined ? Math.round(battery) : '--'}
              <sup className='rober-hero-unit'>%</sup>
            </div>
            <div className='rober-hero-sub'>{heroSubParts.join(' · ')}</div>
          </div>

          {showDayStrip && barStartMs != null && (
            <div
              className='rober-bar-section'
              onClick={() => {
                if (barSlop.consumeBlockClick()) return;
                handleOpenRoomsSheet();
              }}
              onTouchStart={barSlop.onTouchStart}
              onTouchMove={barSlop.onTouchMove}
              onTouchEnd={barSlop.onTouchEnd}
              onTouchCancel={barSlop.onTouchCancel}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleOpenRoomsSheet();
                }
              }}
              role='button'
              tabIndex={0}
              aria-label="Show today's rooms"
            >
              <div className='rober-bar-track'>
                {daySpans.map(span => {
                  const left = pctOf(span.startMs, barStartMs, barEndMs);
                  const width = Math.max(0, pctOf(span.endMs, barStartMs, barEndMs) - left);
                  if (width <= 0) return null;
                  const label = span.room ? formatRoomName(span.room) : undefined;
                  return (
                    <div key={span.startMs} className='rober-bar-fill' style={{ left: `${left}%`, width: `${width}%` }}>
                      {label && width >= SPAN_LABEL_MIN_PCT && <span className='rober-bar-word'>{label}</span>}
                    </div>
                  );
                })}
              </div>
              <div className='rober-bar-ticks'>
                <span className='rober-bar-tick rober-bar-tick--start'>{formatHHMM(barStartMs)}</span>
                <span className='rober-bar-tick rober-bar-tick--now'>{formatHHMM(barEndMs)}</span>
              </div>
            </div>
          )}

          {/* Cleans while we're home - a preference, so it keeps its toggle row */}
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
              <div className='rober-hairline'>
                <div
                  className='rober-toggle-row'
                  onClick={handleToggle}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleToggle();
                    }
                  }}
                  role='switch'
                  tabIndex={0}
                  aria-checked={isEnabled}
                >
                  <span>Cleans while we're home</span>
                  <span className={`rober-knob ${isEnabled ? 'on' : ''}`} aria-hidden='true' />
                </div>
              </div>
            );
          })()}

          {/* Icon doors */}
          <div className='rober-doors'>
            <button
              type='button'
              className='rober-ibtn rober-ibtn--tint'
              onClick={handleOpenBatteryGraph}
              aria-label='Battery history'
              title='Battery level – tap for history'
            >
              <Icon icon={batteryDoorIcon} aria-hidden='true' />
            </button>
            <button type='button' className='rober-ibtn rober-ibtn--tint' onClick={handleOpenRoomsSheet} aria-label='Rooms' title='Rooms'>
              <Icon icon='mdi:map-outline' aria-hidden='true' />
            </button>
            {isActive && liveMapImage && (
              <button
                type='button'
                className='rober-ibtn rober-ibtn--tint'
                onClick={handleOpenLiveMap}
                aria-label='Live map'
                title='View live map'
              >
                <Icon icon='mdi:map-marker-radius' aria-hidden='true' />
              </button>
            )}
            {enabledEntity && (
              <button
                type='button'
                className='rober-ibtn'
                onClick={togglePower}
                aria-label={enabledEntity.state === 'on' ? 'Turn Rober2 off' : 'Turn Rober2 on'}
                title={enabledEntity.state === 'on' ? 'Turn off' : 'Turn on'}
              >
                <Icon icon='mdi:power' aria-hidden='true' />
              </button>
            )}
          </div>
        </>
      )}

      {/* Rooms sheet - every saved map, freshest first */}
      {roomsSheetOpen && (
        <>
          <div className='vacuum-map-overlay' onClick={handleCloseRoomsSheet} />
          <div
            className='vacuum-map-modal rober-rooms-modal'
            role='dialog'
            aria-modal='true'
            onTouchStart={handleRoomsTouchStart}
            onTouchMove={handleRoomsTouchMove}
            onTouchEnd={handleRoomsTouchEnd}
          >
            <div className='vacuum-map-modal-header'>
              <div className='vacuum-map-modal-title'>
                <Icon icon='mdi:robot-vacuum' />
                <span className='room'>Rooms</span>
              </div>
              <button className='vacuum-map-modal-close modal-close-button' onClick={handleCloseRoomsSheet} aria-label='Close'>
                <Icon icon='mdi:close' />
              </button>
            </div>
            <div className='vacuum-map-modal-content rober-rooms-content'>
              {mapsLoading && <div className='rober-rooms-note'>Loading…</div>}
              {!mapsLoading && mapsError && <div className='rober-rooms-note error'>{mapsError}</div>}
              {!mapsLoading && !mapsError && roomMapEntries.length === 0 && <div className='rober-rooms-note'>No maps found.</div>}
              {!mapsLoading && roomMapEntries.length > 0 && (
                <div className='rober-rooms-grid'>
                  {roomMapEntries.map(entry => {
                    const friendlyRoom = formatRoomName(entry.room || entry.room?.toString());
                    const label = friendlyRoom || entry.room || 'Unknown room';
                    const dateStr = formatMapDate(entry.datetime, entry.timestamp);
                    return (
                      <button key={entry.filename} type='button' className='rober-room-tile' onClick={() => handleOpenMap(entry)}>
                        <img className='rober-room-img' src={entry.url} alt={label} loading='lazy' />
                        <span className='rober-room-name'>{label}</span>
                        <span className='rober-room-date'>{dateStr}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
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
