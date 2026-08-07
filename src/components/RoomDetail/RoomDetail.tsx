import { Icon } from '@iconify/react';
import type { RoomDetailProps } from '../../types';
import { SonosPlayer, TVCard } from '../MediaPlayer';
import { HeatCard } from '../Heating';
import { TonightCard } from '../AC';
import { CoverCard } from '../Cover';
import { VacuumCard, RoomCleaningToggle } from '../Vacuum';
import { LightCard } from '../Light';
import { WakeupAlarm } from '../Alarm';
import { IntercomCard } from '../Intercom';
import { WasherCard } from '../Washer';
import { DishwasherCard } from '../Dishwasher';
import { DryerCard } from '../Dryer';
import { ROBOT_CLEAN_PREFIX, VACUUM_ENTITY } from '../../config/entities';
import { resolvePreferredMediaPlayer } from '../../utils/mediaPlayer';
import { useSwipeToClose } from '../../hooks';
import './RoomDetail.css';

/** hvac_mode values that mean the whole-apartment thermostat isn't calling for heat at all. */
const HEATING_SEASON_OFF_STATES = new Set(['off', 'unavailable', 'unknown']);

export function RoomDetail({ area, entities, hassUrl, callService, onClose, isMobile }: RoomDetailProps) {
  const areaName = area.name.toLowerCase().replace(/\s+/g, '_');
  const formatName = (text: string) => text.replace(/\b(\p{L})(\p{L}*)/gu, (_, a, b) => a.toUpperCase() + b.toLowerCase());

  // Use standardized swipe-to-close hook
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(onClose);

  // Get room-specific entities — presence: PIR only
  const presenceSensor = `binary_sensor.${areaName}_pir_presence`;

  const humiditySensor = `sensor.${areaName}_humidity`;
  const climateSensor = `climate.${areaName}_thermostat`;

  const { entityId: mediaSensor } = resolvePreferredMediaPlayer(entities, `media_player.${areaName}`);
  const coverId = `cover.${areaName}_blind`;
  const cleaningToggleId = `${ROBOT_CLEAN_PREFIX}${areaName}`;

  const presence = entities?.[presenceSensor]?.state === 'on';
  const humidity = entities?.[humiditySensor]?.state;
  const climate = entities?.[climateSensor];
  const mediaPlayer = entities?.[mediaSensor];
  const cover = entities?.[coverId];
  const cleaningToggle = entities?.[cleaningToggleId];

  const isBedroom = area.name.toLowerCase() === 'bedroom';
  // Winter/summer gate for the bedroom's climate-card slot: the whole-apartment thermostat
  // calling for heat means floor heating (HeatCard); otherwise it's AC-advisory season
  // (TonightCard, which self-gates further) — the bedroom never shows both.
  const familyRoomThermostatState = entities?.['climate.family_room_thermostat']?.state;
  const heatingSeason = !!familyRoomThermostatState && !HEATING_SEASON_OFF_STATES.has(familyRoomThermostatState);
  // Out of season an all-off HeatCard is wasted space (user 2026-07-29) -> hide it entirely.
  // Safety valve: a zone someone turned on individually stays visible even off-season --
  // a card must never be hidden while its own heat is running.
  const zoneState = climate?.state;
  const zoneOn = !!zoneState && !HEATING_SEASON_OFF_STATES.has(zoneState);
  const showHeat = heatingSeason || zoneOn;
  const isHallway = area.name.toLowerCase() === 'hallway';
  const isRooftop = area.area_id === 'rooftop' || area.name.toLowerCase().replace(/\s+/g, '_') === 'rooftop';
  const isLivingRoom = area.name.toLowerCase() === 'living room' || area.name.toLowerCase() === 'living_room';
  const isGuestBathroom = areaName === 'guest_bathroom';
  const isKitchen = areaName === 'kitchen';
  const washerStateEntity = entities?.['sensor.washer_state'];
  const dryerStateEntity = entities?.['sensor.dryer_state'];
  const dishwasherStateEntity = entities?.['sensor.dishwasher_state'];
  const vacuum = entities?.[VACUUM_ENTITY];

  // Rooftop: keep the Sonos on / exempt from follow-me muting while docked.
  // Rendered as a row inside the Sonos card (user 2026-08-07), not a standalone toggle.
  const keepSpeakerOnId = 'input_boolean.rooftop_keep_speaker_on';

  // TV entities
  const bedroomTv = entities?.['media_player.bedroom_tv'];
  const livingRoomTv = entities?.['media_player.living_room_tv'];

  // Check if living room TV is using Sonos (hide Sonos when TV is using it)
  const isLivingRoomTvOn =
    livingRoomTv &&
    (livingRoomTv.state === 'on' || livingRoomTv.state === 'playing' || livingRoomTv.state === 'paused' || livingRoomTv.state === 'idle');
  const livingRoomSonosSource = typeof mediaPlayer?.attributes?.source === 'string' ? mediaPlayer.attributes.source : '';
  const isTvUsingSonos = isLivingRoom && isLivingRoomTvOn && livingRoomSonosSource.toLowerCase().includes('tv');
  const shouldShowSonos = !isTvUsingSonos;

  // Room info entities

  return (
    <div
      className={`room-detail ${isMobile ? 'mobile' : 'desktop'}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className='room-detail-header'>
        <div className='room-detail-title'>
          <h2>{formatName(area.name)}</h2>
          {presence && <span className='presence-badge'>Occupied</span>}
        </div>
        <button className='close-button' onClick={onClose}>
          <Icon icon='mdi:close' />
        </button>
      </div>

      <div className='room-detail-content'>
        {/* Building Access (Hallway) */}
        {isHallway && <IntercomCard entities={entities} callService={callService} showHeader={true} />}

        {/* Sonos Player - MOST IMPORTANT, at the top */}
        {/* Hide living room Sonos when TV is using it */}
        {mediaPlayer && shouldShowSonos && (
          <SonosPlayer
            entityId={mediaSensor}
            entities={entities}
            hassUrl={hassUrl}
            callService={callService}
            keepPlayingEntityId={isRooftop ? keepSpeakerOnId : undefined}
            dockedEntityId={isRooftop ? 'binary_sensor.rooftop_charging' : undefined}
          />
        )}

        {/* TV Card (Bedroom and Living Room) */}
        {isBedroom && bedroomTv && (
          <TVCard
            entityId='media_player.bedroom_tv'
            entities={entities}
            hassUrl={hassUrl}
            callService={callService}
            appleRemoteEntityId='remote.bedroom_apple_tv'
            appleMediaPlayerEntityId='media_player.bedroom_apple_tv'
          />
        )}
        {isLivingRoom && livingRoomTv && (
          <TVCard
            entityId='media_player.living_room_tv'
            entities={entities}
            hassUrl={hassUrl}
            callService={callService}
            showTvLift={true}
            tvLiftSelectEntityId='select.living_room_tv_lift_position'
            appleRemoteEntityId='remote.living_room_apple_tv'
            appleMediaPlayerEntityId='media_player.living_room_apple_tv'
            chromecastEntityId='media_player.living_room_cast'
            wirelessUsbCEntityId='media_player.bedroom_sony_tv'
          />
        )}

        {/* Washer (Guest Bathroom) */}
        {isGuestBathroom && washerStateEntity && <WasherCard entities={entities} callService={callService} />}

        {/* Dryer (Guest Bathroom) */}
        {isGuestBathroom && dryerStateEntity && <DryerCard entities={entities} callService={callService} />}

        {/* Dishwasher (Kitchen) */}
        {isKitchen && dishwasherStateEntity && <DishwasherCard entities={entities} callService={callService} />}

        {/* Wake-up Alarm (Bedroom) */}
        <WakeupAlarm areaName={area.name} entities={entities} callService={callService} />

        {/* Light Controls (bedroom moves this below the blind - see the Light Controls line after Cover) */}
        {!isBedroom && <LightCard areaName={area.name} entities={entities} callService={callService} />}

        {/* Bedroom seasonal combo slot: floor heating in winter, the Tonight cooling card once AC
            season starts (heatingSeason gates on the whole-apartment thermostat) - never both. */}
        {isBedroom &&
          (heatingSeason ? (
            <HeatCard areaName={area.name} entities={entities} callService={callService} />
          ) : (
            <TonightCard entities={entities} callService={callService} />
          ))}

        {/* Heat Card (floor heating) */}
        {climate && !isBedroom && showHeat && <HeatCard areaName={area.name} entities={entities} callService={callService} />}

        {/* Cover/Blinds Card */}
        {cover && <CoverCard areaName={area.name} entities={entities} callService={callService} />}

        {/* Light Controls (Bedroom only - below the blind) */}
        {isBedroom && <LightCard areaName={area.name} entities={entities} callService={callService} />}

        {/* Vacuum Card - only in Kitchen where it lives */}
        {isKitchen && vacuum && <VacuumCard entities={entities} callService={callService} />}

        {/* Room Cleaning Toggle - for rooms that have it */}
        {cleaningToggle && <RoomCleaningToggle areaName={area.name} entities={entities} callService={callService} />}

        {/* Humidity (if no climate, show standalone) */}
        {!climate && humidity && (
          <div className='room-stat-card'>
            <Icon icon='mdi:water-percent' />
            <span className='stat-value'>{humidity}%</span>
            <span className='stat-label'>Humidity</span>
          </div>
        )}
      </div>
    </div>
  );
}
