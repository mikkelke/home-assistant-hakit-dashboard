import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { attrNum, attrStr } from '../../types';
import {
  AC_THERMOSTAT_ENTITY,
  OUTDOOR_HUMIDITY_SENSOR,
  OUTDOOR_TEMP_SENSOR,
  SLEEP_PLAN_SENSOR,
  SMART_COOLING_ENABLE,
  SMART_COOLING_STATUS_SENSOR,
  isAcDeployed,
  roomThermostat,
} from '../../config/entities';
import { useLocalStorageBoolean } from '../../hooks';
import { deriveRoomFeel } from '../../utils/roomFeel';
import { composeClimateStory, comfortTone } from '../../utils/roomClimateStory';
import { deriveFireSafety, isCooking } from '../../utils/fireSafety';
import { worstAirBand } from '../../utils/airQuality';
import './ClimateCard.css';

// One card per room for "how does it feel, what is the house doing about it, what is the target,
// and the one thing you could do". Replaces the plain Feel card, the kitchen's AirQualityCard and
// the per-room HeatCard mount. Presentation delivers the backend's numbers (sensor.<area>_feel,
// the Salus thermostat, sleep_plan / smart_cooling_status); the only composition done here is
// choosing which clause leads (see utils/roomClimateStory.ts). Its one control is the target.

interface ClimateCardProps {
  entities: HassEntities;
  areaId: string;
  callService: CallServiceFunction | undefined;
  /** Whole-apartment heating season (the Salus master out of "off"). Off-season the heating
   * block stays hidden unless this room's own zone is on - a card must never hide running heat. */
  heatingSeason: boolean;
}

const ZONE_OFF_STATES = new Set(['off', 'unavailable', 'unknown']);
const ACTIVE_COOLING_STATES = new Set(['cooling', 'burping']);
const WRITE_DEBOUNCE_MS = 600;

