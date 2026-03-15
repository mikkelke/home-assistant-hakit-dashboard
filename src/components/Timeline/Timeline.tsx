import { useState, useEffect } from 'react';
import { useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import type { HassEntity } from '../../types';
import './Timeline.css';

interface TimelineEvent {
  entity_id: string;
  state: string;
  last_changed: string;
  last_updated: string;
  transitionType?: 'started' | 'ended' | 'completed'; // For power devices or cleaning: indicates transition type
  eventType?: 'primary' | 'secondary'; // Track which entity this event came from
  operatorInfo?: string; // Who operated the lock (for Yale lock/door entities)
}

interface TimelineProps {
  entityId: string;
  entity: HassEntity;
  hassUrl: string | null;
  hours?: number;
  limit?: number;
  secondaryEntityId?: string; // Optional secondary entity for combined timeline
}

interface ConnectionWithAuth {
  options?: { auth?: { accessToken?: string }; accessToken?: string };
  auth?: { accessToken?: string };
}

export function Timeline({ entityId, entity: _entity, hassUrl, hours = 168, limit = 100, secondaryEntityId }: TimelineProps) {
  void _entity; // required by props, used for type; component uses entityId
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get connection from @hakit/core for authenticated API calls (Store has connection: Connection | null)
  const connection = useHass((state: unknown) => (state as { connection?: ConnectionWithAuth | null }).connection ?? undefined);

  // Extract access token from the authenticated connection
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
    if (!hassUrl) {
      setLoading(false);
      setError('Home Assistant URL not configured');
      return;
    }

    // Helper function to fetch history for a single entity
    const fetchEntityHistory = async (targetEntityId: string, eventType: 'primary' | 'secondary'): Promise<TimelineEvent[]> => {
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
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

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

      // Extract entity history from nested format
      type HistoryItem = { entity_id?: string; state?: string; last_changed?: string; last_updated?: string };
      let entityHistory: HistoryItem[] = [];
      if (data && Array.isArray(data) && data.length > 0) {
        if (Array.isArray(data[0])) {
          entityHistory = data[0] as HistoryItem[];
        } else {
          entityHistory = data as HistoryItem[];
        }
      }

      // Convert to TimelineEvent format with eventType marker
      return entityHistory.map((item: HistoryItem) => ({
        entity_id: item.entity_id || targetEntityId,
        state: item.state || 'unknown',
        last_changed: item.last_changed || item.last_updated || new Date().toISOString(),
        last_updated: item.last_updated || item.last_changed || new Date().toISOString(),
        eventType,
        // Mark secondary entity events (completion) with transitionType
        transitionType: eventType === 'secondary' ? ('completed' as const) : undefined,
      }));
    };

    const fetchHistory = async () => {
      try {
        setLoading(true);
        setError(null);

        const accessToken = getAccessToken();
        console.log('Timeline: Fetching with auth:', accessToken ? 'Bearer token present' : 'No token (using cookies)');

        // Fetch primary entity history
        let allEvents = await fetchEntityHistory(entityId, 'primary');
        console.log('Timeline: Fetched', allEvents.length, 'events for primary entity', entityId);

        // Fetch secondary entity history if provided
        if (secondaryEntityId) {
          try {
            const secondaryEvents = await fetchEntityHistory(secondaryEntityId, 'secondary');
            console.log('Timeline: Fetched', secondaryEvents.length, 'events for secondary entity', secondaryEntityId);
            allEvents = [...allEvents, ...secondaryEvents];
          } catch (err) {
            console.warn('Timeline: Failed to fetch secondary entity history:', err);
            // Continue with primary events only
          }
        }

        // For Yale lock/door, fetch operator info and match by timestamp
        const isYaleLockOrDoor = entityId === 'lock.yale' || entityId.includes('yale_door');
        let operatorEvents: TimelineEvent[] = [];
        if (isYaleLockOrDoor) {
          try {
            operatorEvents = await fetchEntityHistory('sensor.yale_operator', 'secondary');
            console.log('Timeline: Fetched', operatorEvents.length, 'operator events for Yale');
          } catch (err) {
            console.warn('Timeline: Failed to fetch Yale operator history:', err);
          }
        }

        // Match operator info to primary events by timestamp (within 30 seconds)
        if (operatorEvents.length > 0) {
          const MATCH_WINDOW_MS = 30 * 1000; // 30 seconds
          allEvents = allEvents.map(event => {
            if (event.eventType === 'primary') {
              const eventTime = new Date(event.last_changed).getTime();
              // Find closest operator event within the time window
              const matchingOperator = operatorEvents.find(op => {
                const opTime = new Date(op.last_changed).getTime();
                return Math.abs(eventTime - opTime) <= MATCH_WINDOW_MS;
              });
              if (matchingOperator) {
                return { ...event, operatorInfo: matchingOperator.state };
              }
            }
            return event;
          });
        }

        if (allEvents.length === 0) {
          console.warn('Timeline: No events found');
          setEvents([]);
          setLoading(false);
          return;
        }

        // Filter out "unknown" and "unavailable" states
        const entityDomain = entityId.split('.')[0];
        const isSensor = entityDomain === 'sensor';
        const isHotplate = entityId.includes('hotplate');
        const isOven = entityId.includes('oven');
        const isMicrowave = entityId.includes('microwave');
        const isPowerDevice = isHotplate || isOven || isMicrowave;

        // Normalize power device states
        const normalizedEvents = allEvents.map(event => {
          if (isSensor && isPowerDevice && event.eventType === 'primary') {
            const powerValue = parseFloat(event.state);
            if (!isNaN(powerValue)) {
              return { ...event, state: powerValue >= 200 ? 'Running' : 'Not running' };
            }
          }
          return event;
        });

        // Check if this is a cleaning request with completion tracking
        const isCleaningWithCompletion = entityId.includes('rober2_clean') && secondaryEntityId;

        // Filter out unwanted states (only for primary events)
        // During HA/MQTT/Zigbee2MQTT restarts, entities go to "unknown"/"unavailable" temporarily
        // These aren't real state changes and should be filtered out
        const filteredEvents = normalizedEvents.filter(event => {
          // Don't filter secondary events (completion)
          if (event.eventType === 'secondary') return true;

          const stateLower = event.state.toLowerCase();

          // Always filter out "unknown" and "unavailable" states for all entities
          // These typically occur during HA/integration restarts and aren't meaningful
          if (stateLower === 'unknown' || stateLower === 'unavailable') {
            return false;
          }

          // For cleaning requests with completion tracking:
          // Only show "on" (Requested) - filter out "off" (Cleared) since Completed replaces it
          if (isCleaningWithCompletion && stateLower === 'off') {
            return false;
          }

          return true;
        });

        // Consolidate consecutive duplicate states (only for same entity type)
        // Don't consolidate primary events for cleaning with completion - we filtered out "off"
        // so all remaining "on" events would be consolidated, but each is a unique request
        // Door/window/presence/appliances: only show state changes, not repeated same state
        const shouldConsolidate =
          (isSensor && isPowerDevice) ||
          isMediaPlayer ||
          isVacuum ||
          isLight ||
          (isInputBoolean && !isCleaningWithCompletion) ||
          isDoorSensor ||
          isWindowSensor ||
          isPresenceSensor ||
          isAppliance;
        let consolidatedEvents = filteredEvents;

        if (shouldConsolidate || isCleaningWithCompletion) {
          // Separate primary and secondary events
          const primaryEvents = filteredEvents.filter(e => e.eventType === 'primary');
          const secondaryEvents = filteredEvents.filter(e => e.eventType === 'secondary');

          // Consolidate primary events (but not for cleaning with completion tracking)
          let consolidatedPrimary: TimelineEvent[] = primaryEvents;
          if (shouldConsolidate) {
            consolidatedPrimary = [];
            let lastState: string | null = null;
            for (const event of primaryEvents) {
              if (event.state !== lastState) {
                const transitionType: 'started' | 'ended' | undefined =
                  isSensor && isPowerDevice
                    ? event.state === 'Running'
                      ? 'started'
                      : event.state === 'Not running' && lastState === 'Running'
                        ? 'ended'
                        : undefined
                    : undefined;
                consolidatedPrimary.push({ ...event, transitionType });
                lastState = event.state;
              }
            }
          }

          // Consolidate secondary events (input_text.last_clean stores timestamps as state)
          // Group events that happen within 5 minutes of each other - they're the same cleaning
          const consolidatedSecondary: TimelineEvent[] = [];
          let lastSecondaryTime: number | null = null;
          const FIVE_MINUTES_MS = 5 * 60 * 1000;
          for (const event of secondaryEvents) {
            const eventTime = new Date(event.last_changed).getTime();
            // Only add if it's more than 5 minutes from the last secondary event
            if (lastSecondaryTime === null || Math.abs(eventTime - lastSecondaryTime) > FIVE_MINUTES_MS) {
              consolidatedSecondary.push(event);
              lastSecondaryTime = eventTime;
            }
          }

          consolidatedEvents = [...consolidatedPrimary, ...consolidatedSecondary];
        }

        // Sort all events by timestamp (newest first)
        // When timestamps are equal, put Completed (secondary) before Requested (primary)
        // because Completed happens after Request in real time
        consolidatedEvents.sort((a, b) => {
          const timeA = new Date(a.last_changed).getTime();
          const timeB = new Date(b.last_changed).getTime();
          if (timeA === timeB) {
            // Same timestamp: secondary (completed) should appear before primary (requested)
            // in newest-first order, since completion happens after request
            if (a.eventType === 'secondary' && b.eventType === 'primary') return -1;
            if (a.eventType === 'primary' && b.eventType === 'secondary') return 1;
          }
          return timeB - timeA; // Descending order (newest first)
        });

        // Limit the results
        const limitedEvents = consolidatedEvents.slice(0, limit);
        console.log('Timeline: Processed', consolidatedEvents.length, 'events, showing', limitedEvents.length);
        setEvents(limitedEvents);
      } catch (err) {
        console.error('Failed to fetch timeline history:', err);
        console.error('Entity ID:', entityId);
        console.error('Hass URL:', hassUrl);
        const errorMessage = err instanceof Error ? err.message : 'Failed to load timeline';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getAccessToken and entity-type helpers are stable; adding them would trigger unnecessary refetches
  }, [entityId, secondaryEntityId, hassUrl, hours, limit, connection]);

  const formatTimeAgo = (timestamp: string): string => {
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

    // For older events, show date and time
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
  };

  const formatAbsoluteTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Determine entity domain and type
  const entityDomain = entityId.split('.')[0];
  const isPerson = entityDomain === 'person';
  const isBinarySensor = entityDomain === 'binary_sensor';
  const isSensor = entityDomain === 'sensor';
  const isLock = entityDomain === 'lock';
  const isLight = entityDomain === 'light';
  const isMediaPlayer = entityDomain === 'media_player';
  const isInputBoolean = entityDomain === 'input_boolean';
  const isVacuum = entityDomain === 'vacuum';

  // Weather sensor detection (before door/window to avoid "outdoor" matching "door")
  const isWeatherSensor = entityId.includes('gw2000a') || entityId.includes('weather');
  const isTemperatureSensor = entityId.includes('temperature') || entityId.includes('temp');
  const isHumiditySensor = entityId.includes('humidity');
  const isWindSensor = entityId.includes('wind');
  const isRainSensor = entityId.includes('rain');
  const isPressureSensor = entityId.includes('pressure');
  const isUvSensor = entityId.includes('uv_index') || entityId.includes('uv');
  const isLuxSensor = entityId.includes('lux') || entityId.includes('solar');
  const isDewpointSensor = entityId.includes('dewpoint');
  const isNumericWeatherSensor =
    isWeatherSensor &&
    (isTemperatureSensor ||
      isHumiditySensor ||
      isWindSensor ||
      isRainSensor ||
      isPressureSensor ||
      isUvSensor ||
      isLuxSensor ||
      isDewpointSensor);

  // Door/window detection - exclude "outdoor" from matching "door"
  const isDoorSensor =
    entityId.includes('_door') || entityId.endsWith('door') || (entityId.includes('door') && !entityId.includes('outdoor'));
  const isWindowSensor = entityId.includes('window');
  const isPresenceSensor = entityId.includes('presence') || entityId.includes('occupancy');
  const isDishwasher = entityId.includes('dishwasher');
  const isWasher = entityId.includes('washer') && !entityId.includes('dishwasher');
  const isDryer = entityId.includes('dryer');
  const isHotplate = entityId.includes('hotplate');
  const isOven = entityId.includes('oven');
  const isMicrowave = entityId.includes('microwave');
  const isAppliance = isDishwasher || isWasher || isDryer;
  const isPowerDevice = isHotplate || isOven || isMicrowave;
  const isCleaningRequest = isInputBoolean && entityId.includes('rober2_clean');

  const getStateLabel = (state: string): string => {
    const stateLower = state.toLowerCase();

    // Person entity
    if (isPerson) {
      const personMap: Record<string, string> = {
        home: 'Home',
        not_home: 'Away',
        away: 'Away',
        unknown: 'Unknown',
      };
      return personMap[stateLower] || state;
    }

    // Lock entity
    if (isLock) {
      const lockMap: Record<string, string> = {
        locked: 'Locked',
        unlocked: 'Unlocked',
        locking: 'Locking',
        unlocking: 'Unlocking',
        jammed: 'Jammed',
        unknown: 'Unknown',
      };
      return lockMap[stateLower] || state.charAt(0).toUpperCase() + state.slice(1);
    }

    // Light entity
    if (isLight) {
      const lightMap: Record<string, string> = {
        on: 'On',
        off: 'Off',
        unavailable: 'Unavailable',
        unknown: 'Unknown',
      };
      return lightMap[stateLower] || state.charAt(0).toUpperCase() + state.slice(1);
    }

    // Media player entity
    if (isMediaPlayer) {
      const mediaMap: Record<string, string> = {
        playing: 'Playing',
        paused: 'Paused',
        idle: 'Idle',
        off: 'Off',
        standby: 'Standby',
        unavailable: 'Unavailable',
        unknown: 'Unknown',
      };
      return mediaMap[stateLower] || state.charAt(0).toUpperCase() + state.slice(1);
    }

    // Binary sensor (on/off)
    if (isBinarySensor) {
      if (isDoorSensor || isWindowSensor) {
        return stateLower === 'on' ? 'Open' : stateLower === 'off' ? 'Closed' : state;
      }
      if (isPresenceSensor) {
        return stateLower === 'on' ? 'Detected' : stateLower === 'off' ? 'Clear' : state;
      }
      // Generic binary sensor
      return stateLower === 'on' ? 'On' : stateLower === 'off' ? 'Off' : state;
    }

    // Vacuum entity
    if (isVacuum) {
      const vacuumMap: Record<string, string> = {
        cleaning: 'Cleaning',
        returning: 'Returning',
        docked: 'Docked',
        paused: 'Paused',
        idle: 'Idle',
        error: 'Error',
        unavailable: 'Unavailable',
        unknown: 'Unknown',
      };
      return vacuumMap[stateLower] || state.charAt(0).toUpperCase() + state.slice(1);
    }

    // Input boolean (alarm, cleaning requests, switches, etc.)
    if (isInputBoolean) {
      if (isCleaningRequest) {
        return stateLower === 'on' ? 'Cleaning Requested' : stateLower === 'off' ? 'Request Cleared' : state;
      }
      if (entityId.includes('wakeup') || entityId.includes('alarm')) {
        return stateLower === 'on' ? 'Enabled' : stateLower === 'off' ? 'Disabled' : state;
      }
      return stateLower === 'on' ? 'On' : stateLower === 'off' ? 'Off' : state;
    }

    // Sensor entities (appliances, power devices)
    if (isSensor) {
      // For power sensors (microwave, oven, hotplate), show "Running" or "Not running"
      // These devices use 800-3000W when cooking, so threshold is 200W to filter standby/noise
      if (isPowerDevice) {
        const powerValue = parseFloat(state);
        if (!isNaN(powerValue)) {
          return powerValue >= 200 ? 'Running' : 'Not running';
        }
      }
      // For appliance state sensors, show the state as-is (capitalized)
      if (isAppliance) {
        return state.charAt(0).toUpperCase() + state.slice(1);
      }
      // For weather/numeric sensors, show value with appropriate unit
      if (isNumericWeatherSensor) {
        const numValue = parseFloat(state);
        if (!isNaN(numValue)) {
          if (isTemperatureSensor || isDewpointSensor) return `${numValue.toFixed(1)}°C`;
          if (isHumiditySensor) return `${numValue.toFixed(0)}%`;
          if (isWindSensor) {
            // Convert km/h to m/s if needed (assuming km/h input)
            const ms = numValue / 3.6;
            return `${ms.toFixed(1)} m/s`;
          }
          if (isRainSensor) {
            if (entityId.includes('rate')) return `${numValue.toFixed(1)} mm/h`;
            return `${numValue.toFixed(1)} mm`;
          }
          if (isPressureSensor) return `${numValue.toFixed(0)} hPa`;
          if (isUvSensor) return `UV ${numValue.toFixed(1)}`;
          if (isLuxSensor) {
            if (entityId.includes('radiation') || entityId.includes('irradiance')) return `${numValue.toFixed(0)} W/m²`;
            return `${numValue.toFixed(0)} lx`;
          }
          return numValue.toFixed(1);
        }
      }
    }

    // Default: capitalize first letter
    return state.charAt(0).toUpperCase() + state.slice(1);
  };

  const getStateIcon = (state: string): string => {
    const stateLower = state.toLowerCase();

    // Person entity
    if (isPerson) {
      const personIconMap: Record<string, string> = {
        home: 'mdi:home',
        not_home: 'mdi:account-arrow-right',
        away: 'mdi:account-arrow-right',
        unknown: 'mdi:help-circle',
      };
      return personIconMap[stateLower] || 'mdi:circle';
    }

    // Lock entity
    if (isLock) {
      const lockIconMap: Record<string, string> = {
        locked: 'mdi:lock',
        unlocked: 'mdi:lock-open',
        locking: 'mdi:lock-clock',
        unlocking: 'mdi:lock-open-variant',
        jammed: 'mdi:lock-alert',
        unknown: 'mdi:lock-question',
      };
      return lockIconMap[stateLower] || 'mdi:lock';
    }

    // Light entity
    if (isLight) {
      return stateLower === 'on' ? 'mdi:lightbulb-on' : 'mdi:lightbulb-off';
    }

    // Media player entity
    if (isMediaPlayer) {
      const mediaIconMap: Record<string, string> = {
        playing: 'mdi:play-circle',
        paused: 'mdi:pause-circle',
        idle: 'mdi:music-note',
        off: 'mdi:music-off',
        standby: 'mdi:power-sleep',
        unavailable: 'mdi:music-off',
        unknown: 'mdi:help-circle',
      };
      return mediaIconMap[stateLower] || 'mdi:music';
    }

    // Door sensor
    if (isDoorSensor) {
      return stateLower === 'on' ? 'mdi:door-open' : 'mdi:door-closed';
    }

    // Window sensor
    if (isWindowSensor) {
      return stateLower === 'on' ? 'mdi:window-open' : 'mdi:window-closed';
    }

    // Presence/occupancy sensor
    if (isPresenceSensor) {
      return stateLower === 'on' ? 'mdi:motion-sensor' : 'mdi:motion-sensor-off';
    }

    // Weather sensors
    if (isNumericWeatherSensor) {
      if (isTemperatureSensor) return 'mdi:thermometer';
      if (isDewpointSensor) return 'mdi:weather-fog';
      if (isHumiditySensor) return 'mdi:water-percent';
      if (isWindSensor) {
        if (entityId.includes('gust')) return 'mdi:weather-windy-variant';
        if (entityId.includes('direction')) return 'mdi:compass';
        return 'mdi:weather-windy';
      }
      if (isRainSensor) return 'mdi:weather-rainy';
      if (isPressureSensor) return 'mdi:gauge';
      if (isUvSensor) return 'mdi:weather-sunny-alert';
      if (isLuxSensor) {
        if (entityId.includes('radiation') || entityId.includes('irradiance')) return 'mdi:sun-wireless';
        return 'mdi:weather-sunny';
      }
      return 'mdi:thermometer';
    }

    // Appliance sensors
    if (isDishwasher) return 'mdi:dishwasher';
    if (isWasher) return 'mdi:washing-machine';
    if (isDryer) return 'mdi:tumble-dryer';
    if (isHotplate) return 'mdi:stove';
    if (isOven) return 'mdi:toaster-oven';
    if (isMicrowave) return 'mdi:microwave';

    // Generic binary sensor
    if (isBinarySensor) {
      return stateLower === 'on' ? 'mdi:check-circle' : 'mdi:circle-outline';
    }

    // Vacuum entity
    if (isVacuum) {
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
      return vacuumIconMap[stateLower] || 'mdi:robot-vacuum';
    }

    // Input boolean (alarm, cleaning requests)
    if (isInputBoolean) {
      if (isCleaningRequest) {
        return stateLower === 'on' ? 'mdi:robot-vacuum' : 'mdi:robot-vacuum-off';
      }
      if (entityId.includes('wakeup') || entityId.includes('alarm')) {
        return stateLower === 'on' ? 'mdi:alarm' : 'mdi:alarm-off';
      }
      return stateLower === 'on' ? 'mdi:toggle-switch' : 'mdi:toggle-switch-off';
    }

    return 'mdi:circle';
  };

  const getStateColor = (state: string): string => {
    const stateLower = state.toLowerCase();

    // Person entity
    if (isPerson) {
      const personColorMap: Record<string, string> = {
        home: '#22c55e',
        not_home: '#71717a',
        away: '#71717a',
        unknown: '#a1a1aa',
      };
      return personColorMap[stateLower] || '#a1a1aa';
    }

    // Lock entity - unlocked is orange (warning), locked is green
    if (isLock) {
      const lockColorMap: Record<string, string> = {
        locked: '#22c55e', // Green for locked (secure)
        unlocked: '#f97316', // Orange for unlocked (warning)
        locking: '#3b82f6', // Blue for in progress
        unlocking: '#3b82f6', // Blue for in progress
        jammed: '#ef4444', // Red for error
        unknown: '#a1a1aa', // Gray for unknown
      };
      return lockColorMap[stateLower] || '#a1a1aa';
    }

    // Light entity - on is yellow, off is gray
    if (isLight) {
      return stateLower === 'on' ? '#fbbf24' : '#71717a'; // Yellow for on, gray for off
    }

    // Media player entity - playing is blue, paused is yellow, off/idle is gray
    if (isMediaPlayer) {
      const mediaColorMap: Record<string, string> = {
        playing: '#3b82f6', // Blue for playing
        paused: '#fbbf24', // Yellow for paused
        idle: '#71717a', // Gray for idle
        off: '#71717a', // Gray for off
        standby: '#a1a1aa', // Light gray for standby
        unavailable: '#a1a1aa', // Light gray for unavailable
        unknown: '#a1a1aa', // Light gray for unknown
      };
      return mediaColorMap[stateLower] || '#71717a';
    }

    // Door/window sensors - open is yellow (warning), closed is green
    if (isDoorSensor || isWindowSensor) {
      return stateLower === 'on' ? '#fbbf24' : '#22c55e';
    }

    // Presence sensor - detected is blue, clear is gray
    if (isPresenceSensor) {
      return stateLower === 'on' ? '#3b82f6' : '#71717a';
    }

    // Appliance sensors - color based on state
    if (isAppliance) {
      // Ready states (needs attention) - amber
      const readyKeywords = ['complete', 'finished', 'done', 'ready', 'end', 'completed', 'end of cycle', 'unemptied'];
      if (readyKeywords.some(keyword => stateLower.includes(keyword))) {
        return '#f59e0b'; // Amber for ready
      }
      // Running states - green
      const offStates = ['off', 'idle', 'standby'];
      if (offStates.includes(stateLower)) {
        return '#71717a'; // Gray for off/idle
      }
      // Running - green
      return '#22c55e'; // Green for running
    }

    // Power devices - color based on power level (threshold: 200W for running state)
    if (isPowerDevice) {
      const powerValue = parseFloat(state);
      if (!isNaN(powerValue) && powerValue >= 200) {
        return '#ea580c'; // Orange for running
      }
      return '#71717a'; // Gray for not running
    }

    // Weather sensors - contextual colors based on values
    if (isNumericWeatherSensor) {
      const numValue = parseFloat(state);
      if (!isNaN(numValue)) {
        if (isTemperatureSensor || isDewpointSensor) {
          // Temperature colors: freezing → cold → mild → warm → hot
          if (numValue <= 0) return '#3b82f6'; // Blue for freezing
          if (numValue <= 10) return '#06b6d4'; // Cyan for cold
          if (numValue <= 20) return '#22c55e'; // Green for mild
          if (numValue <= 28) return '#f59e0b'; // Amber for warm
          return '#ef4444'; // Red for hot
        }
        if (isHumiditySensor) {
          // Humidity: low is amber, normal is green, high is blue
          if (numValue < 30) return '#f59e0b'; // Amber for dry
          if (numValue <= 60) return '#22c55e'; // Green for comfortable
          return '#3b82f6'; // Blue for humid
        }
        if (isWindSensor) {
          // Wind speed (km/h): calm → breezy → windy → strong
          const ms = numValue / 3.6;
          if (ms < 3) return '#71717a'; // Gray for calm
          if (ms < 8) return '#22c55e'; // Green for light
          if (ms < 14) return '#f59e0b'; // Amber for moderate
          return '#ef4444'; // Red for strong
        }
        if (isRainSensor) {
          // Rain: more = darker blue
          if (numValue === 0) return '#71717a'; // Gray for no rain
          if (numValue < 2) return '#60a5fa'; // Light blue for light
          if (numValue < 10) return '#3b82f6'; // Blue for moderate
          return '#1d4ed8'; // Dark blue for heavy
        }
        if (isPressureSensor) {
          return '#8b5cf6'; // Purple for pressure
        }
        if (isUvSensor) {
          // UV index: safe → moderate → high → extreme
          if (numValue < 3) return '#22c55e'; // Green for low
          if (numValue < 6) return '#f59e0b'; // Amber for moderate
          if (numValue < 8) return '#f97316'; // Orange for high
          return '#ef4444'; // Red for very high
        }
        if (isLuxSensor) {
          return '#fbbf24'; // Yellow for light/sun
        }
      }
      return '#60a5fa'; // Default blue for weather
    }

    // Generic binary sensor
    if (isBinarySensor) {
      return stateLower === 'on' ? '#22c55e' : '#71717a';
    }

    // Vacuum entity
    if (isVacuum) {
      const vacuumColorMap: Record<string, string> = {
        cleaning: '#22c55e', // Green for cleaning
        returning: '#3b82f6', // Blue for returning
        docked: '#71717a', // Gray for docked
        paused: '#fbbf24', // Yellow for paused
        idle: '#a1a1aa', // Light gray for idle
        error: '#ef4444', // Red for error
        unavailable: '#a1a1aa', // Light gray for unavailable
        unknown: '#a1a1aa', // Light gray for unknown
      };
      return vacuumColorMap[stateLower] || '#71717a';
    }

    // Input boolean (alarm, cleaning requests)
    if (isInputBoolean) {
      if (isCleaningRequest) {
        return stateLower === 'on' ? '#22c55e' : '#71717a'; // Green for requested, gray for cleared
      }
      if (entityId.includes('wakeup') || entityId.includes('alarm')) {
        return stateLower === 'on' ? '#fbbf24' : '#71717a'; // Yellow for enabled, gray for disabled
      }
      return stateLower === 'on' ? '#22c55e' : '#71717a';
    }

    return '#a1a1aa';
  };

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

  if (events.length === 0) {
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
        {events.map((event, index) => {
          // For power devices with transition types, show "started" or "ended" labels
          let stateLabel = getStateLabel(event.state);
          let stateColor = getStateColor(event.state);
          let stateIcon = getStateIcon(event.state);

          if (event.transitionType && (isHotplate || isOven || isMicrowave)) {
            const deviceName = isHotplate ? 'Hotplate' : isOven ? 'Oven' : 'Microwave';
            stateLabel = event.transitionType === 'started' ? `${deviceName} started` : `${deviceName} ended`;
            // Use different colors for started (green) vs ended (gray) to make it easier to distinguish
            stateColor =
              event.transitionType === 'started'
                ? '#22c55e' // Green for started
                : '#71717a'; // Gray for ended
          }

          // For cleaning completion events (from secondary entity input_text last_clean)
          if (event.transitionType === 'completed' && event.eventType === 'secondary') {
            stateLabel = 'Cleaning Completed';
            stateColor = '#3b82f6'; // Blue for completed
            stateIcon = 'mdi:check-circle';
          }
          const isLast = index === events.length - 1;

          return (
            <div key={`${event.last_changed}-${index}`} className='timeline-event'>
              <div className='timeline-line-container'>
                <div className='timeline-dot' style={{ backgroundColor: stateColor }}>
                  <Icon icon={stateIcon} />
                </div>
                {!isLast && <div className='timeline-line' />}
              </div>
              <div className='timeline-content'>
                <div className='timeline-header'>
                  <span className='timeline-state' style={{ color: stateColor }}>
                    {stateLabel}
                  </span>
                  <span className='timeline-time'>{formatTimeAgo(event.last_changed)}</span>
                </div>
                <div className='timeline-details'>
                  <span className='timeline-absolute-time'>{formatAbsoluteTime(event.last_changed)}</span>
                  {event.operatorInfo && (
                    <span className='timeline-operator'>
                      <Icon icon='mdi:account' />
                      {event.operatorInfo}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
