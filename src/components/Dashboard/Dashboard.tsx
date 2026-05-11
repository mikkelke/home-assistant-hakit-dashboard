import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useHass } from '@hakit/core';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { EXCLUDED_AREAS } from '../../config/dashboard';
import type { Area, HassEntities } from '../../types';
import { buildHistoryUrlWithHash, getAccessibleHistoryWindow, getRoomIdFromHistoryHash } from '../../utils/navigation';
import { StatusBar } from '../StatusBar';
import { HomePulse } from '../HomePulse';
import { QuickAccess } from '../QuickAccess/QuickAccess';
import { RoomGrid } from '../RoomGrid';
import { RoomDetail } from '../RoomDetail';
import { Menu } from '../Menu';
import './Dashboard.css';

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

export function Dashboard() {
  const areas = useHass(state => state.areas);
  const entities = useHass(state => state.entities);
  const hassUrl = useHass(state => state.hassUrl);
  const callService = useHass(state => state.helpers?.callService);

  const [selectedRoom, setSelectedRoom] = useState<Area | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const isMobile = useIsMobile();
  // Flag to prevent hash change handler from running during programmatic updates
  const isUpdatingHashRef = useRef(false);
  const hashUpdateTimeoutRef = useRef<number | null>(null);
  // Ref to track current selected room without causing dependency issues
  const selectedRoomRef = useRef<Area | null>(null);

  // Filter out excluded areas
  const areaList = Object.values(areas || {}).filter(area => !EXCLUDED_AREAS.includes(area.name.toLowerCase())) as Area[];

  // Optional: ?washer_demo=... / ?dishwasher_demo=... / ?dryer_demo=... to preview appliance cards (merge mock entities)
  const washerDemo = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('washer_demo') : null;
  const dishwasherDemo = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('dishwasher_demo') : null;
  const dryerDemo = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('dryer_demo') : null;
  const displayEntities = useMemo(() => {
    const base = entities || {};
    const washerMock = getWasherDemoEntities(washerDemo);
    const dishwasherMock = getDishwasherDemoEntities(dishwasherDemo);
    const dryerMock = getDryerDemoEntities(dryerDemo);
    if (Object.keys(washerMock).length === 0 && Object.keys(dishwasherMock).length === 0 && Object.keys(dryerMock).length === 0)
      return base;
    return { ...base, ...washerMock, ...dishwasherMock, ...dryerMock };
  }, [entities, washerDemo, dishwasherDemo, dryerDemo]);

  // Keep ref in sync with state (safety measure)
  useEffect(() => {
    selectedRoomRef.current = selectedRoom;
  }, [selectedRoom]);

  useEffect(() => {
    return () => {
      if (hashUpdateTimeoutRef.current !== null) {
        window.clearTimeout(hashUpdateTimeoutRef.current);
      }
    };
  }, []);

  const markHashUpdating = useCallback(() => {
    if (typeof window === 'undefined') return;
    isUpdatingHashRef.current = true;
    if (hashUpdateTimeoutRef.current !== null) {
      window.clearTimeout(hashUpdateTimeoutRef.current);
    }
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
    (roomId: string | null) => {
      const targetWindow = getAccessibleHistoryWindow();
      if (!targetWindow) return;

      try {
        markHashUpdating();
        targetWindow.history.replaceState({ room: roomId }, '', buildHistoryUrlWithHash(targetWindow, roomId ? `#room=${roomId}` : null));
      } catch (err) {
        console.debug('Failed to replace room history:', err);
        isUpdatingHashRef.current = false;
      }
    },
    [markHashUpdating]
  );

  const pushRoomHistory = useCallback(
    (roomId: string) => {
      const targetWindow = getAccessibleHistoryWindow();
      if (!targetWindow) return;

      try {
        markHashUpdating();
        targetWindow.history.pushState({ room: roomId }, '', buildHistoryUrlWithHash(targetWindow, `#room=${roomId}`));
      } catch (err) {
        console.debug('Failed to push room history:', err);
        isUpdatingHashRef.current = false;
      }
    },
    [markHashUpdating]
  );

  // Sync state from URL hash (single source of truth)
  const syncStateFromHash = useCallback(() => {
    if (areaList.length === 0) return;
    if (isUpdatingHashRef.current) return; // Skip if we're updating hash programmatically

    const roomIdFromHash = getRoomIdFromHistoryHash();

    if (!roomIdFromHash) {
      // No hash - close room if open
      if (selectedRoomRef.current) {
        setSelectedRoom(null);
      }
      return;
    }

    // Find room from hash
    const room = findRoomById(roomIdFromHash);

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
  }, [areaList, findRoomById]);

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

    let lastHash = targetWindow.location.hash;

    const checkHash = () => {
      if (isUpdatingHashRef.current) return; // Skip if we're updating

      const currentHash = targetWindow.location.hash;
      if (currentHash !== lastHash) {
        lastHash = currentHash;
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
    setSelectedRoom(null);
    replaceRoomHistory(null);
  };

  return (
    <div className={`dashboard ${selectedRoom ? 'has-detail' : ''}`}>
      <Menu isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} entities={displayEntities} callService={callService} />
      <div className='dashboard-main'>
        <div className='dashboard-content'>
          <StatusBar entities={displayEntities} hassUrl={hassUrl} onMenuToggle={() => setIsMenuOpen(!isMenuOpen)} />
          <HomePulse areas={areaList} entities={displayEntities} hassUrl={hassUrl} onRoomSelect={handlePulseRoomSelect} />
          <RoomGrid
            areas={areaList}
            entities={displayEntities}
            selectedAreaId={selectedRoom?.area_id || null}
            onRoomClick={handleRoomClick}
            hassUrl={hassUrl}
          />
          <QuickAccess entities={displayEntities} hassUrl={hassUrl} callService={callService} />
        </div>

        {selectedRoom && (
          <>
            {isMobile && <div className='overlay' onClick={handleCloseRoom} />}
            <RoomDetail
              key={selectedRoom.area_id}
              area={selectedRoom}
              entities={displayEntities}
              hassUrl={hassUrl}
              callService={callService}
              onClose={handleCloseRoom}
              isMobile={isMobile}
            />
          </>
        )}
      </div>
    </div>
  );
}
