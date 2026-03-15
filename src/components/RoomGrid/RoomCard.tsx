import { Fragment } from 'react';
import { Icon } from '@iconify/react';
import type { RoomCardProps } from '../../types';
import {
  FRONT_DOOR_LOCK_ENTITY,
  FRONT_DOOR_SENSOR_ENTITY,
  VACUUM_ENTITY,
  ROBOT_CLEAN_PREFIX,
  ROBOT_CLEAN_KITCHEN_1,
  ROBOT_CLEAN_KITCHEN_2,
} from '../../config/entities';
import { ROOM_LIGHTS } from '../../config/lights';
import { IndicatorWithTimeline } from './IndicatorWithTimeline';
import { MultiEntitySelector } from './MultiEntitySelector';
import './RoomGrid.css';

type IndicatorKey =
  | 'door'
  | 'window'
  | 'lock'
  | 'heating'
  | 'shower'
  | 'cleaning'
  | 'cleaning_cook'
  | 'cleaning_dining'
  | 'vacuum'
  | 'guest'
  | 'dishwasher'
  | 'washer'
  | 'dryer'
  | 'hotplate'
  | 'oven'
  | 'microwave'
  | 'media'
  | 'lights'
  | 'presence'
  | 'alarm';

export interface RoomCardWithCountsProps extends RoomCardProps {
  indicatorCounts: Record<IndicatorKey, number>;
}

// Dusty color palette - subtle background, vibrant icon circle
const DUSTY_COLORS = [
  { bg: 'rgba(20, 21, 24, 0.9)', border: 'rgba(139, 116, 101, 0.3)', icon: '#b8947a', text: '#e4e4e7', iconBg: 'rgba(139, 116, 101, 0.5)' }, // Dusty brown
  { bg: 'rgba(20, 21, 24, 0.9)', border: 'rgba(152, 128, 108, 0.3)', icon: '#c89c7a', text: '#e4e4e7', iconBg: 'rgba(152, 128, 108, 0.5)' }, // Muted taupe
  { bg: 'rgba(20, 21, 24, 0.9)', border: 'rgba(123, 136, 120, 0.3)', icon: '#8ba87a', text: '#e4e4e7', iconBg: 'rgba(123, 136, 120, 0.5)' }, // Dusty sage
  { bg: 'rgba(20, 21, 24, 0.9)', border: 'rgba(140, 120, 130, 0.3)', icon: '#b87a9a', text: '#e4e4e7', iconBg: 'rgba(140, 120, 130, 0.5)' }, // Dusty rose
  { bg: 'rgba(20, 21, 24, 0.9)', border: 'rgba(120, 130, 145, 0.3)', icon: '#8a9aa7', text: '#e4e4e7', iconBg: 'rgba(120, 130, 145, 0.5)' }, // Dusty blue-gray
  { bg: 'rgba(20, 21, 24, 0.9)', border: 'rgba(135, 125, 110, 0.3)', icon: '#a78a7a', text: '#e4e4e7', iconBg: 'rgba(135, 125, 110, 0.5)' }, // Dusty beige
  { bg: 'rgba(20, 21, 24, 0.9)', border: 'rgba(130, 140, 125, 0.3)', icon: '#9aa87a', text: '#e4e4e7', iconBg: 'rgba(130, 140, 125, 0.5)' }, // Dusty olive
  { bg: 'rgba(20, 21, 24, 0.9)', border: 'rgba(145, 125, 135, 0.3)', icon: '#a77a9a', text: '#e4e4e7', iconBg: 'rgba(145, 125, 135, 0.5)' }, // Dusty mauve
  { bg: 'rgba(20, 21, 24, 0.9)', border: 'rgba(125, 135, 150, 0.3)', icon: '#8a9aa7', text: '#e4e4e7', iconBg: 'rgba(125, 135, 150, 0.5)' }, // Dusty slate
  { bg: 'rgba(20, 21, 24, 0.9)', border: 'rgba(138, 130, 120, 0.3)', icon: '#a78a7a', text: '#e4e4e7', iconBg: 'rgba(138, 130, 120, 0.5)' }, // Dusty tan
  { bg: 'rgba(20, 21, 24, 0.9)', border: 'rgba(132, 140, 130, 0.3)', icon: '#9aa87a', text: '#e4e4e7', iconBg: 'rgba(132, 140, 130, 0.5)' }, // Dusty moss
  { bg: 'rgba(20, 21, 24, 0.9)', border: 'rgba(142, 128, 138, 0.3)', icon: '#a77a9a', text: '#e4e4e7', iconBg: 'rgba(142, 128, 138, 0.5)' }, // Dusty lavender
];

