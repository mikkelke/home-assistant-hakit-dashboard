import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import { useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { useTrackedEntities } from '../../hooks/useTrackedEntities';
import { useAppOpenTracking } from '../../hooks/useAppOpenTracking';
import { EXCLUDED_AREAS } from '../../config/dashboard';
import type { Area, HassEntities } from '../../types';
import {
  ROUTE_ADOPTED_EVENT,
  buildHistoryUrlWithHash,
  buildRoomHash,
  getAccessibleHistoryWindow,
  isNowHash,
  parseDashboardHash,
  replaceHistoryState,
  type NowFocus,
  type OpenNow,
} from '../../utils/navigation';
import {
  ROOM_OVER_NOW_KEY,
  isRoomOverNow,
  leaveNowEntry,
  nowEntryItem,
  pushNowEntry,
  settleNowEntry,
  type NowEntryBelow,
  type NowEntryChange,
} from '../../utils/nowHistory';
import { onIdle } from '../../utils/idle';
import { trackUiTap } from '../../utils/trackUiTap';
import { COFFEE_AREA_ID, COFFEE_TABLET_VIEWER } from '../../coffee/entities';
import { useViewer } from '../../hooks/useViewer';
import { useCoffeeTakeover } from '../Coffee/useCoffeeTakeover';
import type { EnergyTab } from '../Energy/energyTab';
import { HomeHeader } from '../Home/HomeHeader';
import { MotionConditions } from '../Home/MotionConditions';
import { PulseRow } from '../Home/PulseRow';
import { HomePulse } from '../HomePulse';
import { LazyBoundary } from '../Lazy/LazyBoundary';
import { QuickAccess } from '../QuickAccess/QuickAccess';
import { RoomGrid } from '../RoomGrid';
import { Menu } from '../Menu';
import { FireAlarmTakeover } from '../FireSafety';
import { FIRE_SAFETY_SENSOR, KITCHEN_COOKING_MODE_BOOLEAN, SMOKE_ALARM_SENSORS } from '../../config/entities';
import './Dashboard.css';

// The Energy page and its chart tree only ever mount behind Menu → Energy (or a #energy hash), so it is
// split out of the first-paint bundle. The Suspense fallback is an empty stand-in for the page's own
// full-screen dark backdrop (see .energy-page-loading in Dashboard.css), so the swap is invisible.
const EnergyPage = lazy(() => import('../Energy').then(module => ({ default: module.EnergyPage })));

// The admin-only sensor map is a chunk of its own too, behind Menu → Map (or a #map hash). The page checks the
// viewer itself, so the grid carries nothing but the route.
const SensorMapPage = lazy(() => import('../SensorMap').then(module => ({ default: module.SensorMapPage })));
// The admin-only heating overview, behind Menu → Heating or a #heating link from a push.
const HeatingPage = lazy(() => import('../Heating/HeatingPage').then(module => ({ default: module.HeatingPage })));

// Room detail is the app's other big subtree (every card lives in it) and only mounts on a room tap,
// so it is split out too — phones are the main client (see the audience memory) and cold loads are
// common there. Unlike Energy it is warmed on idle right after first paint, because a room tap is the
// most likely next action: by the time anyone taps, the chunk is already cached and the panel opens
// with no fetch. `import()` is memoised by the module registry, so the warm-up and the lazy() call
// share one promise.
const RoomDetail = lazy(() => import('../RoomDetail').then(module => ({ default: module.RoomDetail })));
const warmRoomDetail = () => void import('../RoomDetail');

// The coffee stage is the wine-fridge tablet's brew screen, behind the Kitchen's Coffee entry or a #coffee hash.
const CoffeeStage = lazy(() => import('../Coffee/CoffeeStage'));

/** History state of a #coffee entry pushed over the Kitchen, which the stage's back button returns to. */
const COFFEE_OVER_KITCHEN_KEY = 'coffeeOverKitchen';

// The #now timeline is warmed on idle like room detail, and fetched at once when the app opens on a
// #now link (a tapped push), so the timeline is the first thing that renders.
const NowView = lazy(() => import('../Now').then(module => ({ default: module.NowView })));
const warmNowView = () => void import('../Now');
if (isNowHash(getAccessibleHistoryWindow()?.location.hash ?? '')) warmNowView();

interface NowRoute {
  focus: NowFocus | null;
  /** The exact item an in-app tap opened on, kept in the entry's history state. */
  itemId: string | null;
  /** `cold`: shown in place, as on an app opened by a link or Back; `warm`: pushed in from the grid. */
  arrival: 'cold' | 'warm';
  /** A link that arrived just now, which this app seeded or adopted, rather than an entry it returned to. */
  linkArrived: boolean;
}

const historyFlag = (state: unknown, key: string): boolean =>
  typeof state === 'object' && state !== null && (state as Record<string, unknown>)[key] === true;

const sameFocus = (a: NowFocus | null, b: NowFocus | null) => a?.kind === b?.kind && a?.epochS === b?.epochS;
const routeKey = (route: NowRoute) => `${route.focus ? `${route.focus.kind}-${route.focus.epochS}` : 'now'}:${route.itemId ?? ''}`;

/** Build mock washer entities for ?washer_demo=running|unemptied|paused|emptied|off (for UI preview). */
function getWasherDemoEntities(mode: string | null): HassEntities {
  if (!mode) return {};
  const now = new Date();
  const started = new Date(now.getTime() - 65 * 60 * 1000);
  const ends = new Date(now.getTime() + 87 * 60 * 1000);
  const programmeOptions = [
    'Auto (unconfirmed)',
    'Ekspres 20',
    'Uld 30',
    'Bomuld 20',
    'Finvask 40',
    'Strygelet 30',
    'ECO',
    'Bomuld 40',
    'Bomuld 60',
    'Bomuld 90/70',
  ];
  const base: HassEntities = {
    'input_select.washer_confirmed_programme': {
      entity_id: 'input_select.washer_confirmed_programme',
      state: 'ECO',
      attributes: { options: programmeOptions },
    },
    'input_boolean.washer_announce': {
      entity_id: 'input_boolean.washer_announce',
      state: 'on',
      attributes: {},
    },
  };
  const sensorState = (state: string, attributes: Record<string, unknown>) => ({
    entity_id: 'sensor.washer_state',
    state,
    attributes,
  });
  switch (mode.toLowerCase()) {
    case 'running':
      base['sensor.washer_state'] = sensorState('Running', {
        programme_label: 'ECO',
        detected_programme: 'eco',
        estimated_remaining_min: 87,
        estimated_end_time: ends.toISOString(),
        cycle_start_time: started.toISOString(),
        programme_duration_min: 199,
      });
      break;
    case 'unemptied':
      base['sensor.washer_state'] = sensorState('Unemptied', {
        programme_label: 'ECO',
        detected_programme: 'eco',
        run_time_minutes: 197.3,
        energy_used: 0.712,
      });
      break;
    case 'paused':
      base['sensor.washer_state'] = sensorState('Paused', { programme_label: 'ECO' });
      break;
    case 'emptied':
      base['sensor.washer_state'] = sensorState('Emptied', { programme_label: 'ECO' });
      break;
    case 'off':
      base['sensor.washer_state'] = sensorState('Off', {});
      break;
    default:
      return {};
  }
  return base;
}

/** Build mock dishwasher entities for ?dishwasher_demo=running|unemptied|paused|emptied|off (for UI preview). */
function getDishwasherDemoEntities(mode: string | null): HassEntities {
  if (!mode) return {};
  const now = new Date();
  const started = new Date(now.getTime() - 45 * 60 * 1000);
  const ends = new Date(now.getTime() + 135 * 60 * 1000);
  const programmeOptions = ['Auto (unconfirmed)', 'Quick', 'Normal', 'ECO', 'ECO Short', 'Rinse', 'Intensive', 'Unknown'];
  const base: HassEntities = {
    'input_select.dishwasher_confirmed_programme': {
      entity_id: 'input_select.dishwasher_confirmed_programme',
      state: 'ECO',
      attributes: { options: programmeOptions },
    },
    'input_select.dishwasher_short': {
      entity_id: 'input_select.dishwasher_short',
      state: '—',
      attributes: { options: ['—', 'Yes', 'No'] },
    },
  };
  const sensorState = (state: string, attributes: Record<string, unknown>) => ({
    entity_id: 'sensor.dishwasher_state',
    state,
    attributes,
  });
  const inputDishwasherState = (state: string) => {
    base['input_select.dishwasher_state'] = {
      entity_id: 'input_select.dishwasher_state',
      state,
      attributes: { options: ['Off', 'Running', 'Paused', 'Unemptied', 'Emptied'] },
    };
  };
  switch (mode.toLowerCase()) {
    case 'running':
      inputDishwasherState('Running');
      base['sensor.dishwasher_state'] = sensorState('Running', {
        programme_label: 'ECO',
        detected_programme: 'eco',
        progress_pct: 25,
        estimated_remaining_min: 135,
        estimated_end_time: ends.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
        cycle_start_time: started.toISOString(),
        programme_duration_min: 180,
      });
      break;
    case 'unemptied':
      inputDishwasherState('Unemptied');
      base['sensor.dishwasher_state'] = sensorState('Unemptied', {
        programme_label: 'ECO',
        detected_programme: 'eco',
        run_time_minutes: 178,
        energy_used: 0.85,
      });
      break;
    case 'paused':
      inputDishwasherState('Paused');
      base['sensor.dishwasher_state'] = sensorState('Paused', { programme_label: 'ECO' });
      break;
    case 'emptied':
      inputDishwasherState('Emptied');
      base['sensor.dishwasher_state'] = sensorState('Emptied', { programme_label: 'ECO' });
      break;
    case 'off':
      inputDishwasherState('Off');
      base['sensor.dishwasher_state'] = sensorState('Off', {});
      break;
    default:
      return {};
  }
  return base;
}

/** Build mock dryer entities for ?dryer_demo=running|unemptied|paused|emptied|off (for UI preview). */
function getDryerDemoEntities(mode: string | null): HassEntities {
  if (!mode) return {};
  const now = new Date();
  const started = new Date(now.getTime() - 30 * 60 * 1000);
  const ends = new Date(now.getTime() + 68 * 60 * 1000);
  const programmeOptions = [
    'Auto (unconfirmed)',
    'Bomuld eco',
    'Bomuld',
    'Strygelet',
    'Finvask',
    'Finish uld',
    'Skjorter',
    'Ekspres',
    'Denim',
    'Sengetøj',
    'Imprægnering',
    'Udglatning',
    'Varm luft',
  ];
  const base: HassEntities = {
    'input_select.dryer_programme': {
      entity_id: 'input_select.dryer_programme',
      state: 'Ekspres',
      attributes: { options: programmeOptions },
    },
    'input_select.dryer_dryness': {
      entity_id: 'input_select.dryer_dryness',
      state: 'Skabstørt',
      attributes: { options: ['Skabstørt', 'Strygetørt'] },
    },
    'input_boolean.dryer_skane_plus': {
      entity_id: 'input_boolean.dryer_skane_plus',
      state: 'off',
      attributes: {},
    },
    'input_select.dryer_time_minutes': {
      entity_id: 'input_select.dryer_time_minutes',
      state: '60',
      attributes: { options: ['20', '30', '60', '90', '120'] },
    },
    'input_boolean.dryer_announce': {
      entity_id: 'input_boolean.dryer_announce',
      state: 'off',
      attributes: {},
    },
  };
  const sensorState = (state: string, attributes: Record<string, unknown>) => ({
    entity_id: 'sensor.dryer_state',
    state,
    attributes,
  });
  switch (mode.toLowerCase()) {
    case 'running':
      base['sensor.dryer_state'] = sensorState('Running', {
        programme_label: 'Ekspres Skabstørt',
        detected_programme: 'ekspres_cupboard',
        progress_pct: 31,
        estimated_remaining_min: 68,
        estimated_end_time: ends.toISOString(),
        cycle_start_time: started.toISOString(),
        programme_duration_min: 98,
      });
      break;
    case 'unemptied':
      base['sensor.dryer_state'] = sensorState('Unemptied', {
        programme_label: 'Ekspres Skabstørt',
        detected_programme: 'ekspres_cupboard',
        run_time_minutes: 98,
        energy_used: 0.92,
      });
      break;
    case 'paused':
      base['sensor.dryer_state'] = sensorState('Paused', { programme_label: 'Ekspres Skabstørt' });
      break;
    case 'emptied':
      base['sensor.dryer_state'] = sensorState('Emptied', { programme_label: 'Ekspres Skabstørt' });
      break;
    case 'off':
      base['sensor.dryer_state'] = sensorState('Off', {});
      break;
    default:
      return {};
  }
  return base;
}

/** Build mock fire-safety entities for ?fire_demo=pre_alarm|alarm|hushed|cooldown|offline|fault (for UI preview). */
function getFireDemoEntities(mode: string | null): HassEntities {
  if (!mode) return {};
  const now = new Date();
  const since = new Date(now.getTime() - 3 * 60 * 1000);
  const hushedUntil = new Date(now.getTime() + 8 * 60 * 1000 + 42 * 1000);
  const hhmm = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const sensor = (id: string, state: string, attributes: Record<string, unknown> = {}) => ({ entity_id: id, state, attributes });
  const base: HassEntities = {
    [SMOKE_ALARM_SENSORS.temperature]: sensor(SMOKE_ALARM_SENSORS.temperature, '25.7', { unit_of_measurement: '°C' }),
    [SMOKE_ALARM_SENSORS.humidity]: sensor(SMOKE_ALARM_SENSORS.humidity, '41.8', { unit_of_measurement: '%' }),
    [SMOKE_ALARM_SENSORS.eco2]: sensor(SMOKE_ALARM_SENSORS.eco2, '510', { unit_of_measurement: 'ppm' }),
    [SMOKE_ALARM_SENSORS.aqi]: sensor(SMOKE_ALARM_SENSORS.aqi, '1'),
    [SMOKE_ALARM_SENSORS.battery]: sensor(SMOKE_ALARM_SENSORS.battery, '100', { unit_of_measurement: '%' }),
    [SMOKE_ALARM_SENSORS.sirenState]: sensor(SMOKE_ALARM_SENSORS.sirenState, 'clear'),
    [KITCHEN_COOKING_MODE_BOOLEAN]: sensor(KITCHEN_COOKING_MODE_BOOLEAN, 'off'),
  };
  const common = {
    since: since.toISOString(),
    episode_id: 'demo',
    hushed_until: null,
    hushed_by: null,
    hush_count: 0,
    ack_by: null,
    last_smoke: 'off',
    battery: 100,
    battery_low: 'false',
    last_test: new Date(now.getTime() - 5 * 24 * 3600 * 1000).toISOString(),
    test_overdue: 'false',
    device_available: 'true',
    cooking_until: null,
    iaq: 1,
    iaq_band: 'fresh',
    eco2: 510,
    eco2_band: 'fresh',
    computed_at: now.toISOString(),
    dry_run: 'true',
  };
  const fire = (state: string, attributes: Record<string, unknown>) => {
    base[FIRE_SAFETY_SENSOR] = sensor(FIRE_SAFETY_SENSOR, state, { ...common, ...attributes });
  };
  switch (mode.toLowerCase()) {
    case 'pre_alarm':
      fire('pre_alarm', {
        headline: 'Smoke building',
        detail: `Kitchen ceiling · ${hhmm(since)}`,
        last_smoke: 'off',
        iaq_band: 'stuffy',
        eco2_band: 'good',
      });
      base[SMOKE_ALARM_SENSORS.sirenState] = sensor(SMOKE_ALARM_SENSORS.sirenState, 'pre_alarm');
      break;
    case 'alarm':
      fire('alarm', { headline: 'Smoke detected', detail: `Kitchen ceiling · ${hhmm(since)}`, last_smoke: 'on' });
      base[SMOKE_ALARM_SENSORS.sirenState] = sensor(SMOKE_ALARM_SENSORS.sirenState, 'fire');
      break;
    case 'hushed':
      fire('hushed', {
        headline: 'Silenced by Kristine',
        detail: `Re-arms at ${hhmm(hushedUntil)}`,
        hushed_until: hushedUntil.toISOString(),
        hushed_by: 'Kristine',
        hush_count: 1,
        last_smoke: 'on',
      });
      break;
    case 'cooldown':
      fire('cooldown', { headline: 'Clearing', detail: `Smoke off since ${hhmm(since)}` });
      break;
    case 'offline':
      fire('offline', { headline: 'Alarm offline', detail: `No data since ${hhmm(since)}`, device_available: 'false', battery: null });
      break;
    case 'fault':
      fire('clear', {
        headline: 'All clear',
        detail: 'Kitchen alarm normal',
        battery: 9,
        battery_low: 'true',
        test_overdue: 'true',
        last_test: null,
      });
      base[SMOKE_ALARM_SENSORS.battery] = sensor(SMOKE_ALARM_SENSORS.battery, '9', { unit_of_measurement: '%' });
      break;
    default:
      return {};
  }
  return base;
}

export function Dashboard() {
  useAppOpenTracking();
  const areas = useHass(state => state.areas);
  const entities = useTrackedEntities();
  const hassUrl = useHass(state => state.hassUrl);
  const callService = useHass(state => state.helpers?.callService);

  const [selectedRoom, setSelectedRoom] = useState<Area | null>(null);
  // One-shot: which room's climate sheet should auto-open on arrival (room-card temp/humidity tap,
  // or a `#room=<id>&climate=1` deep link). Cleared by RoomClimateHeader once it has acted on it.
  const [climateAutoOpenAreaId, setClimateAutoOpenAreaId] = useState<string | null>(null);
  const [energyOpen, setEnergyOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [heatingOpen, setHeatingOpen] = useState(false);
  const [coffeeOpen, setCoffeeOpen] = useState(false);
  // A #coffee&takeover=<brew> link, as it arrived; the takeover arms its return to the grid once per arrival.
  const [coffeeLink, setCoffeeLink] = useState<{ brewId: string; atMs: number } | null>(null);
  const [nowRoute, setNowRoute] = useState<NowRoute | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const isMobile = useIsMobile();
  // Flag to prevent hash change handler from running during programmatic updates
  const isUpdatingHashRef = useRef(false);
  const hashUpdateTimeoutRef = useRef<number | null>(null);
  // The hash as last processed or set by this component. The poll below only reacts to a hash nothing has handled yet
  // (a parent frame navigating the iframe), not to one the app pushed itself.
  const lastHandledHashRef = useRef('');
  // Ref to track current selected room without causing dependency issues
  const selectedRoomRef = useRef<Area | null>(null);
  // Ref to track energy view open state without causing dependency issues
  const energyOpenRef = useRef(false);
  const mapOpenRef = useRef(false);
  const heatingOpenRef = useRef(false);
  const coffeeOpenRef = useRef(false);
  const nowRouteRef = useRef<NowRoute | null>(null);
  // The first hash this app instance routes on is an arrival (a cold link or an iframe reload); every later
  // one is a navigation.
  const firstSyncRef = useRef(true);
  // A room opened from the timeline closes back to it. Mirrors the room entry's state, which keeps it
  // across Forward and reloads.
  const roomOverNowRef = useRef(false);

  // Filter out excluded areas. Memoised on `areas`: a fresh array on every render would give findRoomById and syncStateFromHash a
  // new identity each time, which tears down and re-creates the hash listeners and the 500 ms poll below on every update.
  const areaList = useMemo(
    () => Object.values(areas || {}).filter(area => !EXCLUDED_AREAS.includes(area.name.toLowerCase())) as Area[],
    [areas]
  );

  // Optional: ?washer_demo=... / ?dishwasher_demo=... / ?dryer_demo=... to preview appliance cards (merge mock entities)
  const washerDemo = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('washer_demo') : null;
  const dishwasherDemo = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('dishwasher_demo') : null;
  const dryerDemo = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('dryer_demo') : null;
  const fireDemo = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('fire_demo') : null;
  const displayEntities = useMemo(() => {
    const base = entities || {};
    const washerMock = getWasherDemoEntities(washerDemo);
    const dishwasherMock = getDishwasherDemoEntities(dishwasherDemo);
    const dryerMock = getDryerDemoEntities(dryerDemo);
    const fireMock = getFireDemoEntities(fireDemo);
    if (
      Object.keys(washerMock).length === 0 &&
      Object.keys(dishwasherMock).length === 0 &&
      Object.keys(dryerMock).length === 0 &&
      Object.keys(fireMock).length === 0
    )
      return base;
    return { ...base, ...washerMock, ...dishwasherMock, ...dryerMock, ...fireMock };
  }, [entities, washerDemo, dishwasherDemo, dryerDemo, fireDemo]);

  // Fetch the room-detail and timeline chunks once the browser is idle after first paint, so the first
  // tap costs nothing. requestIdleCallback is missing on Safari/iOS, which is most of this household's
  // phones — fall back to a timeout there rather than skipping the warm-up on the very clients it
  // matters most for.
  useEffect(
    () =>
      onIdle(() => {
        warmRoomDetail();
        warmNowView();
      }, 1500),
    []
  );

  // Keep ref in sync with state (safety measure)
  useEffect(() => {
    selectedRoomRef.current = selectedRoom;
  }, [selectedRoom]);

  useEffect(() => {
    energyOpenRef.current = energyOpen;
    mapOpenRef.current = mapOpen;
    heatingOpenRef.current = heatingOpen;
    coffeeOpenRef.current = coffeeOpen;
  }, [energyOpen, mapOpen, heatingOpen, coffeeOpen]);

  const showNow = useCallback((route: NowRoute | null) => {
    nowRouteRef.current = route;
    setNowRoute(route);
  }, []);

  useEffect(() => {
    return () => {
      if (hashUpdateTimeoutRef.current !== null) {
        window.clearTimeout(hashUpdateTimeoutRef.current);
      }
    };
  }, []);

  // Called right before the app writes history itself. The hash that write leaves counts as handled, so the
  // listeners and the poll do not route on it again; a hash that differs once the window ends (Back pressed
  // meanwhile) is still picked up by the poll.
  const markHashUpdating = useCallback(() => {
    if (typeof window === 'undefined') return;
    isUpdatingHashRef.current = true;
    if (hashUpdateTimeoutRef.current !== null) {
      window.clearTimeout(hashUpdateTimeoutRef.current);
    }
    queueMicrotask(() => {
      lastHandledHashRef.current = getAccessibleHistoryWindow()?.location.hash ?? lastHandledHashRef.current;
    });
    hashUpdateTimeoutRef.current = window.setTimeout(() => {
      isUpdatingHashRef.current = false;
      hashUpdateTimeoutRef.current = null;
    }, 120);
  }, []);

  // Helper to find room by ID (supports area_id, normalized name, or lowercase name)
  const findRoomById = useCallback(
    (roomId: string): Area | undefined => {
      return areaList.find(area => {
        const normalizedName = area.name.toLowerCase().replace(/\s+/g, '_');
        return area.area_id === roomId || normalizedName === roomId || area.name.toLowerCase() === roomId;
      });
    },
    [areaList]
  );

  const replaceRoomHistory = useCallback(
    (roomId: string | null, openClimate?: boolean) => {
      const targetWindow = getAccessibleHistoryWindow();
      if (!targetWindow) return;

      try {
        markHashUpdating();
        replaceHistoryState(
          targetWindow,
          { room: roomId },
          buildHistoryUrlWithHash(targetWindow, roomId ? buildRoomHash(roomId, openClimate) : null)
        );
      } catch (err) {
        console.debug('Failed to replace room history:', err);
        isUpdatingHashRef.current = false;
      }
    },
    [markHashUpdating]
  );

  const pushRoomHistory = useCallback(
    (roomId: string, openClimate?: boolean, overNow = false) => {
      roomOverNowRef.current = overNow;
      const targetWindow = getAccessibleHistoryWindow();
      if (!targetWindow) return;

      try {
        markHashUpdating();
        const state = overNow ? { room: roomId, [ROOM_OVER_NOW_KEY]: true } : { room: roomId };
        targetWindow.history.pushState(state, '', buildHistoryUrlWithHash(targetWindow, buildRoomHash(roomId, openClimate)));
      } catch (err) {
        console.debug('Failed to push room history:', err);
        isUpdatingHashRef.current = false;
      }
    },
    [markHashUpdating]
  );

  // The Energy, map, heating and coffee pages are hash routes of the same kind: opening pushes one entry, closing swaps
  // it for the bare URL.
  const replaceRouteHistory = useCallback(
    (route: 'energy' | 'map' | 'heating' | 'coffee') => {
      const targetWindow = getAccessibleHistoryWindow();
      if (!targetWindow) return;

      try {
        markHashUpdating();
        replaceHistoryState(targetWindow, { [route]: null }, buildHistoryUrlWithHash(targetWindow, null));
      } catch (err) {
        console.debug(`Failed to replace ${route} history:`, err);
        isUpdatingHashRef.current = false;
      }
    },
    [markHashUpdating]
  );

  const pushRouteHistory = useCallback(
    (route: 'energy' | 'map' | 'heating' | 'coffee', hash: string, extra: Record<string, unknown> = {}) => {
      const targetWindow = getAccessibleHistoryWindow();
      if (!targetWindow) return;

      try {
        markHashUpdating();
        targetWindow.history.pushState({ [route]: true, ...extra }, '', buildHistoryUrlWithHash(targetWindow, hash));
      } catch (err) {
        console.debug(`Failed to push ${route} history:`, err);
        isUpdatingHashRef.current = false;
      }
    },
    [markHashUpdating]
  );

  // Sync state from URL hash (single source of truth)
  const syncStateFromHash = useCallback(() => {
    if (areaList.length === 0) return;
    if (isUpdatingHashRef.current) return; // Skip if we're updating hash programmatically

    const targetWindow = getAccessibleHistoryWindow();
    const hash = targetWindow?.location.hash ?? '';
    const followed = !firstSyncRef.current && targetWindow != null && hash !== lastHandledHashRef.current;
    lastHandledHashRef.current = targetWindow ? hash : lastHandledHashRef.current;
    const view = parseDashboardHash(hash);
    const arrival = firstSyncRef.current ? 'load' : 'navigation';
    firstSyncRef.current = false;
    if (followed) {
      window.dispatchEvent(new Event(ROUTE_ADOPTED_EVENT));
      setIsMenuOpen(false);
    }
    roomOverNowRef.current = view.kind === 'room' && isRoomOverNow(targetWindow?.history.state);

    if (view.kind === 'now') {
      // The timeline sits over whatever showed when its link arrived; seeding a cold link puts the grid below it.
      const shownBefore: NowEntryBelow =
        selectedRoomRef.current ||
        energyOpenRef.current ||
        mapOpenRef.current ||
        heatingOpenRef.current ||
        coffeeOpenRef.current ||
        nowRouteRef.current
          ? 'other'
          : 'grid';
      let change: NowEntryChange = 'none';
      if (targetWindow) {
        try {
          change = settleNowEntry(targetWindow.history, targetWindow.location, arrival, shownBefore);
          if (change !== 'none') markHashUpdating();
        } catch (err) {
          console.debug('Failed to settle the timeline history entry:', err);
        }
      }
      const itemId = targetWindow ? nowEntryItem(targetWindow.history.state) : null;
      const current = nowRouteRef.current;
      if (!current || !sameFocus(current.focus, view.focus) || current.itemId !== itemId)
        showNow({ focus: view.focus, itemId, arrival: change === 'adopted' ? 'warm' : 'cold', linkArrived: change !== 'none' });
      if (selectedRoomRef.current) setSelectedRoom(null);
      if (energyOpenRef.current) setEnergyOpen(false);
      if (mapOpenRef.current) setMapOpen(false);
      if (heatingOpenRef.current) setHeatingOpen(false);
      if (coffeeOpenRef.current) setCoffeeOpen(false);
      return;
    }

    if (nowRouteRef.current) showNow(null);

    if (view.kind === 'energy' || view.kind === 'map' || view.kind === 'heating' || view.kind === 'coffee') {
      if (mapOpenRef.current !== (view.kind === 'map')) setMapOpen(view.kind === 'map');
      if (heatingOpenRef.current !== (view.kind === 'heating')) setHeatingOpen(view.kind === 'heating');
      if (energyOpenRef.current !== (view.kind === 'energy')) setEnergyOpen(view.kind === 'energy');
      if (coffeeOpenRef.current !== (view.kind === 'coffee')) setCoffeeOpen(view.kind === 'coffee');
      if (view.kind === 'coffee' && view.takeover) setCoffeeLink({ brewId: view.takeover, atMs: Date.now() });
      if (selectedRoomRef.current) setSelectedRoom(null);
      return;
    }

    if (energyOpenRef.current) setEnergyOpen(false);
    if (mapOpenRef.current) setMapOpen(false);
    if (heatingOpenRef.current) setHeatingOpen(false);
    if (coffeeOpenRef.current) setCoffeeOpen(false);

    if (view.kind === 'none') {
      // No hash - close room if open
      if (selectedRoomRef.current) {
        setSelectedRoom(null);
      }
      return;
    }

    // Find room from hash
    const room = findRoomById(view.roomId);

    if (!room) {
      if (selectedRoomRef.current) {
        setSelectedRoom(null);
      }
      return;
    }

    // Only update if different (avoid unnecessary re-renders)
    if (selectedRoomRef.current?.area_id !== room.area_id) {
      setSelectedRoom(room);
    }
    if (view.openClimate) setClimateAutoOpenAreaId(room.area_id);
  }, [areaList, findRoomById, markHashUpdating, showNow]);

  // Initialize from hash on mount and when areas load
  useEffect(() => {
    if (areaList.length > 0) {
      const id = setTimeout(() => syncStateFromHash(), 0);
      return () => clearTimeout(id);
    }
  }, [areaList.length, syncStateFromHash]); // Only run when areaList length changes (initial load)

  // Listen for hash changes (browser back/forward, manual URL changes)
  useEffect(() => {
    const targetWindow = getAccessibleHistoryWindow();
    if (!targetWindow) return;

    const handleHashChange = () => {
      // Small delay to ensure hash is updated
      setTimeout(() => {
        syncStateFromHash();
      }, 50);
    };

    targetWindow.addEventListener('hashchange', handleHashChange);
    return () => targetWindow.removeEventListener('hashchange', handleHashChange);
  }, [syncStateFromHash]);

  // Poll hash periodically for iframe contexts where hashchange might not fire
  // This is necessary for dashboard-rooftop scenarios
  useEffect(() => {
    const targetWindow = getAccessibleHistoryWindow();
    if (!targetWindow) return;

    lastHandledHashRef.current = targetWindow.location.hash;

    const checkHash = () => {
      if (isUpdatingHashRef.current) return; // Skip if we're updating

      if (targetWindow.location.hash !== lastHandledHashRef.current) {
        syncStateFromHash();
      }
    };

    // Check immediately
    checkHash();

    // Poll every 500ms (slower to avoid conflicts)
    const pollInterval = window.setInterval(checkHash, 500);

    return () => {
      clearInterval(pollInterval);
    };
  }, [syncStateFromHash]);

  // Handle browser back button (works in browsers and HA app WebView)
  useEffect(() => {
    const targetWindow = getAccessibleHistoryWindow();
    if (!targetWindow) return;

    const handlePopState = (event: PopStateEvent) => {
      // First, dispatch a custom event to let modals handle back button
      const modalBackEvent = new CustomEvent('modalBackButton', { cancelable: true });
      const wasHandled = !window.dispatchEvent(modalBackEvent);

      // If a modal handled the back button, stop propagation and don't close the room
      if (wasHandled) {
        event.stopImmediatePropagation();
        return;
      }

      setTimeout(() => {
        syncStateFromHash();
      }, 0);
    };

    targetWindow.addEventListener('popstate', handlePopState, { capture: true });
    return () => targetWindow.removeEventListener('popstate', handlePopState, { capture: true });
  }, [syncStateFromHash]);

  const handleRoomClick = (area: Area) => {
    if (selectedRoomRef.current?.area_id === area.area_id) {
      handleCloseRoom();
      return;
    }

    setSelectedRoom(area);
    pushRoomHistory(area.area_id);
    trackUiTap('home.room', area.area_id);
  };

  // Room-card temperature/humidity tap: open the room panel with the climate sheet already open.
  const handleRoomClimateClick = (area: Area) => {
    const alreadySelected = selectedRoomRef.current?.area_id === area.area_id;
    setSelectedRoom(area);
    setClimateAutoOpenAreaId(area.area_id);
    if (!alreadySelected) {
      pushRoomHistory(area.area_id, true);
    } else {
      replaceRoomHistory(area.area_id, true);
    }
    trackUiTap('home.room.climate', area.area_id);
  };

  const handlePulseRoomSelect = (areaId: string) => {
    const room = findRoomById(areaId);
    if (!room) return;

    const alreadySelected = selectedRoomRef.current?.area_id === room.area_id;
    setSelectedRoom(room);
    if (!alreadySelected) {
      pushRoomHistory(room.area_id);
    } else {
      replaceRoomHistory(room.area_id);
    }
  };

  const handleCloseRoom = () => {
    const targetWindow = getAccessibleHistoryWindow();
    if (roomOverNowRef.current && targetWindow) {
      // Back to the timeline entry below; the hash sync shows it and closes the room.
      roomOverNowRef.current = false;
      targetWindow.history.back();
      return;
    }
    setSelectedRoom(null);
    replaceRoomHistory(null);
  };

  const handleOpenEnergy = (tab: EnergyTab = 'live') => {
    pushRouteHistory('energy', tab === 'live' ? '#energy' : `#energy=${tab}`);
    setEnergyOpen(true);
    setSelectedRoom(null);
  };

  const handleCloseEnergy = useCallback(() => {
    setEnergyOpen(false);
    replaceRouteHistory('energy');
  }, [replaceRouteHistory]);

  const handleOpenMap = () => {
    pushRouteHistory('map', '#map');
    setMapOpen(true);
    setSelectedRoom(null);
  };

  // The page closes itself, and is also sent away when the viewer turns out not to be an administrator.
  const handleCloseMap = useCallback(() => {
    setMapOpen(false);
    replaceRouteHistory('map');
  }, [replaceRouteHistory]);

  const handleOpenHeating = () => {
    pushRouteHistory('heating', '#heating');
    setHeatingOpen(true);
    setSelectedRoom(null);
  };

  const handleCloseHeating = useCallback(() => {
    setHeatingOpen(false);
    replaceRouteHistory('heating');
  }, [replaceRouteHistory]);

  // The stage opens over what shows; from the Kitchen it goes back there, from anywhere else its back button opens it.
  const openCoffeeStage = useCallback(
    (fromKitchen: boolean) => {
      pushRouteHistory('coffee', '#coffee', fromKitchen ? { [COFFEE_OVER_KITCHEN_KEY]: true } : {});
      setCoffeeOpen(true);
      setSelectedRoom(null);
      setEnergyOpen(false);
      setMapOpen(false);
      setHeatingOpen(false);
      showNow(null);
    },
    [pushRouteHistory, showNow]
  );

  const handleCloseCoffee = useCallback(() => {
    const targetWindow = getAccessibleHistoryWindow();
    if (targetWindow && historyFlag(targetWindow.history.state, COFFEE_OVER_KITCHEN_KEY)) {
      targetWindow.history.back();
      return;
    }
    setCoffeeOpen(false);
    const kitchen = findRoomById(COFFEE_AREA_ID);
    if (!kitchen) {
      replaceRouteHistory('coffee');
      return;
    }
    setSelectedRoom(kitchen);
    replaceRoomHistory(kitchen.area_id);
  }, [findRoomById, replaceRoomHistory, replaceRouteHistory]);

  const viewer = useViewer();
  const isCoffeeTablet = viewer.name === COFFEE_TABLET_VIEWER;
  // Home's coffee pieces: the stage on the tablet, the Kitchen with its Coffee card on top on a phone.
  const handleOpenCoffee = () => {
    if (isCoffeeTablet) openCoffeeStage(false);
    else handlePulseRoomSelect(COFFEE_AREA_ID);
    trackUiTap('home.coffee');
  };
  const takeOverForCoffee = useCallback(() => openCoffeeStage(false), [openCoffeeStage]);
  const returnFromCoffee = useCallback(
    (to: 'back' | 'grid') => {
      const targetWindow = getAccessibleHistoryWindow();
      if (to === 'back' && targetWindow) {
        targetWindow.history.back();
        return;
      }
      setCoffeeOpen(false);
      replaceRouteHistory('coffee');
    },
    [replaceRouteHistory]
  );
  useCoffeeTakeover({ enabled: isCoffeeTablet, onStage: coffeeOpen, link: coffeeLink, open: takeOverForCoffee, goBack: returnFromCoffee });

  const openNow: OpenNow = useCallback(
    (focus, itemId) => {
      const targetWindow = getAccessibleHistoryWindow();
      if (targetWindow) {
        try {
          markHashUpdating();
          pushNowEntry(
            targetWindow.history,
            targetWindow.location,
            focus ?? null,
            selectedRoomRef.current || energyOpenRef.current || mapOpenRef.current || heatingOpenRef.current || coffeeOpenRef.current
              ? 'other'
              : 'grid',
            itemId
          );
        } catch (err) {
          console.debug('Failed to push the timeline history entry:', err);
          isUpdatingHashRef.current = false;
        }
      }
      showNow({ focus: focus ?? null, itemId: itemId ?? null, arrival: 'warm', linkArrived: false });
      setSelectedRoom(null);
      setEnergyOpen(false);
      setMapOpen(false);
      setHeatingOpen(false);
      setCoffeeOpen(false);
    },
    [markHashUpdating, showNow]
  );

  const closeNow = useCallback(() => {
    showNow(null);
    const targetWindow = getAccessibleHistoryWindow();
    if (!targetWindow) return;
    try {
      markHashUpdating();
      leaveNowEntry(targetWindow.history, targetWindow.location);
    } catch (err) {
      console.debug('Failed to leave the timeline history entry:', err);
      isUpdatingHashRef.current = false;
    }
  }, [markHashUpdating, showNow]);

  const openRoomFromNow = useCallback(
    (areaId: string) => {
      const room = findRoomById(areaId);
      if (!room) return;
      showNow(null);
      setSelectedRoom(room);
      pushRoomHistory(room.area_id, false, true);
    },
    [findRoomById, pushRoomHistory, showNow]
  );

  const motionScope = nowRoute
    ? 'timeline'
    : coffeeOpen
      ? 'stage'
      : energyOpen || mapOpen || heatingOpen || selectedRoom || isMenuOpen
        ? null
        : 'grid';

  return (
    <div className={`dashboard ${selectedRoom ? 'has-detail' : ''} ${nowRoute ? 'is-covered' : ''}`}>
      <MotionConditions scope={motionScope} />
      <Menu
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        entities={displayEntities}
        callService={callService}
        onOpenEnergy={() => handleOpenEnergy()}
        onOpenMap={handleOpenMap}
        onOpenHeating={handleOpenHeating}
      />
      <FireAlarmTakeover entities={displayEntities} callService={callService} />
      <div className='dashboard-main'>
        <div className='dashboard-content'>
          <main className='rooms-container'>
            <HomeHeader
              entities={displayEntities}
              hassUrl={hassUrl}
              onMenu={() => setIsMenuOpen(open => !open)}
              onOpenNow={openNow}
              onOpenCoffee={handleOpenCoffee}
            />
            <PulseRow onOpenEnergy={handleOpenEnergy} onOpenNow={openNow} />
            <HomePulse
              areas={areaList}
              entities={displayEntities === entities ? undefined : displayEntities}
              hassUrl={hassUrl}
              onRoomSelect={handlePulseRoomSelect}
            />
            <RoomGrid
              areas={areaList}
              entities={displayEntities}
              selectedAreaId={selectedRoom?.area_id || null}
              onRoomClick={handleRoomClick}
              onRoomClimateClick={handleRoomClimateClick}
              hassUrl={hassUrl}
            />
          </main>
          {/* Fixed bar at z-index 1000 — would float above the Energy, map, heating and coffee pages (z-index 90) and the
              timeline, so it unmounts while any is open. */}
          {!energyOpen && !mapOpen && !heatingOpen && !coffeeOpen && !nowRoute && (
            <QuickAccess hassUrl={hassUrl} callService={callService} onOpenNow={openNow} />
          )}
        </div>

        {selectedRoom && (
          <>
            {isMobile && <div className='overlay' onClick={handleCloseRoom} />}
            {/* No fallback surface: the panel's own slide-up is the opening animation, and a
                stand-in rectangle underneath it would read as a double flash. Warmed on idle, so
                in practice the chunk is already there when this mounts. */}
            <Suspense fallback={null}>
              <RoomDetail
                key={selectedRoom.area_id}
                area={selectedRoom}
                entities={displayEntities === entities ? undefined : displayEntities}
                hassUrl={hassUrl}
                callService={callService}
                onClose={handleCloseRoom}
                isMobile={isMobile}
                autoOpenClimate={climateAutoOpenAreaId === selectedRoom.area_id}
                onAutoOpenClimateHandled={() => setClimateAutoOpenAreaId(null)}
                onOpenCoffee={() => openCoffeeStage(true)}
              />
            </Suspense>
          </>
        )}

        {energyOpen && (
          <Suspense fallback={<div className='energy-page-loading' />}>
            <EnergyPage onClose={handleCloseEnergy} />
          </Suspense>
        )}

        {mapOpen && (
          <Suspense fallback={<div className='energy-page-loading' />}>
            <SensorMapPage onClose={handleCloseMap} />
          </Suspense>
        )}

        {heatingOpen && (
          <Suspense fallback={<div className='energy-page-loading' />}>
            <HeatingPage onClose={handleCloseHeating} />
          </Suspense>
        )}

        {coffeeOpen && (
          <LazyBoundary
            fallback={<div className='energy-page-loading' />}
            error={
              <div className='now-loading now-load-error' role='alert'>
                <button type='button' className='now-load-back' onClick={handleCloseCoffee} aria-label='Back to the Kitchen'>
                  <Icon icon='mdi:chevron-left' />
                </button>
                <span>Could not load the coffee screen</span>
              </div>
            }
          >
            <CoffeeStage onClose={handleCloseCoffee} />
          </LazyBoundary>
        )}

        {nowRoute && (
          <LazyBoundary
            fallback={<div className='now-loading' />}
            error={
              <div className='now-loading now-load-error' role='alert'>
                <button type='button' className='now-load-back' onClick={closeNow} aria-label='Back to rooms'>
                  <Icon icon='mdi:chevron-left' />
                </button>
                <span>Could not load the timeline</span>
              </div>
            }
          >
            <NowView
              key={routeKey(nowRoute)}
              focus={nowRoute.focus}
              itemId={nowRoute.itemId}
              arrival={nowRoute.arrival}
              linkArrived={nowRoute.linkArrived}
              onBack={closeNow}
              onOpenRoom={openRoomFromNow}
            />
          </LazyBoundary>
        )}
      </div>
    </div>
  );
}
