import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useHass } from '@hakit/core';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { EXCLUDED_AREAS } from '../../config/dashboard';
import type { Area, HassEntities } from '../../types';
import { StatusBar } from '../StatusBar';
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
  switch (mode.toLowerCase()) {
    case 'running':
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
      base['sensor.dishwasher_state'] = sensorState('Unemptied', {
        programme_label: 'ECO',
        detected_programme: 'eco',
        run_time_minutes: 178,
        energy_used: 0.85,
      });
      break;
    case 'paused':
      base['sensor.dishwasher_state'] = sensorState('Paused', { programme_label: 'ECO' });
      break;
    case 'emptied':
      base['sensor.dishwasher_state'] = sensorState('Emptied', { programme_label: 'ECO' });
      break;
    case 'off':
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
    'Bomuld',
    'Bomuld Skabstørt',
    'Bomuld Skabstørt inkl. Skåne +',
    'Bomuld Strygetørt',
    'Strygelet Skabstørt',
    'Finvask Skabstørt',
    'Finish uld',
    'Skjorter Skabstørt',
    'Ekspres Skabstørt',
    'Denim Skabstørt',
    'Imprægnering Skabstørt',
    'Unknown',
  ];
  const base: HassEntities = {
    'input_select.dryer_confirmed_programme': {
      entity_id: 'input_select.dryer_confirmed_programme',
      state: 'Ekspres Skabstørt',
      attributes: { options: programmeOptions },
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

  // Helper to get room from URL hash (check both current window and parent if in iframe)
  const getRoomFromHash = (): string | null => {
    if (typeof window === 'undefined') return null;

    // Try current window first
    let hash = window.location.hash;
    if (hash.startsWith('#room=')) {
      return hash.slice(6); // Remove '#room='
    }

    // If in iframe, try parent window (for dashboard-rooftop scenarios)
    try {
      if (window.parent !== window && window.parent.location.hash) {
        hash = window.parent.location.hash;
        if (hash.startsWith('#room=')) {
          return hash.slice(6);
        }
      }
    } catch {
      // Cross-origin restriction - can't access parent
      // This is expected in some Home Assistant dashboard contexts
    }

    return null;
  };

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

  // Helper to update URL hash
  const updateHash = useCallback((roomId: string | null) => {
    if (typeof window === 'undefined') return;

    try {
      isUpdatingHashRef.current = true;

      // Try to update current window
      try {
        if (roomId) {
          const newUrl = window.location.pathname + window.location.search + `#room=${roomId}`;
          window.history.replaceState(null, '', newUrl);
        } else {
          // Remove hash when closing
          if (window.location.hash.startsWith('#room=')) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
          }
        }
      } catch {
        // If that fails, try parent window (for iframe contexts)
        try {
          if (window.parent !== window) {
            if (roomId) {
              const newUrl = window.parent.location.pathname + window.parent.location.search + `#room=${roomId}`;
              window.parent.history.replaceState(null, '', newUrl);
            } else {
              if (window.parent.location.hash.startsWith('#room=')) {
                window.parent.history.replaceState(null, '', window.parent.location.pathname + window.parent.location.search);
              }
            }
          }
        } catch (e2) {
          // Can't update parent (cross-origin)
          console.debug('Cannot update hash in parent window:', e2);
        }
      }

      // Reset flag after a short delay
      setTimeout(() => {
        isUpdatingHashRef.current = false;
      }, 100);
    } catch (err) {
      console.debug('Failed to update hash:', err);
      isUpdatingHashRef.current = false;
    }
  }, []);

  // Sync state from URL hash (single source of truth)
  const syncStateFromHash = useCallback(() => {
    if (areaList.length === 0) return;
    if (isUpdatingHashRef.current) return; // Skip if we're updating hash programmatically

    const roomIdFromHash = getRoomFromHash();

    if (!roomIdFromHash) {
      // No hash - close room if open
      if (selectedRoomRef.current) {
        setSelectedRoom(null);
      }
      return;
    }

    // Find room from hash
    const room = findRoomById(roomIdFromHash);

    if (room) {
      // Only update if different (avoid unnecessary re-renders)
      if (selectedRoomRef.current?.area_id !== room.area_id) {
        setSelectedRoom(room);
      }
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
    const handleHashChange = () => {
      // Small delay to ensure hash is updated
      setTimeout(() => {
        syncStateFromHash();
      }, 50);
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [syncStateFromHash]);

  // Poll hash periodically for iframe contexts where hashchange might not fire
  // This is necessary for dashboard-rooftop scenarios
  useEffect(() => {
    let lastHash = window.location.hash;

    const checkHash = () => {
      if (isUpdatingHashRef.current) return; // Skip if we're updating

      const currentHash = window.location.hash;
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
    const handlePopState = (event: PopStateEvent) => {
      // First, dispatch a custom event to let modals handle back button
      const modalBackEvent = new CustomEvent('modalBackButton', { cancelable: true });
      const wasHandled = !window.dispatchEvent(modalBackEvent);

      // If a modal handled the back button, stop propagation and don't close the room
      if (wasHandled) {
        event.stopImmediatePropagation();
        return;
      }

      // Otherwise, close the room if one is open
      if (selectedRoomRef.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSelectedRoom(null);
        // Update hash to reflect room closure
        updateHash(null);
        // Replace current state so back button works correctly
        try {
          window.history.replaceState({ room: null }, '', window.location.pathname);
        } catch {
          // Silently fail if history API is not supported
        }
      }
    };

    window.addEventListener('popstate', handlePopState, { capture: true });
    return () => window.removeEventListener('popstate', handlePopState, { capture: true });
  }, [selectedRoom, updateHash]);

  const handleRoomClick = (area: Area) => {
    const isOpening = selectedRoomRef.current?.area_id !== area.area_id;
    const newRoom = isOpening ? area : null;

    // Update state immediately (optimistic update)
    setSelectedRoom(newRoom);

    // Update URL hash to reflect the change
    updateHash(newRoom ? area.area_id : null);

    // Push state when opening a room (so back button closes it)
    if (newRoom) {
      try {
        window.history.pushState({ room: newRoom.area_id }, '', window.location.href);
      } catch {
        // Silently fail if history API is not supported
      }
    }
  };

  const handleCloseRoom = () => {
    setSelectedRoom(null);
    // Update URL hash to remove room
    updateHash(null);
    // Replace state when closing (so back button works)
    try {
      window.history.replaceState({ room: null }, '', window.location.pathname);
    } catch {
      // Silently fail if history API is not supported
      console.debug('History API not fully supported in this environment');
    }
  };

  return (
    <div className={`dashboard ${selectedRoom ? 'has-detail' : ''}`}>
      <Menu isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} entities={displayEntities} callService={callService} />
      <div className='dashboard-main'>
        <div className='dashboard-content'>
          <StatusBar
            entities={displayEntities}
            hassUrl={hassUrl}
            callService={callService}
            onMenuToggle={() => setIsMenuOpen(!isMenuOpen)}
          />
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
