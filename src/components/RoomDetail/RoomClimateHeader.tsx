import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { attrStr } from '../../types';
import {
  AC_THERMOSTAT_ENTITY,
  OUTDOOR_TEMP_SENSOR,
  SLEEP_PLAN_SENSOR,
  SMART_COOLING_ENABLE,
  SMART_COOLING_STATUS_SENSOR,
  isAcDeployed,
  roomFeelSensorId,
  roomThermostat,
} from '../../config/entities';
import { deriveRoomFeel } from '../../utils/roomFeel';
import { composeClimateStory, comfortTone } from '../../utils/roomClimateStory';
import { deriveFireSafety, isCooking } from '../../utils/fireSafety';
import { worstAirBand } from '../../utils/airQuality';
import { ApplianceSheet } from '../Appliance';
import { TemperatureHistoryChart } from './TemperatureHistoryChart';
import '../Appliance/Appliance.css';
import './RoomClimateHeader.css';

// The room's climate reduced to one always-visible line ("23.3 °C  comfortable  Window open")
// that opens the full picture in a bottom sheet: the sensor fusion (utils/roomFeel), which one
// clause leads (utils/roomClimateStory), and the heating target - the header's only control.
// Kept as one component with the old ClimateCard's entity derivation rather than a new hook.

interface RoomClimateHeaderProps {
  roomName: string;
  entities: HassEntities;
  areaId: string;
  callService: CallServiceFunction | undefined;
  /** Whole-apartment heating season (the Salus master out of "off"). Off-season the stepper stays
   * hidden unless this room's own zone is on or actually heating - a header must never hide
   * running heat. */
  heatingSeason: boolean;
  /** True for the render where the sheet should open itself (room-card temperature/humidity tap,
   * or a `#room=<id>&climate=1` deep link) - see RoomDetail/Dashboard. */
  autoOpen?: boolean;
  onAutoOpenHandled?: () => void;
}

const ZONE_OFF_STATES = new Set(['off', 'unavailable', 'unknown']);
const ACTIVE_COOLING_STATES = new Set(['cooling', 'burping']);
const WRITE_DEBOUNCE_MS = 600;
const ACK_TIMEOUT_MS = 8000;

function readNumber(entities: HassEntities, entityId: string): number | null {
  const value = Number(entities[entityId]?.state);
  return Number.isFinite(value) ? value : null;
}

/** Unlike `attrNum`, never coerces a missing/empty value to 0 - for targets and fallback
 * temperatures a missing reading must stay unknown, not become a plausible-looking zero. */