function readNumber(entities: HassEntities, entityId: string): number | null {
  const value = Number(entities[entityId]?.state);
  return Number.isFinite(value) ? value : null;
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

export function ClimateCard({ entities, areaId, callService, heatingSeason }: ClimateCardProps) {
  const normalizedArea = areaId.toLowerCase().replace(/\s+/g, '_');
  const isBedroom = normalizedArea === 'bedroom';
  const isKitchen = normalizedArea === 'kitchen';

  const feel = useMemo(() => deriveRoomFeel(entities, areaId), [entities, areaId]);
  const fire = useMemo(() => (isKitchen ? deriveFireSafety(entities) : null), [entities, isKitchen]);
  const [expanded, setExpanded] = useLocalStorageBoolean(`climatecard-expanded-${normalizedArea}`, false);

  const thermo = roomThermostat(areaId);
  const thermostat = thermo ? entities[thermo.entityId] : undefined;
  const hvacMode = attrStr(thermostat?.state, 'off');
  const zoneOn = !!thermostat && !ZONE_OFF_STATES.has(hvacMode);
  const hvacAction = attrStr(thermostat?.attributes?.hvac_action);
  const haTarget = attrNum(thermostat?.attributes?.temperature, NaN);
  const minTemp = attrNum(thermostat?.attributes?.min_temp, 15);
  const maxTemp = attrNum(thermostat?.attributes?.max_temp, 25);

  // Optimistic target: {value, base} - shown while HA still reports `base`, dropped the moment
  // HA moves off it (derived during render; no effect-driven setState, per the lint rules).
  const [pending, setPending] = useState<{ value: number; base: number } | null>(null);
  const shownTarget = pending && pending.base === haTarget ? pending.value : haTarget;
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (writeTimer.current) clearTimeout(writeTimer.current);
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
    writeTimer.current = setTimeout(() => {
      call('climate', 'set_temperature', thermo.entityId, { temperature: next });
    }, WRITE_DEBOUNCE_MS);
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
  const outdoorRh = readNumber(entities, OUTDOOR_HUMIDITY_SENSOR);

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
  // own reading with a quiet note - never an error state.
  const thermostatTemp = attrNum(thermostat?.attributes?.current_temperature, NaN);
  const tempC = feel.available && feel.tempC != null ? feel.tempC : Number.isFinite(thermostatTemp) ? thermostatTemp : null;
  const fromThermostat = !(feel.available && feel.tempC != null) && tempC != null;
  if (tempC == null && !thermostat) return null;

  const showHeating = !!thermostat && (heatingSeason || zoneOn);
  const rhShown = feel.available ? feel.rh : attrNum(thermostat?.attributes?.current_humidity, NaN);
  const rh = Number.isFinite(rhShown as number) ? (rhShown as number) : null;
  const tone = comfortTone(feel.comfortWord);
  const heroWord = feel.available ? feel.comfortWord : '';

  return (
    <section className={`climate-card tone-${tone}`} aria-label='Climate'>
      <div className='climate-hero'>
        <div className='climate-hero-line'>
          <span className='climate-temp'>
            {tempC == null ? '—' : tempC.toFixed(1)}
            <span className='climate-temp-unit'>°C</span>
          </span>
          {heroWord && <span className='climate-word'>{heroWord}</span>}
        </div>
        {story.clause && <p className='climate-story'>{story.clause}</p>}
        {story.advice && (
          <p className='climate-advice'>
            <Icon icon='mdi:hand-pointing-right' aria-hidden='true' />
            {story.advice}
          </p>
        )}
        {fromThermostat && <p className='climate-note'>From the thermostat — the room sensor isn't reading</p>}
        {feel.available && feel.stale && <p className='climate-note'>Reading is old</p>}
      </div>

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

      {showHeating && (
        <div className='climate-target'>
          {zoneOn ? (
            <>
              <button
                type='button'
                className='climate-step'
                onClick={() => adjustTarget(-0.5)}
                aria-label='Lower target'
                disabled={!callService || !Number.isFinite(shownTarget)}
              >
                <Icon icon='mdi:minus' />
              </button>
              <div className='climate-target-text'>
                <span className='climate-target-value'>{Number.isFinite(shownTarget) ? `${shownTarget.toFixed(1)}°` : '—'}</span>
                <span className='climate-target-label'>
                  Target{hvacAction === 'heating' ? ' · heating' : ' · holding'}
                  {thermo?.sharedNote ? ` · ${thermo.sharedNote}` : ''}
                </span>
              </div>
              <button
                type='button'
                className='climate-step'
                onClick={() => adjustTarget(0.5)}
                aria-label='Raise target'
                disabled={!callService || !Number.isFinite(shownTarget)}
              >
                <Icon icon='mdi:plus' />
              </button>
            </>
          ) : (
            <div className='climate-target-text climate-target-off'>
              <span className='climate-target-value'>Off</span>
              <span className='climate-target-label'>
                {isBedroom ? 'Heating · kept cool' : 'Heating'}
                {thermo?.sharedNote ? ` · ${thermo.sharedNote}` : ''}
              </span>
            </div>
          )}
          <button type='button' className='climate-zone-toggle' onClick={toggleZone} disabled={!callService}>
            {zoneOn ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      )}

      <button type='button' className='climate-expand' onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
        <span>{expanded ? 'Less' : 'Details'}</span>
        <Icon icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} aria-hidden='true' />
      </button>

      {expanded && (
        <div className='climate-details'>
          <div className='climate-grid'>
            <Stat label='Humidity' value={rh} unit='%' />
            <Stat label='Dew point' value={feel.available ? feel.dewPointC : null} unit='°' digits={1} />
            {feel.available && feel.floorTempC != null && <Stat label='Floor' value={feel.floorTempC} unit='°' digits={1} />}
            {outdoorTempC != null && <Stat label='Outside' value={outdoorTempC} unit='°' digits={1} />}
            {outdoorRh != null && <Stat label='Outside RH' value={outdoorRh} unit='%' />}
            {air && fire && <Stat label='IAQ' value={fire.iaq} />}
            {air && fire && <Stat label='eCO₂' value={fire.eco2} unit='ppm' />}
          </div>
          {feel.available && feel.floorTempC != null && feel.floorSpreadC != null && (
            <p className='climate-detail-note'>
              {feel.floorSpreadC > 0.05
                ? `Floor ${feel.floorSpreadC.toFixed(1)} °C cooler than the air`
                : feel.floorSpreadC < -0.05
                  ? `Floor ${Math.abs(feel.floorSpreadC).toFixed(1)} °C warmer than the air`
                  : 'Floor matches the air'}
            </p>
          )}
          {ac && (ac.verdictTitle || ac.verdictText) && (
            <p className='climate-detail-note climate-detail-verdict'>
              {ac.verdictTitle && <strong>{ac.verdictTitle}.</strong>}
              {ac.verdictTitle && ac.verdictText ? ' ' : ''}
              {ac.verdictText}
            </p>
          )}
          {feel.available && feel.sourceCount > 0 && (
            <p className='climate-detail-note climate-detail-muted'>
              {feel.sourceCount} source{feel.sourceCount === 1 ? '' : 's'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
