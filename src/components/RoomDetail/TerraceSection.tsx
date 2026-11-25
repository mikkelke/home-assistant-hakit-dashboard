import { useCallback, useId, useState, type CSSProperties, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import { HOUSE_UPCOMING_ENTITY, ICE_BATH_SENSOR, OUTDOOR_TEMP_SENSOR } from '../../config/entities';
import {
  CHILL_BANDS,
  CHILL_MAX_AIR_C,
  chillBand,
  compass16,
  formatTemp,
  frostFor,
  iceBathPackedAway,
  iceBathRow,
  iceBathWord,
  terraceReadings,
  terraceSummary,
  windChillC,
} from '../../home/terrace';
import { useLocalStorageBoolean, useModalBackButton, useTouchScrollSlopGuard } from '../../hooks';
import { useNowMs } from '../../hooks/useNowMs';
import type { HassEntities } from '../../types';
import { IceFlake, IceLayers } from '../IceBath/IceBath';
import { TemperatureHistoryChart } from './TemperatureHistoryChart';
import { TerraceChart } from './TerraceChart';
import './TerraceSection.css';

const stopTouch = (event: { stopPropagation: () => void }) => event.stopPropagation();

/** Whether this device keeps the section folded to its summary. A closed room panel resets the open state of some cards;
 * this key is not among them, so the section stays as it was left. */
const COLLAPSED_KEY = 'terrace-collapsed';

/** The Rooftop's terrace: the ice bath's water, the roof station's air and wind, how that air feels coming out of the
 * water, and the week behind the water. Sits under the room's controls; its root is a direct child of the panel's
 * scrolling content so a request to scroll to it can find it. It folds to one line, which this device remembers. The
 * bath's own parts go while it is packed away, and the station's stay for as long as the station has readings.
 * `requested` is the room being opened for this section: when it turns on, the section shows open for that visit,
 * whatever the device keeps, until a tap on the heading folds it. */
export function TerraceSection({
  entities,
  requested = false,
  ref,
}: {
  entities: HassEntities;
  requested?: boolean;
  ref?: Ref<HTMLElement>;
}) {
  const nowMs = useNowMs();
  const bodyId = useId();
  const headerSlop = useTouchScrollSlopGuard();
  const [collapsed, setCollapsed] = useLocalStorageBoolean(COLLAPSED_KEY, false);
  const [openedByRequest, setOpenedByRequest] = useState(requested);
  const [wasRequested, setWasRequested] = useState(requested);
  if (requested !== wasRequested) {
    setWasRequested(requested);
    if (requested) setOpenedByRequest(true);
  }
  const expanded = openedByRequest || !collapsed;
  const [historyOpen, setHistoryOpen] = useState(false);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const { requestClose: requestCloseHistory } = useModalBackButton({
    isOpen: historyOpen,
    onRequestClose: closeHistory,
    historyKey: 'terrace-history',
  });

  const hasWater = !iceBathPackedAway(entities[ICE_BATH_SENSOR], nowMs);
  const { waterC, airC, humidityPct, windMs, gustMs, fromDeg } = terraceReadings(entities);
  const hasStation = entities[OUTDOOR_TEMP_SENSOR] !== undefined && (hasWater || airC != null || humidityPct != null || windMs != null);
  if (!hasWater && !hasStation) return null;

  const iceRow = hasWater ? iceBathRow(entities[HOUSE_UPCOMING_ENTITY]?.attributes, nowMs) : null;

  const windSub = [
    gustMs != null && windMs != null && gustMs > windMs ? `gusts ${Math.round(gustMs * 3.6)}` : null,
    fromDeg != null ? compass16(fromDeg) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // Wind chill only means something in cold air; warmer, the line would say the air feels like the air.
  const chill = airC != null && windMs != null && airC <= CHILL_MAX_AIR_C ? { feelsC: windChillC(airC, windMs * 3.6), airC, windMs } : null;
  const bandIndex = chill ? CHILL_BANDS.findIndex(({ band }) => band === chillBand(chill.feelsC)) : -1;
  const band = bandIndex >= 0 ? CHILL_BANDS[bandIndex] : null;
  const summary = terraceSummary({
    waterC: hasWater ? waterC : null,
    iceLikely: iceRow !== null,
    airC,
    feelsC: chill?.feelsC ?? null,
  });

  const toggle = () => {
    if (headerSlop.consumeBlockClick()) return;
    setOpenedByRequest(false);
    setCollapsed(expanded);
  };

  const chartBody = (
    <>
      <span className='terrace-legend'>
        {hasWater && (
          <span>
            <i className='terrace-legend-water' />
            Water
          </span>
        )}
        <span>
          <i className='terrace-legend-mean' />
          Air, 24 h mean
        </span>
        <span>
          <i className='terrace-legend-air' />
          Air
        </span>
      </span>
      <TerraceChart waterNow={waterC} airNow={airC} showWater={hasWater} />
      {hasWater && <span className='terrace-caption'>{"The water follows the day's mean air with about a day's lag."}</span>}
    </>
  );

  return (
    <section ref={ref} className='terrace' aria-labelledby='terrace-title'>
      <h3 className='terrace-heading'>
        <button
          type='button'
          className='terrace-toggle'
          aria-expanded={expanded}
          aria-controls={expanded ? bodyId : undefined}
          onClick={toggle}
          onTouchStart={headerSlop.onTouchStart}
          onTouchMove={headerSlop.onTouchMove}
          onTouchEnd={headerSlop.onTouchEnd}
          onTouchCancel={headerSlop.onTouchCancel}
        >
          <span id='terrace-title' className='terrace-title'>
            Terrace
          </span>
          <Icon icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} className='terrace-chevron' aria-hidden='true' />
          {!expanded && summary && <span className='terrace-summary'>{summary}</span>}
        </button>
      </h3>
      {expanded && (
        <div id={bodyId} className='terrace-grid' data-water={hasWater ? undefined : 'off'}>
          {hasWater && (
            <div
              className='terrace-hero ice-skin'
              style={{ '--frost': Number((waterC == null ? 0 : frostFor(waterC)).toFixed(2)) } as CSSProperties}
              data-ice={iceRow ? '' : undefined}
            >
              <IceLayers />
              <span className='terrace-hero-label'>
                Ice bath
                {iceRow && (
                  <span className='terrace-badge'>
                    <IceFlake />
                    Ice likely
                  </span>
                )}
              </span>
              <span className='terrace-hero-value'>
                {waterC == null ? (
                  '—'
                ) : (
                  <>
                    {formatTemp(waterC)}
                    <small>°</small>
                  </>
                )}
              </span>
              <span className='terrace-hero-word'>{waterC == null ? 'no reading' : iceBathWord(waterC)}</span>
              {iceRow && <span className='terrace-hero-row'>{iceRow.title.replace(/^Ice bath\s+at\b/i, 'At')}</span>}
            </div>
          )}

          {hasStation && (
            <div className='terrace-after'>
              <div className='terrace-pair'>
                <div className='terrace-fact'>
                  <span className='terrace-fact-label'>
                    <Icon icon='mdi:thermometer' aria-hidden='true' />
                    Air
                  </span>
                  <span className='terrace-fact-value'>{airC == null ? '—' : `${formatTemp(airC)}°`}</span>
                  <span className='terrace-fact-sub'>{humidityPct == null ? '—' : `${Math.round(humidityPct)} %`}</span>
                </div>
                <div className='terrace-fact'>
                  <span className='terrace-fact-label'>
                    <Icon icon='mdi:weather-windy' aria-hidden='true' />
                    Wind
                  </span>
                  <span className='terrace-fact-value'>
                    {windMs == null ? (
                      '—'
                    ) : (
                      <>
                        {Math.round(windMs * 3.6)} <small>km/h</small>
                      </>
                    )}
                  </span>
                  <span className='terrace-fact-sub'>{windSub || '—'}</span>
                </div>
              </div>
              {chill && band && (
                <>
                  <p className='terrace-feels'>
                    {hasWater && <span className='terrace-feels-k'>Out of the water: </span>}
                    {hasWater ? 'air' : 'Air'} {formatTemp(chill.airC)}°, wind {Math.round(chill.windMs * 3.6)} km/h, feels{' '}
                    <b>{formatTemp(chill.feelsC)}°</b>{' '}
                    <span className='terrace-chill' data-band={band.band}>
                      {band.label}
                    </span>
                  </p>
                  <div className='terrace-bar' data-band={band.band} aria-hidden='true'>
                    <div className='terrace-bar-steps'>
                      {CHILL_BANDS.map((step, index) => (
                        <i key={step.band} className={index <= bandIndex ? 'is-on' : undefined} />
                      ))}
                    </div>
                    <div className='terrace-bar-labels'>
                      {CHILL_BANDS.map(step => (
                        <span key={step.band}>{step.range}</span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {hasWater ? (
            <button
              type='button'
              className='terrace-chart'
              aria-haspopup='dialog'
              aria-label='Ice bath history'
              onClick={() => setHistoryOpen(true)}
            >
              {chartBody}
            </button>
          ) : (
            <div className='terrace-chart terrace-chart--still'>{chartBody}</div>
          )}
        </div>
      )}

      {/* MUST be portaled to document.body: the mobile room-detail panel carries a CSS transform, and a
          position:fixed sheet inside it lands a whole viewport away. Touches are kept from the panel's swipe-to-close. */}
      {historyOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className='person-info-overlay'
            role='presentation'
            onClick={() => requestCloseHistory()}
            onMouseDown={e => e.stopPropagation()}
            onTouchStart={stopTouch}
            onTouchMove={stopTouch}
            onTouchEnd={stopTouch}
          >
            <div
              className='person-info-modal person-timeline-modal'
              role='dialog'
              aria-label='Ice bath history'
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
            >
              <div className='modal-header'>
                <span className='modal-title'>Ice bath</span>
                <button className='modal-close' onClick={() => requestCloseHistory()} aria-label='Close'>
                  <Icon icon='mdi:close' />
                </button>
              </div>
              <div className='modal-timeline-content'>
                <TemperatureHistoryChart
                  roomSensorId={ICE_BATH_SENSOR}
                  outdoorSensorId={OUTDOOR_TEMP_SENSOR}
                  historyEntityId={null}
                  historyAttribute={null}
                  toneColor='var(--accent-sky)'
                  label='Ice bath'
                  roomNow={waterC}
                  outdoorNow={airC}
                />
              </div>
            </div>
          </div>,
          document.body
        )}
    </section>
  );
}