function strictNum(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** ISO datetime or bare "HH:MM[:SS]" -> "HH:MM" for the story line. */
function clockOf(raw: unknown): string | null {
  const s = attrStr(raw).trim();
  if (!s) return null;
  const bare = /^(\d{1,2}):(\d{2})/.exec(s);
  if (bare) return `${bare[1].padStart(2, '0')}:${bare[2]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Stat({ label, value, unit, digits = 0 }: { label: string; value: number | null; unit?: string; digits?: number }) {
  return (
    <div className='climate-stat'>
      <span className='climate-stat-value'>
        {value == null ? '—' : value.toFixed(digits)}
        {value != null && unit && <span className='climate-stat-unit'>{unit}</span>}
      </span>
      <span className='climate-stat-label'>{label}</span>
    </div>
  );
}

export function RoomClimateHeader({
  roomName,
  entities,
  areaId,
  callService,
  heatingSeason,
  autoOpen,
  onAutoOpenHandled,
}: RoomClimateHeaderProps) {
  const normalizedArea = areaId.toLowerCase().replace(/\s+/g, '_');
  const isBedroom = normalizedArea === 'bedroom';
  const isKitchen = normalizedArea === 'kitchen';

  const feel = useMemo(() => deriveRoomFeel(entities, areaId), [entities, areaId]);
  const fire = useMemo(() => (isKitchen ? deriveFireSafety(entities) : null), [entities, isKitchen]);
  const [open, setOpen] = useState(false);
  const closeSheet = useCallback(() => setOpen(false), []);

  // One-shot: opens the sheet on mount (handles the lazy RoomDetail case, since `key={area.area_id}`
  // remounts this whenever the room changes) and also on a later true->true-again transition while
  // already mounted (same room, a second climate tap). Reported back so Dashboard clears the flag -
  // otherwise a manual close+reopen of the same room would force the sheet back open.
  useEffect(() => {
    if (autoOpen) {
      setOpen(true);
      onAutoOpenHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onAutoOpenHandled is re-created each render; only autoOpen's edge matters here
  }, [autoOpen]);

  const feelSensorId = roomFeelSensorId(areaId);
  const temperatureHistorySensorId = feelSensorId && entities[feelSensorId] ? feelSensorId : null;

  const thermo = roomThermostat(areaId);
  const thermostat = thermo ? entities[thermo.entityId] : undefined;
  const hvacMode = attrStr(thermostat?.state, 'off');
  const zoneOn = !!thermostat && !ZONE_OFF_STATES.has(hvacMode);
  const hvacAction = attrStr(thermostat?.attributes?.hvac_action);
  const haTarget = strictNum(thermostat?.attributes?.temperature) ?? NaN;
  const minTemp = strictNum(thermostat?.attributes?.min_temp) ?? 15;
  const maxTemp = strictNum(thermostat?.attributes?.max_temp) ?? 25;

  // Optimistic target: {value, base, ts} - shown for up to ACK_TIMEOUT_MS while HA still reports
  // `base`, then reverted to whatever HA actually holds. Kept in this always-mounted header (not
  // the sheet) so closing the sheet never cancels a pending write.
  const [pending, setPending] = useState<{ value: number; base: number } | null>(null);
  const waitingForThermostat = pending != null && pending.base === haTarget;
  const shownTarget = waitingForThermostat ? pending.value : haTarget;
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (writeTimer.current) clearTimeout(writeTimer.current);
      if (ackTimer.current) clearTimeout(ackTimer.current);
    },
    []
  );

  const call = useCallback(
    (domain: string, service: string, entityId: string, serviceData?: Record<string, unknown>) => {
      callService?.({ domain, service, target: { entity_id: entityId }, serviceData });
    },
    [callService]
  );

  const adjustTarget = (delta: number) => {
    if (!thermo || !Number.isFinite(shownTarget)) return;
    const next = Math.min(maxTemp, Math.max(minTemp, Math.round((shownTarget + delta) * 2) / 2));
    setPending({ value: next, base: haTarget });
    if (writeTimer.current) clearTimeout(writeTimer.current);
    if (ackTimer.current) clearTimeout(ackTimer.current);
    writeTimer.current = setTimeout(() => {
      call('climate', 'set_temperature', thermo.entityId, { temperature: next });
    }, WRITE_DEBOUNCE_MS);
    ackTimer.current = setTimeout(() => setPending(null), ACK_TIMEOUT_MS);
  };

  const toggleZone = () => {
    if (!thermo) return;
    call('climate', 'set_hvac_mode', thermo.entityId, { hvac_mode: zoneOn ? 'off' : 'heat' });
  };

  // Bedroom A/C: read-only fold of the essential state; the Tonight card below keeps the controls.
  const ac = useMemo(() => {
    if (!isBedroom) return null;
    const status = entities[SMART_COOLING_STATUS_SENSOR];
    const statusAttrs = (status?.attributes ?? {}) as Record<string, unknown>;
    const plan = entities[SLEEP_PLAN_SENSOR];
    const planAttrs = (plan?.attributes ?? {}) as Record<string, unknown>;
    const unit = entities[AC_THERMOSTAT_ENTITY];
    const cooling = ACTIVE_COOLING_STATES.has(status?.state ?? '') || attrStr(unit?.attributes?.hvac_action) === 'cooling';
    return {
      deployed: isAcDeployed(entities),
      cooling,
      armed: entities[SMART_COOLING_ENABLE]?.state === 'on',
      nextStart: clockOf(statusAttrs.next_start),
      rec: plan?.state ?? '',
      verdictTitle: attrStr(planAttrs.verdict_title),
      verdictText: attrStr(planAttrs.verdict_text),
    };
  }, [entities, isBedroom]);

  const air = useMemo(
    () => (fire && fire.present ? { band: worstAirBand(fire.iaqBand, fire.eco2Band), cooking: isCooking(fire) } : null),
    [fire]
  );
  const outdoorTempC = readNumber(entities, OUTDOOR_TEMP_SENSOR);

  const story = useMemo(
    () =>
      composeClimateStory({
        feel,
        outdoorTempC,
        heating: { present: !!thermostat, zoneOn, action: hvacAction },
        ac,
        air,
      }),
    [feel, outdoorTempC, thermostat, zoneOn, hvacAction, ac, air]
  );

  // Temperature: the fused feel wins; an absent/unavailable feel falls back to the thermostat's
  // own reading with a quiet note in the sheet - never an error state.
  const thermostatTemp = strictNum(thermostat?.attributes?.current_temperature);
  const tempC = feel.available && feel.tempC != null ? feel.tempC : thermostatTemp;
  const fromThermostat = !(feel.available && feel.tempC != null) && tempC != null;

  if (!feel.present && !thermostat) return null;

  const knownZone = !!thermostat && !['unknown', 'unavailable', ''].includes(hvacMode);
  const canAdjust = !!callService && knownZone && Number.isFinite(shownTarget);
  const showHeating = !!thermostat && (heatingSeason || zoneOn || hvacAction === 'heating');
  const rhShown = feel.available ? feel.rh : strictNum(thermostat?.attributes?.current_humidity);
  const rh = rhShown ?? null;
  const tone = comfortTone(feel.comfortWord);
  const heroWord = feel.available ? feel.comfortWord : '';
  const word = tempC == null ? 'Unavailable' : feel.stale ? 'Reading old' : heroWord;
  const brief = story.shortClause;

  const isUnavailable = tempC == null;
  const isStale = !isUnavailable && feel.stale;
  const chipMuted = isUnavailable || isStale;
  const chipIcon = isUnavailable ? 'mdi:thermometer' : isStale ? 'mdi:clock-outline' : story.icon;
  const chipTemp = isUnavailable ? '—°' : `${tempC.toFixed(1)}°`;

  const floorNote =
    feel.floorSpreadC == null
      ? null
      : Math.abs(feel.floorSpreadC) <= 0.05
        ? 'Floor matches the air'
        : `Floor ${Math.abs(feel.floorSpreadC).toFixed(1)} °C ${feel.floorSpreadC > 0 ? 'cooler' : 'warmer'} than the air`;

  return (
    <div
      className={`room-climate tone-${tone}`}
      onTouchStart={e => e.stopPropagation()}
      onTouchMove={e => e.stopPropagation()}
      onTouchEnd={e => e.stopPropagation()}
    >
      <button
        type='button'
        className={`room-climate-chip ${chipMuted ? 'is-muted' : ''}`}
        aria-haspopup='dialog'
        aria-expanded={open}
        aria-label={`${roomName} climate: ${
          tempC == null ? 'temperature unavailable' : `${tempC.toFixed(1)} degrees Celsius`
        }${word ? `, ${word}` : ''}${brief ? `, ${brief}` : ''}. Open controls and details`}
        onClick={() => setOpen(true)}
      >
        <Icon className='room-climate-chip-icon' icon={chipIcon} aria-hidden='true' />
        <span className='room-climate-chip-temp'>{chipTemp}</span>
      </button>

      {open && (
        <ApplianceSheet
          accentClassName={`climate-sheet tone-${tone}`}
          glyphIcon='mdi:thermometer'
          title={`${roomName} climate`}
          historyKey={`room-climate-${normalizedArea}`}
          onClose={closeSheet}
        >
          <div className='climate-scroll' tabIndex={0} role='region' aria-label='Climate details'>
            <TemperatureHistoryChart
              roomSensorId={temperatureHistorySensorId}
              outdoorSensorId={entities[OUTDOOR_TEMP_SENSOR] ? OUTDOOR_TEMP_SENSOR : null}
              historyEntityId={feel.historyEntity}
              historyAttribute={feel.historyAttribute}
              toneColor='var(--tone)'
              roomNow={tempC}
              outdoorNow={outdoorTempC}
            />
            {story.clause && <p className='climate-full-story'>{story.clause}</p>}
            {story.advice && <p className='climate-detail-note'>{story.advice}</p>}
            {story.chips.length > 0 && (
              <div className='climate-chips'>
                {story.chips.map(chip => (
                  <span key={chip.id} className={`climate-chip chip-${chip.tone}`}>
                    <Icon icon={chip.icon} aria-hidden='true' />
                    {chip.label}
                  </span>
                ))}
              </div>
            )}
            <div className='climate-grid'>
              <Stat label='Humidity' value={rh} unit='%' />
              <Stat label='Dew point' value={feel.available ? feel.dewPointC : null} unit='°C' digits={1} />
              <Stat label='Floor' value={feel.available ? feel.floorTempC : null} unit='°C' digits={1} />
              <Stat label='Outside' value={outdoorTempC} unit='°C' digits={1} />
              {air && fire && (
                <>
                  <Stat label='Air quality index' value={fire.iaq} />
                  <Stat label='Estimated CO₂' value={fire.eco2} unit='ppm' />
                </>
              )}
            </div>
            {floorNote && <p className='climate-detail-note'>{floorNote}</p>}
            {ac && (ac.verdictTitle || ac.verdictText) && (
              <p className='climate-detail-note'>
                {ac.verdictTitle && <strong>{ac.verdictTitle}. </strong>}
                {ac.verdictText}
              </p>
            )}
            {fromThermostat && <p className='climate-detail-note'>Temperature from the thermostat; the room sensor isn't reading.</p>}
            {feel.available && feel.stale && <p className='climate-detail-note'>Reading is old. Conditions may have changed.</p>}
            {tempC == null && <p className='climate-detail-note'>Room temperature is unavailable.</p>}
          </div>

          {showHeating && (
            <footer className='climate-controls'>
              <div className='climate-control-heading'>
                <strong>Heating target</strong>
                <button type='button' className='climate-zone-toggle' disabled={!callService || !knownZone} onClick={toggleZone}>
                  {zoneOn ? 'Turn off' : 'Turn on'}
                </button>
              </div>
              {thermo?.sharedNote && <p className='climate-shared'>{thermo.sharedNote}</p>}
              <div className='climate-stepper'>
                <button
                  type='button'
                  className='climate-step'
                  aria-label='Lower heating target by 0.5 degrees Celsius'
                  disabled={!canAdjust || shownTarget <= minTemp}
                  onClick={() => adjustTarget(-0.5)}
                >
                  <Icon icon='mdi:minus' aria-hidden='true' />
                </button>
                <div className='climate-target-text'>
                  <output className='climate-target-value' aria-live='polite'>
                    {Number.isFinite(shownTarget) ? `${shownTarget.toFixed(1)} °C` : '—'}
                  </output>
                  <span className='climate-target-label'>
                    {waitingForThermostat
                      ? 'Waiting for thermostat'
                      : !knownZone
                        ? 'Unavailable'
                        : !zoneOn
                          ? isBedroom
                            ? 'Heating · kept cool'
                            : 'Heating off'
                          : hvacAction === 'heating'
                            ? 'Heating'
                            : 'Heating enabled'}
                  </span>
                </div>
                <button
                  type='button'
                  className='climate-step'
                  aria-label='Raise heating target by 0.5 degrees Celsius'
                  disabled={!canAdjust || shownTarget >= maxTemp}
                  onClick={() => adjustTarget(0.5)}
                >
                  <Icon icon='mdi:plus' aria-hidden='true' />
                </button>
              </div>
            </footer>
          )}
        </ApplianceSheet>
      )}
    </div>
  );
}