// Get consistent color for a room based on area_id
const getRoomColor = (areaId: string) => {
  // Simple hash function to consistently map area_id to a color
  let hash = 0;
  for (let i = 0; i < areaId.length; i++) {
    hash = areaId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % DUSTY_COLORS.length;
  return DUSTY_COLORS[index];
};

export function RoomCard({ area, entities, onClick, isSelected, hassUrl, indicatorCounts }: RoomCardWithCountsProps) {
  const formatName = (text: string) => text.replace(/\b(\p{L})(\p{L}*)/gu, (_, a, b) => a.toUpperCase() + b.toLowerCase());

  const areaName = area.name.toLowerCase();
  const areaNameNormalized = areaName.replace(/\s+/g, '_');
  const entityKeys = Object.keys(entities || {});
  const roomColor = getRoomColor(area.area_id);

  // Special sensor mappings for rooms with non-standard entity names
  // Use area_id (like dining room) so rooftop doors show regardless of area display name
  const isRooftop = area.area_id === 'rooftop' || areaNameNormalized === 'rooftop';

  // Find temperature sensor for this area
  // Priority: 1) sensor.{area}_temperature 2) climate.{area}_thermostat current_temp 3) generic search (exclude floor)
  const climateSensorId = `climate.${areaNameNormalized}_thermostat`;
  const climateEntity = entities?.[climateSensorId];

  const getTempSensor = (): string | undefined => {
    if (isRooftop) return 'sensor.gw2000a_outdoor_temperature';

    // Try exact sensor.{area}_temperature first
    const exactSensor = `sensor.${areaNameNormalized}_temperature`;
    if (entities?.[exactSensor]) return exactSensor;

    // Try climate entity's current_temperature (return special marker)
    if (climateEntity?.attributes?.current_temperature) return '__climate__';

    // Fallback: search but exclude floor thermometers
    return entityKeys.find(
      key =>
        key.includes('temperature') &&
        !key.includes('floor') &&
        (String(entities[key]?.attributes?.friendly_name ?? '').toLowerCase().includes(areaName) || key.toLowerCase().includes(areaNameNormalized))
    );
  };
  const tempSensor = getTempSensor();

  // Find humidity sensor for this area
  const humiditySensor = isRooftop
    ? 'sensor.gw2000a_humidity'
    : entityKeys.find(
        key =>
          key.includes('humidity') &&
          !key.includes('floor') &&
          (String(entities[key]?.attributes?.friendly_name ?? '').toLowerCase().includes(areaName) || key.toLowerCase().includes(areaNameNormalized))
      );

  // Presence: PIR only
  const presenceSensorId = `binary_sensor.${areaNameNormalized}_pir_presence`;
  const presenceEntity = entities?.[presenceSensorId];
  const isOccupied = presenceEntity?.state === 'on';
  const hasPresence = !!presenceEntity;

  // Climate/heating status - uses climateSensorId defined above
  const hvacAction = climateEntity?.attributes?.hvac_action;
  const isHeating = hvacAction === 'heating';

  // Find if any lights are on in this area using configured mapping; fallback to name matching if no mapping found
  const mappedLights = ROOM_LIGHTS[areaNameNormalized] || [];
  const availableLights =
    mappedLights.length > 0
      ? mappedLights.filter(id => entities?.[id])
      : entityKeys.filter(key => {
          if (!key.startsWith('light.')) return false;
          const lightName = key.slice(6);
          return (
            lightName.startsWith(areaNameNormalized + '_') ||
            lightName === areaNameNormalized + '_lights' ||
            lightName === areaNameNormalized
          );
        });
  const mappedLightsOn = mappedLights.filter(id => entities?.[id]?.state === 'on').length;
  const lightsOn =
    mappedLights.length > 0
      ? mappedLightsOn
      : entityKeys.filter(key => {
          if (!key.startsWith('light.')) return false;
          if (entities[key]?.state !== 'on') return false;

          const lightName = key.slice(6); // Remove 'light.' prefix
          // Match: bathroom_lights, bathroom_ceiling, etc. (starts with area_)
          return (
            lightName.startsWith(areaNameNormalized + '_') ||
            lightName === areaNameNormalized + '_lights' ||
            lightName === areaNameNormalized
          );
        }).length;
  const hasLightsOn = lightsOn > 0;

  // Hallway specific: front door lock and sensor (configure in config/entities.ts)
  const isHallway = areaNameNormalized === 'hallway';
  const frontLock = entities?.[FRONT_DOOR_LOCK_ENTITY];
  const frontDoor = entities?.[FRONT_DOOR_SENSOR_ENTITY];
  const isUnlocked = isHallway && frontLock?.state === 'unlocked';
  const isDoorOpen = isHallway && frontDoor?.state === 'on';
  const hasHallwayDoor = isHallway && !!frontDoor;
  const hasHallwayLock = isHallway && !!frontLock;

  // Vacuum - lives in Office (entity from config/entities.ts)
  const isOffice = areaNameNormalized === 'office';
  const vacuum = entities?.[VACUUM_ENTITY];
  const vacuumState = vacuum?.state;
  const isVacuumActive = vacuumState === 'cleaning' || vacuumState === 'returning';
  const isVacuumError = vacuumState === 'error';
  const isVacuumOffline = vacuumState === 'unavailable' || !vacuumState;
  const isVacuumIdle = vacuumState === 'docked' || vacuumState === 'paused' || vacuumState === 'idle';

  // Office as guest bedroom - overnight guest mode
  const hasOvernightGuest = isOffice && entities?.['input_boolean.overnight_guest']?.state === 'on';

  // Common "ready" states: complete, finished, done, ready, end, completed, end of cycle, unemptied
  const readyStates = ['complete', 'finished', 'done', 'ready', 'end', 'completed', 'end of cycle', 'unemptied'];

  // Kitchen - Dishwasher state
  const isKitchen = areaNameNormalized === 'kitchen';
  const dishwasherState = isKitchen ? entities?.['sensor.dishwasher_state']?.state : null;
  const dishwasherStateLower = dishwasherState?.toLowerCase()?.trim() || '';
  // Check for ready states - match if state contains any ready keyword
  const isDishwasherReady = readyStates.some(state => dishwasherStateLower.includes(state));
  const isDishwasherOffOrIdle = ['off', 'idle'].includes(dishwasherStateLower);
  const isDishwasherRunning =
    dishwasherState && !isDishwasherReady && !isDishwasherOffOrIdle && !['unknown', 'unavailable'].includes(dishwasherStateLower);
  // Debug: log unexpected states
  if (isKitchen && dishwasherState && !isDishwasherReady && !isDishwasherOffOrIdle && !isDishwasherRunning) {
    console.warn('[Dishwasher] Unexpected state:', dishwasherState, '| lowercase:', dishwasherStateLower);
  }
  const dishwasherStateClass = isDishwasherRunning ? 'active' : isDishwasherReady ? 'ready' : isDishwasherOffOrIdle ? 'inactive' : 'info';
  // Rank: 4=ready (jobs to do), 3=running, 2=media, 1=other active, 0=inactive
  const dishwasherStateRank = isDishwasherReady ? 4 : isDishwasherRunning ? 3 : isDishwasherOffOrIdle ? 0 : 1;
  // Kitchen - Hotplate power
  const hotplatePowerRaw = isKitchen ? entities?.['sensor.hotplate_power_monitor_total_active_power']?.state : null;
  const hotplatePower = hotplatePowerRaw ? Number(hotplatePowerRaw) : 0;
  const isHotplateRunning = isKitchen && hotplatePower >= 200; // Hotplates use 1000-2000W when cooking, 200W threshold filters standby
  const hasHotplateSensor = isKitchen && hotplatePowerRaw !== null && hotplatePowerRaw !== undefined;
  // Kitchen - Oven power
  const ovenPowerRaw = isKitchen ? entities?.['sensor.oven_plug_switch_0_power']?.state : null;
  const ovenPower = ovenPowerRaw ? Number(ovenPowerRaw) : 0;
  const isOvenRunning = isKitchen && ovenPower >= 200; // Ovens use 1000-3000W when cooking, 200W threshold filters standby
  const hasOvenSensor = isKitchen && ovenPowerRaw !== null && ovenPowerRaw !== undefined;
  // Kitchen - Microwave power
  const microwavePowerRaw = isKitchen ? entities?.['sensor.microwave_plug_power']?.state : null;
  const microwavePower = microwavePowerRaw ? Number(microwavePowerRaw) : 0;
  const isMicrowaveRunning = isKitchen && microwavePower >= 200; // Microwaves use 800-1500W when cooking, 200W threshold filters standby
  const hasMicrowaveSensor = isKitchen && microwavePowerRaw !== null && microwavePowerRaw !== undefined;
  const hasDishwasher = isKitchen && dishwasherState !== null && dishwasherState !== undefined;

  // Guest Bathroom - Washer/Dryer
  const isGuestBathroom = areaNameNormalized === 'guest_bathroom';
  const washerState = isGuestBathroom ? entities?.['sensor.washer_state']?.state : null;
  const dryerState = isGuestBathroom ? entities?.['sensor.dryer_state']?.state : null;
  // Washer state detection
  const washerStateLower = washerState?.toLowerCase()?.trim() || '';
  const isWasherReady = readyStates.some(state => washerStateLower.includes(state));
  const isWasherOffOrIdle = ['off', 'idle', 'standby', 'emptied'].includes(washerStateLower);
  const isWasherRunning = washerState && !isWasherReady && !isWasherOffOrIdle && !['unknown', 'unavailable'].includes(washerStateLower);
  const washerStateClass = isWasherRunning ? 'active' : isWasherReady ? 'ready' : isWasherOffOrIdle ? 'inactive' : 'info';
  // Rank: 4=ready (jobs to do), 3=running, 2=media, 1=other active, 0=inactive
  const washerStateRank = isWasherReady ? 4 : isWasherRunning ? 3 : isWasherOffOrIdle ? 0 : 1;
  // Dryer state detection
  const dryerStateLower = dryerState?.toLowerCase()?.trim() || '';
  const isDryerReady = readyStates.some(state => dryerStateLower.includes(state));
  const isDryerOffOrIdle = ['off', 'idle', 'standby', 'emptied'].includes(dryerStateLower);
  const isDryerRunning = dryerState && !isDryerReady && !isDryerOffOrIdle && !['unknown', 'unavailable'].includes(dryerStateLower);
  const dryerStateClass = isDryerRunning ? 'active' : isDryerReady ? 'ready' : isDryerOffOrIdle ? 'inactive' : 'info';
  // Rank: 4=ready (jobs to do), 3=running, 2=media, 1=other active, 0=inactive
  const dryerStateRank = isDryerReady ? 4 : isDryerRunning ? 3 : isDryerOffOrIdle ? 0 : 1;

  // Room cleaning requested
  const cleaningToggleId = isKitchen ? null : `${ROBOT_CLEAN_PREFIX}${areaNameNormalized}`;
  const cleaningRequested = cleaningToggleId ? entities?.[cleaningToggleId]?.state === 'on' : false;
  // Last clean entity - tracks when cleaning was completed
  const lastCleanId = isKitchen ? null : `input_text.${areaNameNormalized}_last_clean`;

  // Kitchen cleaning split (cook side vs dining side)
  const kitchenCleanCookId = isKitchen ? ROBOT_CLEAN_KITCHEN_1 : null;
  const kitchenCleanDiningId = isKitchen ? ROBOT_CLEAN_KITCHEN_2 : null;
  const kitchenCleanCookRequested = kitchenCleanCookId ? entities?.[kitchenCleanCookId]?.state === 'on' : false;
  const kitchenCleanDiningRequested = kitchenCleanDiningId ? entities?.[kitchenCleanDiningId]?.state === 'on' : false;
  // Kitchen last clean entities
  const kitchenLastCleanCookId = isKitchen ? 'input_text.kitchen_last_clean' : null;
  const kitchenLastCleanDiningId = isKitchen ? 'input_text.kitchen_2_last_clean' : null;

  // Door contact sensor - pattern: binary_sensor.{area}_door_contact
  // on = door open, off = door closed (typical for contact sensors)
  // Special case: Rooftop has two doors (door_1 and door_2)
  const doorContactId = `binary_sensor.${areaNameNormalized}_door_contact`;
  const doorContact = isHallway ? frontDoor : entities?.[doorContactId];

  // Rooftop special case - two doors (always show for rooftop; we don't rely on entities containing them)
  const rooftopDoor1 = isRooftop ? entities?.['binary_sensor.rooftop_door_1_contact'] : null;
  const rooftopDoor2 = isRooftop ? entities?.['binary_sensor.rooftop_door_2_contact'] : null;
  const hasRooftopDoors = isRooftop; // show door indicator whenever room is rooftop
  const rooftopDoor1Open = rooftopDoor1?.state === 'on';
  const rooftopDoor2Open = rooftopDoor2?.state === 'on';

  const hasRoomDoor = !!doorContact || hasRooftopDoors;
  const isRoomDoorOpen = doorContact?.state === 'on' || rooftopDoor1Open || rooftopDoor2Open;

  // Window contact sensor - pattern: binary_sensor.{area}_window_contact
  // on = window open, off = window closed
  const windowContactId = `binary_sensor.${areaNameNormalized}_window_contact`;
  const windowContact = entities?.[windowContactId];

  // Dining room special case - three windows (use area_id so we match regardless of area name)
  const isDiningRoom = area.area_id === 'dining_room';
  const diningWindow1 = isDiningRoom ? entities?.['binary_sensor.dining_room_window_1_contact'] : null;
  const diningWindow2 = isDiningRoom ? entities?.['binary_sensor.dining_room_window_2_contact'] : null;
  const diningWindow3 = isDiningRoom ? entities?.['binary_sensor.dining_room_window_3_contact'] : null;
  const hasDiningWindows = isDiningRoom && (diningWindow1 || diningWindow2 || diningWindow3);
  const diningWindow1Open = diningWindow1?.state === 'on';
  const diningWindow2Open = diningWindow2?.state === 'on';
  const diningWindow3Open = diningWindow3?.state === 'on';
  const diningWindowsOpen = (diningWindow1Open ? 1 : 0) + (diningWindow2Open ? 1 : 0) + (diningWindow3Open ? 1 : 0);

  const hasRoomWindow = !!windowContact || hasDiningWindows;
  const isRoomWindowOpen = windowContact?.state === 'on' || diningWindow1Open || diningWindow2Open || diningWindow3Open;

  // Bathroom specific: Shower/bath presence
  const isBathroom = areaNameNormalized === 'bathroom';
  const bathPresenceId = 'binary_sensor.bathroom_bath_presence_presence';
  const isInShower = isBathroom && entities?.[bathPresenceId]?.state === 'on';
  // Bedroom specific: Alarm clock
  const isBedroom = areaNameNormalized === 'bedroom';
  const alarmEnabled = isBedroom ? entities?.['input_boolean.wakeup_bedroom']?.state === 'on' : false;
  const alarmTime = isBedroom ? entities?.['input_datetime.wakeup_bedroom']?.state : null;
  const hasAlarm = !!(isBedroom && entities?.['input_boolean.wakeup_bedroom']);

  // Media player - check if playing and muted state
  // Prefer Music Assistant entity over Sonos integration entity (_2 suffix) when both exist
  const mediaPlayerIdMA = `media_player.${areaNameNormalized}`;
  const mediaPlayerIdSonos = `media_player.${areaNameNormalized}_2`;
  const maEntity = entities?.[mediaPlayerIdMA];
  const mediaPlayerId = maEntity ? mediaPlayerIdMA : mediaPlayerIdSonos; // Prefer MA if it exists, fallback to Sonos
  const mediaPlayer = entities?.[mediaPlayerId];
  const isMediaPlaying = mediaPlayer?.state === 'playing';
  const isMediaMuted = mediaPlayer?.attributes?.is_volume_muted === true;
  const hasMediaPlayer = !!mediaPlayer;

  // Get temperature value - handle climate entity special case
  const rawTemp =
    tempSensor === '__climate__' ? climateEntity?.attributes?.current_temperature : tempSensor ? entities[tempSensor]?.state : null;
  const temp = rawTemp != null && rawTemp !== '' ? (typeof rawTemp === 'number' ? rawTemp : String(rawTemp)) : null;
  const rawHumidity = humiditySensor ? entities[humiditySensor]?.state : null;
  const humidity = rawHumidity != null && rawHumidity !== '' ? String(rawHumidity) : null;
  const icon = area.icon || 'mdi:home';

  return (
    <button
      className={`room-card ${isSelected ? 'selected' : ''} ${isOccupied ? 'occupied' : ''}`}
      onClick={onClick}
      style={
        {
          '--room-bg': roomColor.bg,
          '--room-border': roomColor.border,
          '--room-icon': roomColor.icon,
          '--room-text': roomColor.text,
        } as React.CSSProperties
      }
    >
      {/* Status indicators */}
      <div className='room-indicators'>
        {(() => {
          const indicators: { key: string; weight: number; stateRank: number; node: React.ReactNode }[] = [];

          const make = (key: IndicatorKey, node: React.ReactNode, show: boolean, stateRank: number = 0, uniqueKey?: string) => {
            if (!show) return;
            const finalKey = uniqueKey || key;
            indicators.push({ key: finalKey, weight: indicatorCounts[key] ?? 0, stateRank, node });
          };

          // Hallway front door
          make(
            'door',
            hasHallwayDoor && (
              <IndicatorWithTimeline
                entityId={FRONT_DOOR_SENSOR_ENTITY}
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator door ${isDoorOpen ? 'active' : 'inactive'}`}
                title={isDoorOpen ? 'Front door open - click for timeline' : 'Front door closed - click for timeline'}
                icon={isDoorOpen ? 'mdi:door-open' : 'mdi:door-closed'}
              />
            ),
            !!hasHallwayDoor,
            isDoorOpen ? 1 : 0, // Other active state
            'door_hallway'
          );

          make(
            'lock',
            hasHallwayLock && (
              <IndicatorWithTimeline
                entityId={FRONT_DOOR_LOCK_ENTITY}
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator lock ${isUnlocked ? 'active' : 'inactive'}`}
                title={isUnlocked ? 'Lock unlocked - click for timeline' : 'Lock locked - click for timeline'}
                icon={isUnlocked ? 'mdi:lock-open' : 'mdi:lock'}
              />
            ),
            !!hasHallwayLock,
            isUnlocked ? 1 : 0 // Other active state
          );

          make(
            'door',
            hasRoomDoor && !hasRooftopDoors && doorContact && (
              <IndicatorWithTimeline
                entityId={doorContactId}
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator door ${isRoomDoorOpen ? 'active' : 'inactive'}`}
                title={isRoomDoorOpen ? 'Door open - click for timeline' : 'Door closed - click for timeline'}
                icon={isRoomDoorOpen ? 'mdi:door-open' : 'mdi:door-closed'}
              />
            ),
            hasRoomDoor && !hasRooftopDoors && !!doorContact,
            isRoomDoorOpen ? 1 : 0, // Other active state
            'door_room'
          );

          make(
            'door',
            hasRooftopDoors && (
              <MultiEntitySelector
                entityIds={['binary_sensor.rooftop_door_1_contact', 'binary_sensor.rooftop_door_2_contact']}
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator door ${rooftopDoor1Open || rooftopDoor2Open ? 'active' : 'inactive'}`}
                title={
                  rooftopDoor1Open || rooftopDoor2Open
                    ? `${rooftopDoor1Open && rooftopDoor2Open ? 'Both doors open' : 'Door open'} - click to select`
                    : 'Both doors closed - click to select'
                }
                icon={rooftopDoor1Open || rooftopDoor2Open ? 'mdi:door-open' : 'mdi:door-closed'}
                label={
                  (rooftopDoor1Open ? 1 : 0) + (rooftopDoor2Open ? 1 : 0) > 1
                    ? ((rooftopDoor1Open ? 1 : 0) + (rooftopDoor2Open ? 1 : 0)).toString()
                    : undefined
                }
                entityType='door'
              />
            ),
            !!hasRooftopDoors,
            rooftopDoor1Open || rooftopDoor2Open ? 1 : 0, // Other active state
            'door_rooftop'
          );

          make(
            'window',
            hasRoomWindow && !hasDiningWindows && windowContact && (
              <IndicatorWithTimeline
                entityId={windowContactId}
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator window ${isRoomWindowOpen ? 'active' : 'inactive'}`}
                title={isRoomWindowOpen ? 'Window open - click for timeline' : 'Window closed - click for timeline'}
                icon={isRoomWindowOpen ? 'mdi:window-open' : 'mdi:window-closed'}
              />
            ),
            hasRoomWindow && !hasDiningWindows && !!windowContact,
            isRoomWindowOpen ? 1 : 0, // Other active state
            'window_room'
          );

          make(
            'window',
            hasDiningWindows && (
              <MultiEntitySelector
                entityIds={[
                  'binary_sensor.dining_room_window_1_contact',
                  'binary_sensor.dining_room_window_2_contact',
                  'binary_sensor.dining_room_window_3_contact',
                ].filter(id => entities[id])}
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator window ${diningWindowsOpen > 0 ? 'active' : 'inactive'}`}
                title={
                  diningWindowsOpen === 0
                    ? 'All windows closed - click to select'
                    : diningWindowsOpen === 3
                      ? 'All 3 windows open - click to select'
                      : `${diningWindowsOpen} window${diningWindowsOpen > 1 ? 's' : ''} open - click to select`
                }
                icon={diningWindowsOpen > 0 ? 'mdi:window-open' : 'mdi:window-closed'}
                label={diningWindowsOpen > 1 ? diningWindowsOpen.toString() : undefined}
                entityType='window'
              />
            ),
            !!hasDiningWindows,
            diningWindowsOpen > 0 ? 1 : 0, // Other active state
            'window_dining'
          );

          make(
            'heating',
            climateEntity && (
              <div className={`indicator heat ${isHeating ? 'active' : 'inactive'}`} title={isHeating ? 'Heating' : 'Heating off'}>
                <Icon icon='mdi:fire' />
              </div>
            ),
            !!climateEntity,
            isHeating ? 1 : 0 // Other active state
          );

          make(
            'shower',
            isBathroom && bathPresenceId && entities?.[bathPresenceId] && (
              <IndicatorWithTimeline
                entityId={bathPresenceId}
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator water ${isInShower ? 'active' : 'inactive'}`}
                title={isInShower ? 'Shower active - click for timeline' : 'Shower inactive - click for timeline'}
                icon={area.icon || 'mdi:shower'}
              />
            ),
            !!(isBathroom && bathPresenceId && entities?.[bathPresenceId]),
            isInShower ? 1 : 0 // Other active state
          );

          make(
            'cleaning',
            !isKitchen && cleaningToggleId && entities?.[cleaningToggleId] && (
              <IndicatorWithTimeline
                entityId={cleaningToggleId}
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator cleaning ${cleaningRequested ? 'active' : 'inactive'}`}
                title='Cleaning requested'
                icon='mdi:robot-vacuum'
                secondaryEntityId={lastCleanId || undefined}
              />
            ),
            !!(!isKitchen && cleaningToggleId && entities?.[cleaningToggleId]),
            cleaningRequested ? 1 : 0 // Other active state
          );

          make(
            'cleaning_cook',
            isKitchen && kitchenCleanCookId && entities?.[kitchenCleanCookId] && (
              <IndicatorWithTimeline
                entityId={kitchenCleanCookId}
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator cleaning ${kitchenCleanCookRequested ? 'active' : 'inactive'}`}
                title='Clean kitchen (cook side)'
                icon='mdi:countertop-outline'
                secondaryEntityId={kitchenLastCleanCookId || undefined}
              />
            ),
            !!(isKitchen && kitchenCleanCookId && entities?.[kitchenCleanCookId]),
            kitchenCleanCookRequested ? 1 : 0 // Other active state
          );

          make(
            'cleaning_dining',
            isKitchen && kitchenCleanDiningId && entities?.[kitchenCleanDiningId] && (
              <IndicatorWithTimeline
                entityId={kitchenCleanDiningId}
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator cleaning ${kitchenCleanDiningRequested ? 'active' : 'inactive'}`}
                title='Clean kitchen (dining side)'
                icon='mdi:table-chair'
                secondaryEntityId={kitchenLastCleanDiningId || undefined}
              />
            ),
            !!(isKitchen && kitchenCleanDiningId && entities?.[kitchenCleanDiningId]),
            kitchenCleanDiningRequested ? 1 : 0 // Other active state
          );

          make(
            'vacuum',
            isOffice && vacuum && (
              <IndicatorWithTimeline
                entityId={VACUUM_ENTITY}
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator vacuum ${
                  isVacuumActive ? 'working' : isVacuumError || isVacuumOffline ? 'error' : isVacuumIdle ? 'idle' : 'inactive'
                }`}
                title={`Vacuum: ${vacuumState || 'unknown'}`}
                icon='mdi:robot-vacuum'
              />
            ),
            isOffice && !!vacuum && !isVacuumIdle, // Only show when not idle (working, error, or offline)
            isVacuumActive ? 3 : isVacuumError || isVacuumOffline ? 1 : 0 // Running = 3
          );

          make(
            'guest',
            isOffice && entities?.['input_boolean.overnight_guest'] && (
              <div className={`indicator guest ${hasOvernightGuest ? 'active' : 'inactive'}`} title='Overnight guest'>
                <Icon icon='mdi:bed' />
              </div>
            ),
            isOffice && !!entities?.['input_boolean.overnight_guest'],
            hasOvernightGuest ? 1 : 0 // Other active state
          );

          make(
            'dishwasher',
            hasDishwasher && (
              <IndicatorWithTimeline
                entityId='sensor.dishwasher_state'
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator appliance ${dishwasherStateClass}`}
                title={`Dishwasher: ${dishwasherState} - click for timeline`}
                icon='mdi:dishwasher'
              />
            ),
            hasDishwasher,
            dishwasherStateRank
          );

          make(
            'hotplate',
            hasHotplateSensor && (
              <IndicatorWithTimeline
                entityId='sensor.hotplate_power_monitor_total_active_power'
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator power ${isHotplateRunning ? 'running' : 'inactive'}`}
                title={isHotplateRunning ? 'Hotplate running - click for timeline' : 'Hotplate not running - click for timeline'}
                icon='mdi:stove'
              />
            ),
            hasHotplateSensor,
            isHotplateRunning ? 3 : 0 // Running state (same rank as appliances)
          );

          make(
            'oven',
            hasOvenSensor && (
              <IndicatorWithTimeline
                entityId='sensor.oven_plug_switch_0_power'
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator power ${isOvenRunning ? 'running' : 'inactive'}`}
                title={isOvenRunning ? 'Oven running - click for timeline' : 'Oven not running - click for timeline'}
                icon='mdi:toaster-oven'
              />
            ),
            hasOvenSensor,
            isOvenRunning ? 3 : 0 // Running state (same rank as appliances)
          );

          make(
            'microwave',
            hasMicrowaveSensor && (
              <IndicatorWithTimeline
                entityId='sensor.microwave_plug_power'
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator power ${isMicrowaveRunning ? 'running' : 'inactive'}`}
                title={isMicrowaveRunning ? 'Microwave running - click for timeline' : 'Microwave not running - click for timeline'}
                icon='mdi:microwave'
              />
            ),
            hasMicrowaveSensor,
            isMicrowaveRunning ? 3 : 0 // Running state (same rank as appliances)
          );

          make(
            'washer',
            isGuestBathroom && washerState && (
              <IndicatorWithTimeline
                entityId='sensor.washer_state'
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator appliance ${washerStateClass}`}
                title={`Washer: ${washerState} - click for timeline`}
                icon='mdi:washing-machine'
              />
            ),
            isGuestBathroom && !!washerState,
            washerStateRank
          );

          make(
            'dryer',
            isGuestBathroom && dryerState && (
              <IndicatorWithTimeline
                entityId='sensor.dryer_state'
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator appliance ${dryerStateClass}`}
                title={`Dryer: ${dryerState} - click for timeline`}
                icon='mdi:tumble-dryer'
              />
            ),
            isGuestBathroom && !!dryerState,
            dryerStateRank
          );

          make(
            'media',
            hasMediaPlayer && (
              <IndicatorWithTimeline
                entityId={mediaPlayerId}
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator media ${isMediaPlaying ? `active${isMediaMuted ? ' muted' : ''}` : 'inactive'}`}
                title={`Media: ${mediaPlayer?.state || 'unknown'}${isMediaMuted ? ' (muted)' : ''} - click for timeline`}
                icon={isMediaMuted ? 'mdi:music-off' : 'mdi:music'}
              />
            ),
            hasMediaPlayer,
            isMediaPlaying ? 2 : 0
          );

          make(
            'lights',
            availableLights.length > 0 && (
              <MultiEntitySelector
                entityIds={availableLights}
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator light ${hasLightsOn ? 'active' : 'inactive'}`}
                title={`${lightsOn} light${lightsOn > 1 ? 's' : ''} ${hasLightsOn ? 'on' : 'off'} - click to ${availableLights.length > 1 ? 'select' : 'view timeline'}`}
                icon='mdi:lightbulb'
                entityType='light'
              />
            ),
            availableLights.length > 0,
            hasLightsOn ? 1 : 0 // Other active state
          );

          make(
            'presence',
            hasPresence && (
              <IndicatorWithTimeline
                entityId={presenceSensorId}
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator presence ${isOccupied ? 'active' : 'inactive'}`}
                title={isOccupied ? 'Occupied - click for timeline' : 'Not occupied - click for timeline'}
                icon='mdi:account'
              />
            ),
            hasPresence,
            isOccupied ? 1 : 0 // Other active state
          );

          make(
            'alarm',
            hasAlarm && (
              <IndicatorWithTimeline
                entityId='input_boolean.wakeup_bedroom'
                entities={entities}
                hassUrl={hassUrl}
                className={`indicator alarm ${alarmEnabled ? 'active' : 'inactive'}`}
                title={alarmEnabled ? `Alarm set for ${alarmTime || 'unknown'} - click for timeline` : 'Alarm not set - click for timeline'}
                icon='mdi:alarm'
              />
            ),
            hasAlarm,
            alarmEnabled ? 1 : 0 // Active when alarm is enabled
          );

          // Order is rendered left-to-right in DOM; container is flex-end aligned, so last in order appears most to the right.
          // Sorting priority (stateRank):
          // 4 = Ready/unemptied (jobs to do) - FIRST/rightmost
          // 3 = Running (appliances working)
          // 2 = Media playing
          // 1 = Other active (lights, presence, doors)
          // 0 = Inactive

          indicators.sort((a, b) => {
            // 1. Sort by state rank: ready (4) > running (3) > media (2) > other (1) > inactive (0)
            // Higher state rank should be later in array = rightmost
            if (a.stateRank !== b.stateRank) return a.stateRank - b.stateRank; // lower rank first, higher rank later (rightmost)

            // 2. Sort by weight (applicability count): higher weight = more rooms = rightmost
            if (a.weight !== b.weight) return a.weight - b.weight; // lower weight first, higher weight later (rightmost)

            // 3. Sort by reverse alphabetical order of key name
            // 'presence' (p) > 'lights' (l) in normal alphabetical, so 'presence' comes later (rightmost) in reverse alphabetical
            return b.key.localeCompare(a.key); // reverse alphabetical: higher alphabetical order = later (rightmost)
          });

          return indicators.map(i => <Fragment key={i.key}>{i.node}</Fragment>);
        })()}
      </div>

      <div className='room-card-content'>
        <div className='room-left-section'>
          <h3 className='room-name'>{formatName(area.name)}</h3>
          <div className='room-climate'>
            {temp && humidity ? (
              <>
                <span className='climate-item'>{temp}°C</span>
                <span className='climate-item'>{humidity}%</span>
              </>
            ) : temp ? (
              <span className='climate-item'>{temp}°C</span>
            ) : humidity ? (
              <span className='climate-item'>{humidity}%</span>
            ) : (
              <span className='climate-item'>—</span>
            )}
          </div>
          <div className='room-icon-container' style={{ background: roomColor.iconBg }}>
            <Icon icon={icon} className='room-icon' style={{ color: roomColor.icon }} />
          </div>
        </div>
        <div className='room-right-indicators'>
          {(() => {
            const indicators: { key: string; weight: number; stateRank: number; node: React.ReactNode }[] = [];

            const make = (key: IndicatorKey, node: React.ReactNode, show: boolean, stateRank: number = 0, uniqueKey?: string) => {
              if (!show) return;
              const finalKey = uniqueKey || key;
              indicators.push({ key: finalKey, weight: indicatorCounts[key] ?? 0, stateRank, node });
            };

            // Add all the same indicators as before, but they'll be displayed on the right
            // (keeping the same logic from the top indicators)
            make(
              'door',
              hasHallwayDoor && (
                <IndicatorWithTimeline
                  entityId={FRONT_DOOR_SENSOR_ENTITY}
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator door ${isDoorOpen ? 'active' : 'inactive'}`}
                  title={isDoorOpen ? 'Front door open - click for timeline' : 'Front door closed - click for timeline'}
                  icon={isDoorOpen ? 'mdi:door-open' : 'mdi:door-closed'}
                />
              ),
              !!hasHallwayDoor,
              isDoorOpen ? 1 : 0,
              'door_hallway'
            );

            make(
              'lock',
              hasHallwayLock && (
                <IndicatorWithTimeline
                  entityId={FRONT_DOOR_LOCK_ENTITY}
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator lock ${isUnlocked ? 'active' : 'inactive'}`}
                  title={isUnlocked ? 'Lock unlocked - click for timeline' : 'Lock locked - click for timeline'}
                  icon={isUnlocked ? 'mdi:lock-open' : 'mdi:lock'}
                />
              ),
              !!hasHallwayLock,
              isUnlocked ? 1 : 0
            );

            make(
              'door',
              hasRoomDoor && !hasRooftopDoors && doorContact && (
                <IndicatorWithTimeline
                  entityId={doorContactId}
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator door ${isRoomDoorOpen ? 'active' : 'inactive'}`}
                  title={isRoomDoorOpen ? 'Door open - click for timeline' : 'Door closed - click for timeline'}
                  icon={isRoomDoorOpen ? 'mdi:door-open' : 'mdi:door-closed'}
                />
              ),
              !!hasRoomDoor && !hasRooftopDoors && !!doorContact,
              isRoomDoorOpen ? 1 : 0
            );

            make(
              'door',
              hasRooftopDoors && (
                <MultiEntitySelector
                  entityIds={['binary_sensor.rooftop_door_1_contact', 'binary_sensor.rooftop_door_2_contact']}
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator door ${rooftopDoor1Open || rooftopDoor2Open ? 'active' : 'inactive'}`}
                  title={
                    rooftopDoor1Open || rooftopDoor2Open
                      ? `${rooftopDoor1Open && rooftopDoor2Open ? 'Both doors open' : 'Door open'} - click to select`
                      : 'Both doors closed - click to select'
                  }
                  icon={rooftopDoor1Open || rooftopDoor2Open ? 'mdi:door-open' : 'mdi:door-closed'}
                  label={
                    (rooftopDoor1Open ? 1 : 0) + (rooftopDoor2Open ? 1 : 0) > 1
                      ? ((rooftopDoor1Open ? 1 : 0) + (rooftopDoor2Open ? 1 : 0)).toString()
                      : undefined
                  }
                  entityType='door'
                />
              ),
              !!hasRooftopDoors,
              rooftopDoor1Open || rooftopDoor2Open ? 1 : 0,
              'door_rooftop'
            );

            make(
              'window',
              hasRoomWindow && !hasDiningWindows && windowContact && (
                <IndicatorWithTimeline
                  entityId={windowContactId}
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator window ${isRoomWindowOpen ? 'active' : 'inactive'}`}
                  title={isRoomWindowOpen ? 'Window open - click for timeline' : 'Window closed - click for timeline'}
                  icon={isRoomWindowOpen ? 'mdi:window-open' : 'mdi:window-closed'}
                />
              ),
              !!hasRoomWindow && !hasDiningWindows && !!windowContact,
              isRoomWindowOpen ? 1 : 0,
              'window_room'
            );

            make(
              'window',
              hasDiningWindows && (
                <MultiEntitySelector
                  entityIds={[
                    'binary_sensor.dining_room_window_1_contact',
                    'binary_sensor.dining_room_window_2_contact',
                    'binary_sensor.dining_room_window_3_contact',
                  ].filter(id => entities[id])}
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator window ${diningWindowsOpen > 0 ? 'active' : 'inactive'}`}
                  title={
                    diningWindowsOpen === 0
                      ? 'All windows closed - click to select'
                      : diningWindowsOpen === 3
                        ? 'All 3 windows open - click to select'
                        : `${diningWindowsOpen} window${diningWindowsOpen > 1 ? 's' : ''} open - click to select`
                  }
                  icon={diningWindowsOpen > 0 ? 'mdi:window-open' : 'mdi:window-closed'}
                  label={diningWindowsOpen > 1 ? diningWindowsOpen.toString() : undefined}
                  entityType='window'
                />
              ),
              !!hasDiningWindows,
              diningWindowsOpen > 0 ? 1 : 0,
              'window_dining'
            );

            make(
              'heating',
              isHeating && (
                <div className='indicator heat active' title='Heating'>
                  <Icon icon='mdi:radiator' />
                </div>
              ),
              isHeating,
              1 // Other active state
            );

            make(
              'shower',
              isBathroom && bathPresenceId && entities?.[bathPresenceId] && (
                <IndicatorWithTimeline
                  entityId={bathPresenceId}
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator water ${isInShower ? 'active' : 'inactive'}`}
                  title={isInShower ? 'Shower active - click for timeline' : 'Shower inactive - click for timeline'}
                  icon={area.icon || 'mdi:shower'}
                />
              ),
              !!(isBathroom && bathPresenceId && entities?.[bathPresenceId]),
              isInShower ? 1 : 0
            );

            make(
              'cleaning',
              !isKitchen && cleaningToggleId && entities?.[cleaningToggleId] && (
                <IndicatorWithTimeline
                  entityId={cleaningToggleId}
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator cleaning ${cleaningRequested ? 'active' : 'inactive'}`}
                  title='Cleaning requested'
                  icon='mdi:robot-vacuum'
                  secondaryEntityId={lastCleanId || undefined}
                />
              ),
              !!(!isKitchen && cleaningToggleId && entities?.[cleaningToggleId]),
              cleaningRequested ? 1 : 0
            );

            make(
              'cleaning_cook',
              isKitchen && kitchenCleanCookId && entities?.[kitchenCleanCookId] && (
                <IndicatorWithTimeline
                  entityId={kitchenCleanCookId}
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator cleaning ${kitchenCleanCookRequested ? 'active' : 'inactive'}`}
                  title='Clean kitchen (cook side)'
                  icon='mdi:countertop-outline'
                  secondaryEntityId={kitchenLastCleanCookId || undefined}
                />
              ),
              !!(isKitchen && kitchenCleanCookId && entities?.[kitchenCleanCookId]),
              kitchenCleanCookRequested ? 1 : 0
            );

            make(
              'cleaning_dining',
              isKitchen && kitchenCleanDiningId && entities?.[kitchenCleanDiningId] && (
                <IndicatorWithTimeline
                  entityId={kitchenCleanDiningId}
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator cleaning ${kitchenCleanDiningRequested ? 'active' : 'inactive'}`}
                  title='Clean kitchen (dining side)'
                  icon='mdi:table-chair'
                  secondaryEntityId={kitchenLastCleanDiningId || undefined}
                />
              ),
              !!(isKitchen && kitchenCleanDiningId && entities?.[kitchenCleanDiningId]),
              kitchenCleanDiningRequested ? 1 : 0
            );

            make(
              'vacuum',
              isOffice && vacuum && (
                <IndicatorWithTimeline
                  entityId={VACUUM_ENTITY}
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator vacuum ${
                    isVacuumActive ? 'working' : isVacuumError || isVacuumOffline ? 'error' : isVacuumIdle ? 'idle' : 'inactive'
                  }`}
                  title={`Vacuum: ${vacuumState || 'unknown'}`}
                  icon='mdi:robot-vacuum'
                />
              ),
              isOffice && !!vacuum && !isVacuumIdle,
              isVacuumActive ? 3 : isVacuumError || isVacuumOffline ? 1 : 0 // Running = 3
            );

            make(
              'guest',
              isOffice && entities?.['input_boolean.overnight_guest'] && (
                <div className={`indicator guest ${hasOvernightGuest ? 'active' : 'inactive'}`} title='Overnight guest'>
                  <Icon icon='mdi:bed' />
                </div>
              ),
              isOffice && !!entities?.['input_boolean.overnight_guest'],
              hasOvernightGuest ? 1 : 0
            );

            make(
              'dishwasher',
              hasDishwasher && (
                <IndicatorWithTimeline
                  entityId='sensor.dishwasher_state'
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator appliance ${dishwasherStateClass}`}
                  title={`Dishwasher: ${dishwasherState} - click for timeline`}
                  icon='mdi:dishwasher'
                />
              ),
              hasDishwasher,
              dishwasherStateRank
            );

            make(
              'hotplate',
              hasHotplateSensor && (
                <IndicatorWithTimeline
                  entityId='sensor.hotplate_power_monitor_total_active_power'
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator power ${isHotplateRunning ? 'running' : 'inactive'}`}
                  title={isHotplateRunning ? 'Hotplate running - click for timeline' : 'Hotplate not running - click for timeline'}
                  icon='mdi:stove'
                />
              ),
              hasHotplateSensor,
              isHotplateRunning ? 3 : 0
            );

            make(
              'oven',
              hasOvenSensor && (
                <IndicatorWithTimeline
                  entityId='sensor.oven_plug_switch_0_power'
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator power ${isOvenRunning ? 'running' : 'inactive'}`}
                  title={isOvenRunning ? 'Oven running - click for timeline' : 'Oven not running - click for timeline'}
                  icon='mdi:toaster-oven'
                />
              ),
              hasOvenSensor,
              isOvenRunning ? 3 : 0
            );

            make(
              'microwave',
              hasMicrowaveSensor && (
                <IndicatorWithTimeline
                  entityId='sensor.microwave_plug_power'
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator power ${isMicrowaveRunning ? 'running' : 'inactive'}`}
                  title={isMicrowaveRunning ? 'Microwave running - click for timeline' : 'Microwave not running - click for timeline'}
                  icon='mdi:microwave'
                />
              ),
              hasMicrowaveSensor,
              isMicrowaveRunning ? 3 : 0
            );

            make(
              'washer',
              isGuestBathroom && washerState && (
                <IndicatorWithTimeline
                  entityId='sensor.washer_state'
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator appliance ${washerStateClass}`}
                  title={`Washer: ${washerState} - click for timeline`}
                  icon='mdi:washing-machine'
                />
              ),
              isGuestBathroom && !!washerState,
              washerStateRank
            );

            make(
              'dryer',
              isGuestBathroom && dryerState && (
                <IndicatorWithTimeline
                  entityId='sensor.dryer_state'
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator appliance ${dryerStateClass}`}
                  title={`Dryer: ${dryerState} - click for timeline`}
                  icon='mdi:tumble-dryer'
                />
              ),
              isGuestBathroom && !!dryerState,
              dryerStateRank
            );

            make(
              'media',
              hasMediaPlayer && (
                <IndicatorWithTimeline
                  entityId={mediaPlayerId}
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator media ${isMediaPlaying ? `active${isMediaMuted ? ' muted' : ''}` : 'inactive'}`}
                  title={`Media: ${mediaPlayer?.state || 'unknown'}${isMediaMuted ? ' (muted)' : ''} - click for timeline`}
                  icon={isMediaMuted ? 'mdi:music-off' : 'mdi:music'}
                />
              ),
              hasMediaPlayer,
              isMediaPlaying ? 2 : 0
            );

            make(
              'lights',
              availableLights.length > 0 && (
                <MultiEntitySelector
                  entityIds={availableLights}
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator light ${hasLightsOn ? 'active' : 'inactive'}`}
                  title={`${lightsOn} light${lightsOn > 1 ? 's' : ''} ${hasLightsOn ? 'on' : 'off'} - click to ${availableLights.length > 1 ? 'select' : 'view timeline'}`}
                  icon='mdi:lightbulb'
                  entityType='light'
                />
              ),
              availableLights.length > 0,
              hasLightsOn ? 1 : 0
            );

            make(
              'presence',
              hasPresence && (
                <IndicatorWithTimeline
                  entityId={presenceSensorId}
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator presence ${isOccupied ? 'active' : 'inactive'}`}
                  title={isOccupied ? 'Occupied - click for timeline' : 'Not occupied - click for timeline'}
                  icon='mdi:account'
                />
              ),
              hasPresence,
              isOccupied ? 1 : 0
            );

            make(
              'alarm',
              hasAlarm && (
                <IndicatorWithTimeline
                  entityId='input_boolean.wakeup_bedroom'
                  entities={entities}
                  hassUrl={hassUrl}
                  className={`indicator alarm ${alarmEnabled ? 'active' : 'inactive'}`}
                  title={
                    alarmEnabled ? `Alarm set for ${alarmTime || 'unknown'} - click for timeline` : 'Alarm not set - click for timeline'
                  }
                  icon='mdi:alarm'
                />
              ),
              hasAlarm,
              alarmEnabled ? 1 : 0
            );

            // Sort indicators by priority:
            // 4 = Ready/unemptied (jobs to do) - FIRST
            // 3 = Running (appliances working)
            // 2 = Media playing
            // 1 = Other active (lights, presence, doors)
            // 0 = Inactive
            indicators.sort((a, b) => {
              if (a.stateRank !== b.stateRank) return b.stateRank - a.stateRank; // Higher rank first
              if (a.weight !== b.weight) return b.weight - a.weight; // Higher weight first
              return a.key.localeCompare(b.key); // Alphabetical
            });

            return indicators.map(i => <Fragment key={i.key}>{i.node}</Fragment>);
          })()}
        </div>
      </div>
    </button>
  );
}
