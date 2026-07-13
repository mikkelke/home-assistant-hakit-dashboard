import { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import type { RoomDetailProps } from '../../types';
import { SonosPlayer, TVCard } from '../MediaPlayer';
import { ClimateCard } from '../Climate';
import { AcCard } from '../AC';
import { SmartCoolingCard } from '../SmartCooling';
import { CoverCard } from '../Cover';
import { VacuumCard, RoomCleaningToggle } from '../Vacuum';
import { LightCard } from '../Light';
import { WakeupAlarm } from '../Alarm';
import { IntercomCard } from '../Intercom';
import { WeatherCard } from '../Weather';
import { WasherCard } from '../Washer';
import { DishwasherCard } from '../Dishwasher';
import { DryerCard } from '../Dryer';
import {
  ROBOT_CLEAN_PREFIX,
  VACUUM_ENTITY,
  isAcDeployed,
  BEDROOM_COMFORT_SENSOR,
  BEDROOM_NIGHT_PROJECTION_SENSOR,
} from '../../config/entities';
import { ROOM_LIGHT_MANUAL_OVERRIDE, ROOM_LIGHT_MANUAL_OVERRIDE_TIMEOUT_HOURS } from '../../config/lights';
import { resolvePreferredMediaPlayer } from '../../utils/mediaPlayer';
import { useSwipeToClose } from '../../hooks';
import './RoomDetail.css';

// Bedroom night-comfort row (sensor.bedroom_comfort middle layer)
const COMFORT_LABELS: Record<string, string> = {
  comfortable: 'Comfortable night ahead',
  warm: 'Warm night ahead',
  sticky: 'Sticky night ahead',
  hot: 'Hot night ahead',
};

const COMFORT_ICONS: Record<string, string> = {
  comfortable: 'mdi:weather-night',
  warm: 'mdi:thermometer',
  sticky: 'mdi:water-percent',
  hot: 'mdi:thermometer-high',
};

function comfortDetail(attrs: Record<string, unknown>): string {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const dp = num(attrs.dew_point);
  const dpMorning = num(attrs.dew_point_morning);
  const base = num(attrs.ceiling_base);
  const eff = num(attrs.ceiling_effective);
  const parts: string[] = [];
  if (dp !== null && dpMorning !== null) parts.push(`Dew point ${dp.toFixed(1)}° → ${dpMorning.toFixed(1)}° by morning`);
  else if (dp !== null) parts.push(`Dew point ${dp.toFixed(1)}°`);
  if (base !== null && eff !== null && eff < base) parts.push(`ceiling ${base.toFixed(1)}° → ${eff.toFixed(1)}°`);
  return parts.join(' · ');
}

// Night projection row (sensor.bedroom_night_projection, DeployAdvisor middle layer).
// Shown whether or not the AC is deployed - "worth setting it up?" is exactly the
// stored-away question.
type ProjectedNight = { date: string; peak: number; over_ceiling?: unknown };

function projectionNights(attrs: Record<string, unknown>): ProjectedNight[] {
  const raw = attrs.nights;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (n): n is ProjectedNight =>
      !!n && typeof (n as ProjectedNight).date === 'string' && typeof (n as ProjectedNight).peak === 'number'
  );
}

function nightLabel(date: string, index: number): string {
  if (index === 0) return 'Tonight';
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });
}

const nightIsOver = (n: ProjectedNight) => n.over_ceiling === true || n.over_ceiling === 'true';

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
  const bedroomComfort = isBedroom ? entities?.[BEDROOM_COMFORT_SENSOR] : undefined;
  const nightProjection = isBedroom ? entities?.[BEDROOM_NIGHT_PROJECTION_SENSOR] : undefined;
  const projNights = nightProjection
    ? projectionNights(nightProjection.attributes as Record<string, unknown>).slice(0, 3)
    : [];
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

        {/* Portable AC (Midea porta split) — bedroom only, auto-appears while deployed */}
        {isBedroom && isAcDeployed(entities) && <AcCard entities={entities} callService={callService} />}

        {/* Smart cooling — autonomous price-aware pre-cool + comfort (AppDaemon SmartCooling app) */}
        {isBedroom && isAcDeployed(entities) && <SmartCoolingCard entities={entities} callService={callService} />}

        {/* Bedroom night comfort (middle layer) — deliberately OUTSIDE SmartCoolingCard,
            which hides while the AC is stored: that is exactly when "worth deploying
            tonight?" needs an answer on the wall. */}
        {bedroomComfort && (
          <div
            className={`bedroom-comfort-row ${bedroomComfort.state}`}
            title={String((bedroomComfort.attributes as Record<string, unknown>)?.reason ?? '')}
          >
            <Icon icon={COMFORT_ICONS[bedroomComfort.state] ?? 'mdi:bed-clock'} />
            <div className='comfort-text'>
              <span className='comfort-state'>{COMFORT_LABELS[bedroomComfort.state] ?? bedroomComfort.state}</span>
              <span className='comfort-detail'>{comfortDetail(bedroomComfort.attributes as Record<string, unknown>)}</span>
              {(bedroomComfort.attributes as Record<string, unknown>)?.vent_helps === true && (
                <span className='comfort-vent'>
                  <Icon icon='mdi:window-open-variant' /> Venting helps — outdoor is cooler and drier
                </span>
              )}
            </div>
          </div>
        )}

        {/* Projected night peaks without cooling (DeployAdvisor) — the "worth
            setting up the AC?" answer, most useful while the unit is stored. */}
        {nightProjection && projNights.length > 0 && (
          <div
            className='night-projection-row'
            title={String((nightProjection.attributes as Record<string, unknown>)?.reason ?? '')}
          >
            <Icon icon='mdi:weather-night' />
            <div className='projection-nights'>
              {projNights.map((n, i) => (
                <div key={n.date} className={`projection-night ${nightIsOver(n) ? 'over' : ''}`}>
                  <span className='pn-day'>{nightLabel(n.date, i)}</span>
                  <span className='pn-peak'>{n.peak.toFixed(1)}°</span>
                </div>
              ))}
            </div>
            <span className='projection-note'>
              {projNights.some(nightIsOver) ? 'AC worth deploying' : 'no cooling needed'}
            </span>
          </div>
        )}

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
