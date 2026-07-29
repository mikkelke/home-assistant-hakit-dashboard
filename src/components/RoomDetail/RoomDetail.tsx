import { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import type { RoomDetailProps } from '../../types';
import { SonosPlayer, TVCard } from '../MediaPlayer';
import { ClimateCard } from '../Climate';
import { TonightCard } from '../AC';
import { CoverCard } from '../Cover';
import { VacuumCard, RoomCleaningToggle } from '../Vacuum';
import { LightCard } from '../Light';
import { WakeupAlarm } from '../Alarm';
import { IntercomCard } from '../Intercom';
import { WeatherCard } from '../Weather';
import { WasherCard } from '../Washer';
import { DishwasherCard } from '../Dishwasher';
import { DryerCard } from '../Dryer';
import { ROBOT_CLEAN_PREFIX, VACUUM_ENTITY } from '../../config/entities';
import { ROOM_LIGHT_MANUAL_OVERRIDE, ROOM_LIGHT_MANUAL_OVERRIDE_TIMEOUT_HOURS } from '../../config/lights';
import { resolvePreferredMediaPlayer } from '../../utils/mediaPlayer';
import { useSwipeToClose } from '../../hooks';
import './RoomDetail.css';

export function RoomDetail({ area, entities, hassUrl, callService, onClose, isMobile }: RoomDetailProps) {
  const [showRoomInfo, setShowRoomInfo] = useState(false);
  // Clock for the manual-override countdown. Held in state (render must stay pure per
  // lint react-hooks/purity); refreshed by timer callbacks only while an override is on.
  const [overrideNowMs, setOverrideNowMs] = useState(0);
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
  const isHallway = area.name.toLowerCase() === 'hallway';
  const isRooftop = area.area_id === 'rooftop' || area.name.toLowerCase().replace(/\s+/g, '_') === 'rooftop';
  const isLivingRoom = area.name.toLowerCase() === 'living room' || area.name.toLowerCase() === 'living_room';
  const isGuestBathroom = areaName === 'guest_bathroom';
  const isKitchen = areaName === 'kitchen';
  const washerStateEntity = entities?.['sensor.washer_state'];
  const dryerStateEntity = entities?.['sensor.dryer_state'];
  const dishwasherStateEntity = entities?.['sensor.dishwasher_state'];
  const vacuum = entities?.[VACUUM_ENTITY];

  // Rooftop: keep the Sonos on / exempt from follow-me (no-motion) muting.
  const keepSpeakerOnId = 'input_boolean.rooftop_keep_speaker_on';
  const keepSpeakerEntity = entities?.[keepSpeakerOnId];
  const keepSpeakerOn = keepSpeakerEntity?.state === 'on';

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
  const roomStateId = `input_text.${areaName}_state`;
  const lastCleanId = `input_text.${areaName}_last_clean`;
  const roomState = entities?.[roomStateId]?.state;
  const lastClean = entities?.[lastCleanId]?.state;
  // Kitchen has two zones; show both last-clean values if present
  const lastCleanKitchen = isKitchen ? entities?.['input_text.kitchen_last_clean']?.state : null;
  const lastCleanKitchen2 = isKitchen ? entities?.['input_text.kitchen_2_last_clean']?.state : null;
  const illuminanceId = `sensor.${areaName}_presence_illuminance`;
  const illuminance = entities?.[illuminanceId]?.state;

  // Manual lights override — tucked into Room Info; auto-clears after 12 h (AppDaemon watcher)
  const lightOverrideId = ROOM_LIGHT_MANUAL_OVERRIDE[areaName];
  const lightOverrideEntity = lightOverrideId ? entities?.[lightOverrideId] : undefined;
  const lightOverrideOn = lightOverrideEntity?.state === 'on';

  // Live countdown to the 12 h auto-resume: computed from the boolean's last_changed —
  // the same source the AppDaemon watcher uses, so dashboard and server always agree.
  // Timer callbacks (async) refresh the clock state; render itself stays pure.
  useEffect(() => {
    if (!lightOverrideOn) return;
    const update = () => setOverrideNowMs(Date.now());
    const t0 = window.setTimeout(update, 0); // first paint of the countdown
    const id = window.setInterval(update, 30000);
    return () => {
      window.clearTimeout(t0);
      window.clearInterval(id);
    };
  }, [lightOverrideOn]);

  const overrideRemainingLabel = (() => {
    if (!lightOverrideOn) return null;
    const lc = lightOverrideEntity?.last_changed ? Date.parse(lightOverrideEntity.last_changed) : NaN;
    if (Number.isNaN(lc) || overrideNowMs <= 0) return 'resumes in ≤12 h';
    const remainingMs = ROOM_LIGHT_MANUAL_OVERRIDE_TIMEOUT_HOURS * 3600_000 - (overrideNowMs - lc);
    if (remainingMs <= 0) return 'resuming…';
    const totalMin = Math.ceil(remainingMs / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `resumes in ${h}h ${String(m).padStart(2, '0')}m` : `resumes in ${m} min`;
  })();

  const handleToggleLightOverride = () => {
    if (!callService || !lightOverrideId) return;
    callService({
      domain: 'input_boolean',
      service: lightOverrideOn ? 'turn_off' : 'turn_on',
      target: { entity_id: lightOverrideId },
    });
  };

  const hasRoomInfo = roomState || lastClean || lastCleanKitchen || lastCleanKitchen2 || illuminance || lightOverrideEntity;

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
          <SonosPlayer entityId={mediaSensor} entities={entities} hassUrl={hassUrl} callService={callService} />
        )}

        {/* TV Card (Bedroom and Living Room) */}
        {isBedroom && bedroomTv && (
          <TVCard
            entityId='media_player.bedroom_tv'
            entities={entities}
            hassUrl={hassUrl}
            callService={callService}
            showTvLift={true}
            tvLiftSelectEntityId='input_select.bedroom_tv_lift_position'
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

        {/* Light Controls */}
        <LightCard areaName={area.name} entities={entities} callService={callService} />

        {/* Weather (Rooftop) */}
        {isRooftop && <WeatherCard entities={entities} callService={callService} hassUrl={hassUrl} />}

        {/* Keep speaker on (follow-me exempt) — Rooftop */}
        {isRooftop && keepSpeakerEntity && (
          <button
            className={`room-cleaning-toggle ${keepSpeakerOn ? 'requested' : ''}`}
            onClick={() =>
              callService?.({
                domain: 'input_boolean',
                service: keepSpeakerOn ? 'turn_off' : 'turn_on',
                target: { entity_id: keepSpeakerOnId },
              })
            }
            title='Keep the rooftop speaker on (exempt from follow-me / no-motion muting)'
          >
            <Icon icon='mdi:speaker' />
            <span className='toggle-text'>Keep speaker playing</span>
            <div className={`toggle-indicator ${keepSpeakerOn ? 'on' : 'off'}`} />
          </button>
        )}

        {/* Tonight — Apple-style card covering tonight's cooling plan (wake projection, night
            bar, three-day strip, and the single Cool Tonight / Going to Bed control surface). */}
        {isBedroom && <TonightCard entities={entities} callService={callService} />}

        {/* Climate Card */}
        {climate && <ClimateCard areaName={area.name} entities={entities} callService={callService} />}

        {/* Cover/Blinds Card */}
        {cover && <CoverCard areaName={area.name} entities={entities} callService={callService} />}

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

        {/* Room Info - Collapsible */}
        {hasRoomInfo && (
          <div className='room-info-section'>
            <button className='room-info-toggle' onClick={() => setShowRoomInfo(!showRoomInfo)}>
              <Icon icon='mdi:information-outline' />
              <span>Room Info</span>
              <Icon icon={showRoomInfo ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
            </button>

            {showRoomInfo && (
              <div className='room-info-content'>
                {roomState && roomState !== 'unknown' && roomState !== '' && (
                  <div className='room-info-item'>
                    <Icon icon='mdi:home-assistant' />
                    <div className='room-info-details'>
                      <span className='room-info-label'>Room State</span>
                      <span className='room-info-value'>{roomState}</span>
                    </div>
                  </div>
                )}
                {lastClean && lastClean !== 'unknown' && lastClean !== '' && !isKitchen && (
                  <div className='room-info-item'>
                    <Icon icon='mdi:broom' />
                    <div className='room-info-details'>
                      <span className='room-info-label'>Last Cleaned</span>
                      <span className='room-info-value'>{lastClean}</span>
                    </div>
                  </div>
                )}
                {isKitchen && (
                  <>
                    {lastCleanKitchen && lastCleanKitchen !== 'unknown' && lastCleanKitchen !== '' && (
                      <div className='room-info-item'>
                        <Icon icon='mdi:broom' />
                        <div className='room-info-details'>
                          <span className='room-info-label'>Last Cleaned · Cook side</span>
                          <span className='room-info-value'>{lastCleanKitchen}</span>
                        </div>
                      </div>
                    )}
                    {lastCleanKitchen2 && lastCleanKitchen2 !== 'unknown' && lastCleanKitchen2 !== '' && (
                      <div className='room-info-item'>
                        <Icon icon='mdi:broom' />
                        <div className='room-info-details'>
                          <span className='room-info-label'>Last Cleaned · Dining side</span>
                          <span className='room-info-value'>{lastCleanKitchen2}</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {illuminance && (
                  <div className='room-info-item'>
                    <Icon icon='mdi:brightness-5' />
                    <div className='room-info-details'>
                      <span className='room-info-label'>Light level</span>
                      <span className='room-info-value'>{illuminance} lx</span>
                    </div>
                  </div>
                )}
                {lightOverrideEntity && (
                  <button
                    type='button'
                    className={`room-info-item room-info-action ${lightOverrideOn ? 'active' : ''}`}
                    onClick={handleToggleLightOverride}
                    title='When on, automatic lighting is paused for this room (auto-resumes after 12 h)'
                  >
                    <Icon icon='mdi:hand-back-right' />
                    <div className='room-info-details'>
                      <span className='room-info-label'>Manual lights</span>
                      <span className='room-info-value'>
                        {lightOverrideOn ? `Auto paused — ${overrideRemainingLabel}` : 'Auto lights active'}
                      </span>
                    </div>
                    <span className={`room-info-switch ${lightOverrideOn ? 'on' : ''}`}>
                      <span className='room-info-switch-knob' />
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
