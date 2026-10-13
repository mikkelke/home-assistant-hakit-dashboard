import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import type { HassEntities, RoomCardProps } from '../../types';
import {
  HOUSE_EVENTS_ENTITY,
  KITCHEN_TEMP_SENSOR,
  OUTDOOR_TEMP_SENSOR,
  WEATHER_ENTITY,
  resolveHallwayDoorSensorId,
  resolveHallwayLockEntityId,
  resolveKitchenHumiditySensorId,
  roomFeelSensorId,
} from '../../config/entities';
import { readApplianceCycle, type ApplianceCycle } from '../../energy/applianceRun';
import { newestEventMs } from '../../home/houseEvents';
import { HOUSEHOLD, isNightHour } from '../../home/household';
import { useMotionSlot } from '../../home/motionBudget';
import {
  AREA_EXTERIOR_CONTACTS,
  FROST_BELOW_C,
  asleepAreaIds,
  isAreaOpen,
  roomGlow,
  roomLightIds,
  type RoomGlow,
} from '../../home/roomAmbient';
import { HOME_APPLIANCES, type HomeAppliance } from '../../home/upcoming';
import { useNowMs } from '../../hooks/useNowMs';
import { formatDecimal } from '../../utils/format';
import { resolvePreferredMediaPlayer } from '../../utils/mediaPlayer';
import { IndicatorWithTimeline } from './IndicatorWithTimeline';
import { MultiEntitySelector } from './MultiEntitySelector';
import './RoomGrid.css';

/** A sensor is only useful here if it carries an actual measurement. HA publishes "unknown"
 * (template returned None) and "unavailable" (device offline) as ordinary state strings, and
 * both are truthy - so an existence check treats a dead sensor as a live one, and a raw render
 * prints the word itself ("unknown°C"). Used both to PICK a sensor and to render its value. */
function hasReading(entity: { state?: string | null } | undefined): boolean {
  const s = entity?.state;
  return s != null && s !== '' && s !== 'unknown' && s !== 'unavailable';
}

const formatName = (text: string) => text.replace(/\b(\p{L})(\p{L}*)/gu, (_, a, b) => a.toUpperCase() + b.toLowerCase());

/** Watts above which a kitchen appliance counts as on: cooking draws 800 to 3000 W, standby far less. */
const COOKING_W = 200;
const COOKING_DEVICES = [
  { entityId: 'sensor.hotplate_power_monitor_total_active_power', icon: 'mdi:stove', name: 'Hotplate' },
  { entityId: 'sensor.oven_plug_switch_0_power', icon: 'mdi:toaster-oven', name: 'Oven' },
  { entityId: 'sensor.microwave_plug_power', icon: 'mdi:microwave', name: 'Microwave' },
] as const;

const ACTIVE_APPLIANCE_STATES = new Set(['Running', 'Paused', 'Unemptied']);
const BATH_PRESENCE = 'binary_sensor.bathroom_bath_presence_presence';
const WAKE_ALARM = 'input_boolean.wakeup_bedroom';
const WAKE_ALARM_TIME = 'input_datetime.wakeup_bedroom';
const PLAIN_ORB = '138 148 160';

function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readingNumber(entity: { state?: string } | undefined): number | null {
  return hasReading(entity) ? toNumber(entity?.state) : null;
}

/** Colder out than the frost line: the roof station, else the forecast. */
function coldOutside(entities: HassEntities): boolean {
  const tempC = readingNumber(entities[OUTDOOR_TEMP_SENSOR]) ?? toNumber(entities[WEATHER_ENTITY]?.attributes?.temperature);
  return tempC != null && tempC < FROST_BELOW_C;
}

function formatTemp(temp: string | number): string {
  const value = toNumber(temp);
  return value == null ? String(temp) : formatDecimal(value, 1);
}

/** Two glow layers: a new colour fades in over the old one instead of jumping. */
function GlowLayers({ glow }: { glow: RoomGlow | null }) {
  const key = glow ? `${glow.rgb.join(' ')}/${glow.alpha}` : null;
  const [layers, setLayers] = useState({ a: key, b: null as string | null, top: 'a' as 'a' | 'b' });
  const shown = layers.top === 'a' ? layers.a : layers.b;
  if (shown !== key) setLayers(prev => (prev.top === 'a' ? { ...prev, b: key, top: 'b' } : { ...prev, a: key, top: 'a' }));
  const layer = (value: string | null, on: boolean) => {
    const [rgb, alpha] = value?.split('/') ?? [];
    return (
      <i
        className={`room-glow ${on && value ? 'is-on' : ''}`}
        style={value ? ({ '--g': rgb, '--ga': alpha } as CSSProperties) : undefined}
      />
    );
  };
  return (
    <>
      {layer(layers.a, layers.top === 'a')}
      {layer(layers.b, layers.top === 'b')}
    </>
  );
}

/** Sound bars beside the name while the room's speaker plays; flat while muted. */
function Equaliser({ areaId, muted }: { areaId: string; muted: boolean }) {
  const moving = useMotionSlot(`eq:${areaId}`, 'equaliser', !muted);
  return (
    <span
      className={`room-eq ${moving ? 'is-anim' : ''} ${muted ? 'is-muted' : ''}`}
      role='img'
      aria-label={muted ? 'Speaker muted' : 'Speaker playing'}
    >
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/** The occupied edge. All occupied cards share one slot and breathe in one phase. */
function BreathingEdge() {
  const breathing = useMotionSlot('breathing', 'breathing', true);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (breathing && ref.current) ref.current.style.animationDelay = `${-(performance.now() % 6000)}ms`;
  }, [breathing]);
  return <i ref={ref} className={`room-edge ${breathing ? 'is-anim' : ''}`} />;
}

const RING_R = 22;
const RING_C = 2 * Math.PI * RING_R;

function remainingLabel(etaMs: number, nowMs: number): string | null {
  const minutes = Math.ceil((etaMs - nowMs) / 60_000);
  if (minutes <= 0) return null;
  return minutes < 60 ? `${minutes} m` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

function elapsedLabel(sinceMs: number, nowMs: number): string | null {
  const minutes = Math.floor((nowMs - sinceMs) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  return minutes < 60 ? `${minutes} m` : `${Math.floor(minutes / 60)} h`;
}

interface ActiveAppliance {
  appliance: HomeAppliance;
  entity: HassEntities[string];
}

const RING_ORDER: Record<ApplianceCycle['status'], number> = { ready: 0, running: 1, paused: 2, idle: 3 };

/** One ring per card: the appliance that matters most, the other one as a badge. */
function ApplianceRing({ active, houseAsleep }: { active: ActiveAppliance[]; houseAsleep: boolean }) {
  const nowMs = useNowMs();
  const cycles = active
    .map(item => ({ ...item, cycle: readApplianceCycle(item.entity, item.appliance.config.etaFormat, nowMs) }))
    .filter(item => item.cycle.status !== 'idle')
    .sort((a, b) => RING_ORDER[a.cycle.status] - RING_ORDER[b.cycle.status]);
  const [main, second] = cycles;
  const kind = main?.appliance.kind ?? 'washer';
  const status = main?.cycle.status ?? 'idle';
  const glinting = useMotionSlot(`glint:${kind}`, 'appliance', status === 'running');
  const readyPulse = useMotionSlot(`ready:${kind}`, 'oneShot', status === 'ready', 1300);
  if (!main) return null;

  const { cycle, appliance, entity } = main;
  const ready = cycle.status === 'ready';
  const share = ready ? 1 : (cycle.progressPct ?? 0) / 100;
  const night = houseAsleep || isNightHour(nowMs);
  const sinceMs = Date.parse(entity?.last_changed ?? '');
  const text = ready
    ? elapsedLabel(sinceMs, nowMs)
    : cycle.status === 'paused'
      ? 'Paused'
      : cycle.etaMs != null
        ? (remainingLabel(cycle.etaMs, nowMs) ?? 'Soon')
        : `${Math.round(cycle.progressPct ?? 0)} %`;
  const angle = share * 2 * Math.PI;
  const label = `${appliance.config.label} ${ready ? 'ready to be emptied' : cycle.status === 'paused' ? 'paused' : 'running'}${text ? `, ${text}` : ''}`;
  return (
    <span
      className={`room-ring is-${cycle.status} ${night && !ready ? 'is-night' : ''} ${readyPulse ? 'is-anim' : ''}`}
      role='img'
      aria-label={label}
    >
      <svg viewBox='0 0 56 56' aria-hidden='true'>
        <circle className='room-ring-track' cx='28' cy='28' r={RING_R} />
        <circle className='room-ring-arc' cx='28' cy='28' r={RING_R} strokeDasharray={`${share * RING_C} ${RING_C}`} />
        {glinting && <circle className='room-ring-glint' cx={28 + RING_R * Math.cos(angle)} cy={28 + RING_R * Math.sin(angle)} r='2.6' />}
      </svg>
      <span className='room-ring-in'>
        <Icon icon={ready ? 'mdi:check' : appliance.config.icon} />
        {text && <b>{text}</b>}
      </span>
      {second && (
        <span className={`room-ring-badge is-${second.cycle.status}`} title={second.appliance.config.label}>
          <Icon icon={second.appliance.config.icon} />
        </span>
      )}
    </span>
  );
}

/** How long the hallway shows a ring, and how long the still stand-in for the ripple stays. */
const RING_SHOWN_MS = 120_000;
const RIPPLE_STILL_MS = 10_000;
const RIPPLE_MS = 2300;

/** The hallway's orb turns into a bell when the doorbell rings while the screen is open, and
 * ripples once; without the motion, two still rings stand in for the ripple. */
function DoorbellRipple() {
  const ringMs = useHass(s => newestEventMs(s.entities[HOUSE_EVENTS_ENTITY]?.attributes?.events, 'ring'));
  const [shownSinceMs] = useState(() => Date.now());
  const [ended, setEnded] = useState({ ringMs: null as number | null, still: false, bell: false });
  const fresh = ringMs != null && ringMs > shownSinceMs;
  useEffect(() => {
    if (!fresh) return;
    const timers = [
      setTimeout(() => setEnded(prev => ({ ringMs, still: true, bell: prev.ringMs === ringMs && prev.bell })), RIPPLE_STILL_MS),
      setTimeout(() => setEnded({ ringMs, still: true, bell: true }), RING_SHOWN_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [fresh, ringMs]);
  const rippling = useMotionSlot(`ripple:${ringMs ?? 0}`, 'oneShot', fresh, RIPPLE_MS);
  const over = ended.ringMs === ringMs ? ended : { still: false, bell: false };
  if (!fresh || over.bell) return null;
  return (
    <>
      {rippling ? (
        <>
          <i className='room-ripple is-anim' />
          <i className='room-ripple is-anim r2' />
          <i className='room-ripple is-anim r3' />
        </>
      ) : (
        !over.still && (
          <>
            <i className='room-ripple is-still' />
            <i className='room-ripple is-still r2' />
          </>
        )
      )}
      <span className='room-orb room-orb--bell'>
        <Icon icon='mdi:bell-ring' />
      </span>
    </>
  );
}

interface Exception {
  key: string;
  node: ReactNode;
}

export function RoomCard({ area, entities, onClick, onClimateClick, isSelected, hassUrl }: RoomCardProps) {
  const areaName = area.name.toLowerCase();
  const areaNameNormalized = areaName.replace(/\s+/g, '_');
  // Only the rare fallbacks below (a room without its own conventionally named sensor) need the full
  // key list, so it is built on demand instead of for every card on every render.
  let entityKeysCache: string[] | undefined;
  const entityKeys = () => (entityKeysCache ??= Object.keys(entities || {}));
  const read = (entityId: string) => entities?.[entityId];

  // Use area_id (like dining room) so rooftop doors show regardless of area display name
  const isRooftop = area.area_id === 'rooftop' || areaNameNormalized === 'rooftop';

  // Fused "feel" sensor (AppDaemon RoomFeel, per HA area): when its state reads as a number, it
  // wins over the raw-sensor resolution below entirely (which is then skipped) - state is the fused
  // temperature, and its `rh` attribute is the fused humidity. Keyed off area_id, like isRooftop above,
  // because Claudias Room's area_id is still the historical `office`.
  const feelSensorId = roomFeelSensorId(area.area_id);
  const feelEntity = feelSensorId ? entities?.[feelSensorId] : undefined;
  const feelAvailable = hasReading(feelEntity);
  const feelTempNumber = Number(feelEntity?.state);
  const hasFeelTemp = feelAvailable && Number.isFinite(feelTempNumber);
  const feelRhNumber = Number(feelEntity?.attributes?.rh);
  const hasFeelRh = hasFeelTemp && Number.isFinite(feelRhNumber);

  // Find temperature sensor for this area
  // Priority: 1) sensor.{area}_temperature 2) climate.{area}_thermostat current_temp 3) generic search (exclude floor)
  const climateSensorId = `climate.${areaNameNormalized}_thermostat`;
  const climateEntity = entities?.[climateSensorId];

  const isKitchen = areaNameNormalized === 'kitchen';

  const getTempSensor = (): string | undefined => {
    if (isRooftop) return 'sensor.gw2000a_outdoor_temperature';
    if (isKitchen) return hasReading(entities?.[KITCHEN_TEMP_SENSOR]) ? KITCHEN_TEMP_SENSOR : undefined;

    // Try exact sensor.{area}_temperature first - but only if it actually READS. A sensor
    // that exists with no value used to win this priority and block the fallbacks below,
    // so the card printed a literal "unknown°C" (Claudias Room, 2026-08-17: its template
    // sensor mirrors a Salus thermostat that drops off the RF link, and the room's own
    // mmWave sensor - which the fallback search finds - was sitting right there with a
    // good reading). Existence is not a reading.
    const exactSensor = `sensor.${areaNameNormalized}_temperature`;
    if (hasReading(entities?.[exactSensor])) return exactSensor;

    // Try climate entity's current_temperature (return special marker)
    if (climateEntity?.attributes?.current_temperature) return '__climate__';

    // Fallback: search but exclude floor thermometers (floor mass lags room air)
    return entityKeys().find(
      key =>
        key.includes('temperature') &&
        !key.includes('floor') &&
        hasReading(entities[key]) &&
        (String(entities[key]?.attributes?.friendly_name ?? '')
          .toLowerCase()
          .includes(areaName) ||
          key.toLowerCase().includes(areaNameNormalized))
    );
  };
  // The feel sensor, when it reads, replaces the raw sensors entirely (see rawTemp below), so skip searching for them.
  const tempSensor = hasFeelTemp ? undefined : getTempSensor();

  // Find humidity sensor for this area.
  // Prefer the exact sensor.{area}_humidity; otherwise fall back to a guarded search that
  // excludes absolute humidity (g/m³) and only accepts a real percentage sensor — otherwise
  // the loose match could grab e.g. sensor.{area}_absolute_humidity and print g/m³ as "%".
  const exactHumiditySensor = `sensor.${areaNameNormalized}_humidity`;
  const humiditySensor = hasFeelTemp
    ? undefined
    : isRooftop
      ? 'sensor.gw2000a_humidity'
      : isKitchen
        ? (resolveKitchenHumiditySensorId(entities) ?? undefined)
        : hasReading(entities?.[exactHumiditySensor])
          ? exactHumiditySensor
          : entityKeys().find(
              key =>
                key.includes('humidity') &&
                !key.includes('absolute') &&
                !key.includes('floor') &&
                hasReading(entities[key]) &&
                entities[key]?.attributes?.unit_of_measurement === '%' &&
                (String(entities[key]?.attributes?.friendly_name ?? '')
                  .toLowerCase()
                  .includes(areaName) ||
                  key.toLowerCase().includes(areaNameNormalized))
            );

  // Get temperature value - the fused feel sensor above wins when readable; otherwise handle
  // the climate entity special case. The selectors above already skip dead sensors, but a
  // sensor can go unavailable AFTER selection (and the rooftop / __climate__ paths bypass the
  // selectors entirely), so the value is re-checked here: the card shows "—" rather than the
  // words "unknown" / "unavailable".
  const rawTemp = hasFeelTemp
    ? feelEntity?.state
    : tempSensor === '__climate__'
      ? climateEntity?.attributes?.current_temperature
      : tempSensor
        ? entities[tempSensor]?.state
        : null;
  const tempIsReadable = hasFeelTemp || typeof rawTemp === 'number' || hasReading({ state: rawTemp as string | undefined });
  const temp = tempIsReadable ? (typeof rawTemp === 'number' ? rawTemp : String(rawTemp)) : null;
  const rawHumidity = hasFeelTemp ? (hasFeelRh ? Math.round(feelRhNumber) : null) : humiditySensor ? entities[humiditySensor]?.state : null;
  const humidity = rawHumidity != null && hasReading({ state: String(rawHumidity) }) ? String(rawHumidity) : null;

  // Surfaces: sleep mode, the lights' glow, occupancy, the speaker, appliances and frost.
  const readState = (entityId: string) => entities?.[entityId]?.state;
  const asleep = asleepAreaIds(readState).has(area.area_id);
  const houseAsleep = HOUSEHOLD.some(member => readState(member.sleepModeEntityId) === 'on');
  const glow = asleep ? null : roomGlow(roomLightIds(area.name).map(read));
  const isOccupied = entities?.[`binary_sensor.${areaNameNormalized}_active`]?.state === 'on';
  const { entity: mediaPlayer } = resolvePreferredMediaPlayer(entities, `media_player.${areaNameNormalized}`);
  const isMediaPlaying = mediaPlayer?.state === 'playing';
  const isMediaMuted = mediaPlayer?.attributes?.is_volume_muted === true;
  const activeAppliances: ActiveAppliance[] = HOME_APPLIANCES.filter(appliance => appliance.areaId === area.area_id)
    .map(appliance => ({ appliance, entity: entities?.[appliance.config.stateEntityId] }))
    .filter(item => ACTIVE_APPLIANCE_STATES.has(item.entity?.state ?? ''));
  const isOpen = isAreaOpen(area.area_id, read);
  // Only while the room is open does the card follow the outdoor temperature, and only as a yes/no.
  const frosty = useHass(s => isOpen && coldOutside(s.entities as HassEntities));

  // Exceptions: the few states the card face still names with an icon.
  const exceptions: Exception[] = [];
  for (const device of isKitchen ? COOKING_DEVICES : []) {
    const watts = readingNumber(entities?.[device.entityId]);
    if (watts == null || watts < COOKING_W) continue;
    exceptions.push({
      key: device.entityId,
      node: (
        <IndicatorWithTimeline
          entityId={device.entityId}
          entities={entities}
          hassUrl={hassUrl}
          className='indicator power running'
          title={`${device.name} running - click for timeline`}
          icon={device.icon}
        />
      ),
    });
  }
  const isHallway = areaNameNormalized === 'hallway';
  const frontDoorId = isHallway ? resolveHallwayDoorSensorId(entities) : null;
  if (frontDoorId && entities?.[frontDoorId]?.state === 'on') {
    exceptions.push({
      key: 'door',
      node: (
        <IndicatorWithTimeline
          entityId={frontDoorId}
          entities={entities}
          hassUrl={hassUrl}
          className='indicator door active'
          title='Apartment door open - click for timeline'
          icon='mdi:door-open'
          modalTitle='Apartment door'
        />
      ),
    });
  }
  const frontLockId = isHallway ? resolveHallwayLockEntityId(entities) : null;
  if (frontLockId && entities?.[frontLockId]?.state === 'unlocked') {
    exceptions.push({
      key: 'lock',
      node: (
        <IndicatorWithTimeline
          entityId={frontLockId}
          entities={entities}
          hassUrl={hassUrl}
          className='indicator lock active'
          title='Apartment unlocked - click for timeline'
          icon='mdi:lock-open-variant'
          modalTitle='Apartment lock'
        />
      ),
    });
  }
  if (isOpen) {
    const contacts = AREA_EXTERIOR_CONTACTS[area.area_id] ?? [];
    const open = contacts.filter(id => entities?.[id]?.state === 'on');
    const className = `indicator window active ${frosty ? 'is-frost' : ''}`;
    const iconFor = (id: string) => (id.includes('door') ? 'mdi:door-open' : 'mdi:window-open');
    exceptions.push({
      key: 'opening',
      node:
        open.length === 0 ? (
          <div className={className} title='Window may be open'>
            <Icon icon='mdi:window-open' />
          </div>
        ) : open.length === 1 && contacts.length === 1 ? (
          <IndicatorWithTimeline
            entityId={open[0]}
            entities={entities}
            hassUrl={hassUrl}
            className={className}
            title='Open - click for timeline'
            icon={iconFor(open[0])}
          />
        ) : (
          <MultiEntitySelector
            entityIds={contacts.filter(id => entities?.[id])}
            entities={entities}
            hassUrl={hassUrl}
            className={className}
            title={`${open.length} open - click to select`}
            icon={iconFor(open[0])}
            label={open.length > 1 ? String(open.length) : undefined}
            entityType={contacts.every(id => id.includes('door')) ? 'door' : 'window'}
          />
        ),
    });
  }
  if (areaNameNormalized === 'bathroom' && entities?.[BATH_PRESENCE]?.state === 'on') {
    exceptions.push({
      key: 'shower',
      node: (
        <IndicatorWithTimeline
          entityId={BATH_PRESENCE}
          entities={entities}
          hassUrl={hassUrl}
          className='indicator water active'
          title='Shower active - click for timeline'
          icon='mdi:shower'
        />
      ),
    });
  }
  const manualOverrideId = `input_boolean.${areaNameNormalized}_lights_manual`;
  if (entities?.[manualOverrideId]?.state === 'on') {
    exceptions.push({
      key: 'manual',
      node: (
        <IndicatorWithTimeline
          entityId={manualOverrideId}
          entities={entities}
          hassUrl={hassUrl}
          className='indicator hold active'
          title='Lights on manual - click for timeline'
          icon='mdi:hand-back-right'
          modalTitle='Manual lights'
        />
      ),
    });
  }
  if (areaNameNormalized === 'bedroom' && entities?.[WAKE_ALARM]?.state === 'on') {
    exceptions.push({
      key: 'alarm',
      node: (
        <IndicatorWithTimeline
          entityId={WAKE_ALARM}
          entities={entities}
          hassUrl={hassUrl}
          className={`indicator alarm active ${asleep ? 'is-asleep' : ''}`}
          title={`Alarm set for ${entities?.[WAKE_ALARM_TIME]?.state ?? 'unknown'} - click for timeline`}
          icon='mdi:alarm'
        />
      ),
    });
  }

  const hasRing = activeAppliances.length > 0;
  const cardClass = [
    'room-card',
    glow ? 'is-lit' : 'is-dark',
    asleep ? 'is-asleep' : '',
    frosty ? 'is-frosty' : '',
    isSelected ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const cardStyle = {
    '--oc': glow ? glow.rgb.join(' ') : PLAIN_ORB,
    '--edge-g': glow ? glow.rgb.join(' ') : PLAIN_ORB,
    '--edge-ga': glow ? glow.alpha : 0,
    '--ex': hasRing ? exceptions.length : Math.min(1, exceptions.length),
  } as CSSProperties;

  return (
    <button className={cardClass} onClick={onClick} style={cardStyle}>
      <GlowLayers glow={glow} />
      {frosty && <i className='room-frost' />}
      {asleep && (
        <>
          <i className='room-star' style={{ left: '62%', top: '22%' }} />
          <i className='room-star' style={{ left: '74%', top: '42%' }} />
          <span className='room-moon'>
            <Icon icon='mdi:moon-waning-crescent' />
          </span>
        </>
      )}
      <span className='room-top'>
        <h3 className='room-name'>{formatName(area.name)}</h3>
        {isMediaPlaying && <Equaliser areaId={area.area_id} muted={isMediaMuted} />}
      </span>
      {/* Not a <button> — the whole card is already one, and buttons can't nest. role="button"
          gives it the same semantics/keyboard behaviour; the ::before pseudo-element in
          RoomGrid.css pads the tap target to >=44px without changing the visible readout. */}
      <span
        className={`room-clim ${frosty ? 'is-cold' : ''}`}
        role={onClimateClick ? 'button' : undefined}
        tabIndex={onClimateClick ? 0 : undefined}
        aria-label={onClimateClick ? `${formatName(area.name)} temperature history` : undefined}
        onClick={
          onClimateClick
            ? e => {
                e.stopPropagation();
                onClimateClick();
              }
            : undefined
        }
        onKeyDown={
          onClimateClick
            ? e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onClimateClick();
                }
              }
            : undefined
        }
      >
        {temp == null && humidity == null && <span className='climate-item'>—</span>}
        {temp != null && <span className='climate-item climate-temp'>{formatTemp(temp)} °C</span>}
        {humidity != null && <span className='climate-item'>{humidity} %</span>}
      </span>
      <span className='room-orb'>
        <Icon icon={area.icon || 'mdi:home'} />
      </span>
      {isHallway && <DoorbellRipple />}
      {exceptions.length > 0 && (
        <span className={`room-ex ${hasRing ? 'is-row' : ''}`}>
          {exceptions.map(exception => (
            <span key={exception.key} className='room-ex-item'>
              {exception.node}
            </span>
          ))}
        </span>
      )}
      {hasRing && <ApplianceRing active={activeAppliances} houseAsleep={houseAsleep} />}
      {isOccupied && !asleep && <BreathingEdge />}
    </button>
  );
}
