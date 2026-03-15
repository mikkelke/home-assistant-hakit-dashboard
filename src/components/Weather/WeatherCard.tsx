import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import type { HassEntities, HassEntity, CallServiceFunction } from '../../types';
import { Timeline } from '../Timeline';
import './WeatherCard.css';

interface WeatherCardProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined; // unused, kept for parity
  hassUrl: string | null;
}

interface WeatherItemWithTimelineProps {
  entityId: string;
  entities: HassEntities;
  hassUrl: string | null;
  icon: string;
  label: string;
  value: string;
  valueClass?: string;
  childrenFirst?: boolean; // Render children before value (for items like UV, Lux)
  children?: React.ReactNode;
}

// Safe getter helpers
const getState = (entities: HassEntities, id: string) => entities?.[id]?.state;
const withUnit = (val?: string | number, unit?: string) => (val === undefined || val === null || val === '' ? '—' : `${val}${unit ?? ''}`);

const getDirectionLabel = (deg?: number) => {
  if (deg === undefined || Number.isNaN(deg)) return '—';
  const dir = ((deg % 360) + 360) % 360; // normalize
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(dir / 45) % 8;
  return labels[index];
};

// Temperature buckets (mimic Danish context)
// <=0 freezing, 0-5 chilly, 5-15 mild, 15-25 warm, >25 hot
const getTempLevel = (value?: string | number) => {
  if (value === undefined || value === null || value === '') return 'none';
  const t = Number(value);
  if (Number.isNaN(t)) return 'none';
  if (t > 25) return 'hot';
  if (t > 15) return 'warm';
  if (t > 5) return 'mild';
  if (t > 0) return 'chilly';
  return 'freeze';
};

const getWindLevel = (valueMs?: string | number) => {
  if (valueMs === undefined || valueMs === null || valueMs === '') return 'none';
  const w = Number(valueMs);
  if (Number.isNaN(w)) return 'none';
  // Beaufort-inspired bands (m/s)
  if (w >= 24.5) return 'b10';
  if (w >= 20.8) return 'b9';
  if (w >= 17.2) return 'b8';
  if (w >= 13.9) return 'b7';
  if (w >= 10.8) return 'b6';
  if (w >= 8.0) return 'b5';
  if (w >= 5.5) return 'b4';
  if (w >= 3.4) return 'b3';
  if (w >= 1.6) return 'b2';
  if (w >= 0.3) return 'b1';
  return 'b0';
};

// Rain intensity based on DMI guidance (mm/h)
// cloudburst ~30 mm/h, heavy >10, significant >4, light >1
const getRainLevel = (value?: string | number) => {
  if (value === undefined || value === null || value === '') return 'none';
  const r = Number(value);
  if (Number.isNaN(r)) return 'none';
  if (r >= 30) return 'cloudburst';
  if (r >= 10) return 'heavy';
  if (r >= 4) return 'significant';
  if (r >= 1) return 'light';
  return 'none';
};

// Normalize a numeric value to 0-100 for simple bars
const toPercent = (value: string | number | undefined, min: number, max: number) => {
  if (value === undefined || value === null || value === '') return 0;
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  const clamped = Math.min(Math.max(num, min), max);
  return Math.round(((clamped - min) / (max - min)) * 100);
};

// Weather item with timeline support (no history API – avoids embed/popstate closing the modal)
function WeatherItemWithTimeline({
  entityId,
  entities,
  hassUrl,
  icon,
  label,
  value,
  valueClass,
  childrenFirst,
  children,
}: WeatherItemWithTimelineProps) {
  const [showTimeline, setShowTimeline] = useState(false);
  const timelineOpenedAt = useRef<number>(0);
  const entity = entities[entityId];

  useEffect(() => {
    if (showTimeline) {
      document.body.classList.add('modal-open');
      return () => {
        document.body.classList.remove('modal-open');
      };
    }
  }, [showTimeline]);

  const openPanel = () => {
    timelineOpenedAt.current = Date.now();
    setShowTimeline(true);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    openPanel();
  };

  const handleClose = (e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setShowTimeline(false);
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (Date.now() - timelineOpenedAt.current < 500) return;
    handleClose();
  };

  const handleModalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  // Format entity name for modal title (entity can be briefly undefined when HA state updates after Timeline fetch)
  const entityName = typeof entity?.attributes?.friendly_name === 'string' ? entity.attributes.friendly_name : label;

  const modalContent = showTimeline ? (
    <div className='person-info-overlay' role='presentation' onClick={handleOverlayClick} onMouseDown={e => e.stopPropagation()}>
      <div
        className='person-info-modal person-timeline-modal'
        role='dialog'
        aria-label={`${entityName} timeline`}
        onClick={handleModalClick}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className='modal-header'>
          <span className='modal-title'>{entityName}</span>
          <button className='modal-close' onClick={handleClose} onMouseDown={e => e.stopPropagation()}>
            <Icon icon='mdi:close' />
          </button>
        </div>
        <div className='modal-timeline-content'>
          <Timeline
            entityId={entityId}
            entity={entity ?? ({ entity_id: entityId, state: '', attributes: {} } as HassEntity)}
            hassUrl={hassUrl}
            hours={168}
            limit={100}
          />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div
        className='weather-item weather-item-clickable'
        role='button'
        tabIndex={0}
        onClick={handleClick}
        onTouchEnd={e => {
          e.preventDefault();
          openPanel();
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPanel();
          }
        }}
        style={{ cursor: 'pointer' }}
      >
        <div className='label-row'>
          <Icon icon={icon} />
          <span className='label'>{label}</span>
        </div>
        {childrenFirst ? (
          <>
            {children}
            <span className={valueClass ? `value ${valueClass}` : 'value'}>{value}</span>
          </>
        ) : (
          <>
            <span className={valueClass ? `value ${valueClass}` : 'value'}>{value}</span>
            {children}
          </>
        )}
      </div>
      {typeof document !== 'undefined' && createPortal(modalContent, document.body)}
    </>
  );
}

export function WeatherCard({ entities, hassUrl }: WeatherCardProps) {
  // Key sensors
  const temp = getState(entities, 'sensor.gw2000a_outdoor_temperature');
  const feelsLike = getState(entities, 'sensor.gw2000a_feels_like_temperature');
  const humidity = getState(entities, 'sensor.gw2000a_humidity');
  const dewpoint = getState(entities, 'sensor.gw2000a_dewpoint');

  const wind = getState(entities, 'sensor.gw2000a_wind_speed');
  const gust = getState(entities, 'sensor.gw2000a_wind_gust');
  const windDir = getState(entities, 'sensor.gw2000a_wind_direction');
  const windDirNum = windDir ? Number(windDir) : 0;
  const windDirLabel = getDirectionLabel(windDirNum);

  const rainRate = getState(entities, 'sensor.gw2000a_rain_rate_piezo');
  const rainDaily = getState(entities, 'sensor.gw2000a_daily_rain_piezo');
  const rain24h = getState(entities, 'sensor.gw2000a_24h_rain_piezo');

  const uv = getState(entities, 'sensor.gw2000a_uv_index');
  const lux = getState(entities, 'sensor.gw2000a_solar_lux');
  const irradiance = getState(entities, 'sensor.gw2000a_solar_radiation');

  const pressure = getState(entities, 'sensor.gw2000a_relative_pressure') ?? getState(entities, 'sensor.gw2000a_absolute_pressure');

  // Percent values for quick visual bars
  // Convert wind/gust from km/h to m/s (sensors report km/h)
  const windMs = wind ? Number(wind) / 3.6 : undefined;
  const gustMs = gust ? Number(gust) / 3.6 : undefined;

  const tempPct = toPercent(temp, -10, 35);
  const feelsPct = toPercent(feelsLike, -10, 35);
  const humidityPct = toPercent(humidity, 0, 100);
  const windPct = toPercent(windMs, 0, 35); // cap around strong gale
  const gustPct = toPercent(gustMs, 0, 35);
  const tempLevel = getTempLevel(temp);
  const feelsLevel = getTempLevel(feelsLike);
  const windLevel = getWindLevel(windMs);
  const gustLevel = getWindLevel(gustMs);
  const rainLevel = getRainLevel(rainRate);

  // Render even if partial data exists
  const hasAny = temp || feelsLike || humidity || wind || gust || rainRate || rainDaily || uv || lux || irradiance || pressure;

  if (!hasAny) return null;

  return (
    <div className='weather-card'>
      <div className='weather-header'>
        <div className='weather-header-left'>
          <Icon icon='mdi:weather-cloudy' />
          <div className='weather-titles'>
            <span className='weather-title'>Weather</span>
          </div>
        </div>
      </div>

      <div className='weather-grid'>
        <WeatherItemWithTimeline
          entityId='sensor.gw2000a_outdoor_temperature'
          entities={entities}
          hassUrl={hassUrl}
          icon='mdi:thermometer'
          label='Temp'
          value={withUnit(temp, '°C')}
        >
          <div className='metric-bar'>
            <div className={`metric-fill temp ${tempLevel}`} style={{ width: `${tempPct}%` }} />
          </div>
        </WeatherItemWithTimeline>

        <WeatherItemWithTimeline
          entityId='sensor.gw2000a_feels_like_temperature'
          entities={entities}
          hassUrl={hassUrl}
          icon='mdi:thermometer-low'
          label='Feels'
          value={withUnit(feelsLike, '°C')}
        >
          <div className='metric-bar'>
            <div className={`metric-fill temp ${feelsLevel}`} style={{ width: `${feelsPct}%` }} />
          </div>
        </WeatherItemWithTimeline>

        <WeatherItemWithTimeline
          entityId='sensor.gw2000a_humidity'
          entities={entities}
          hassUrl={hassUrl}
          icon='mdi:water-percent'
          label='Humidity'
          value={withUnit(humidity, '%')}
        >
          <div className='metric-bar'>
            <div className='metric-fill humidity' style={{ width: `${humidityPct}%` }} />
          </div>
        </WeatherItemWithTimeline>

        <WeatherItemWithTimeline
          entityId='sensor.gw2000a_dewpoint'
          entities={entities}
          hassUrl={hassUrl}
          icon='mdi:weather-fog'
          label='Dewpoint'
          value={withUnit(dewpoint, '°C')}
        />

        <WeatherItemWithTimeline
          entityId='sensor.gw2000a_wind_speed'
          entities={entities}
          hassUrl={hassUrl}
          icon='mdi:weather-windy'
          label='Wind'
          value={windMs !== undefined ? `${windMs.toFixed(1)} m/s` : '—'}
        >
          <div className='metric-bar'>
            <div className={`metric-fill wind ${windLevel}`} style={{ width: `${windPct}%` }} />
          </div>
        </WeatherItemWithTimeline>

        <WeatherItemWithTimeline
          entityId='sensor.gw2000a_wind_gust'
          entities={entities}
          hassUrl={hassUrl}
          icon='mdi:weather-windy-variant'
          label='Gust'
          value={gustMs !== undefined ? `${gustMs.toFixed(1)} m/s` : '—'}
        >
          <div className='metric-bar'>
            <div className={`metric-fill wind ${gustLevel}`} style={{ width: `${gustPct}%` }} />
          </div>
        </WeatherItemWithTimeline>

        <WeatherItemWithTimeline
          entityId='sensor.gw2000a_wind_direction'
          entities={entities}
          hassUrl={hassUrl}
          icon='mdi:compass'
          label='Direction'
          value=''
        >
          <div className='compass-row'>
            <span className='compass-direction'>{windDirLabel}</span>
            <div className='compass-rose-small'>
              <span className='c-label c-n'>N</span>
              <span className='c-label c-e'>E</span>
              <span className='c-label c-s'>S</span>
              <span className='c-label c-w'>W</span>
              <div className='compass-arrow-wrapper' style={{ transform: `rotate(${windDirNum}deg)` }} title={withUnit(windDir, '°')}>
                <div className='compass-arrow' />
              </div>
              <div className='compass-center' />
            </div>
          </div>
        </WeatherItemWithTimeline>

        <WeatherItemWithTimeline
          entityId='sensor.gw2000a_rain_rate_piezo'
          entities={entities}
          hassUrl={hassUrl}
          icon='mdi:weather-pouring'
          label='Rain rate'
          value={withUnit(rainRate, ' mm/h')}
        >
          <div className='metric-bar'>
            <div className={`metric-fill rain ${rainLevel}`} style={{ width: `${toPercent(rainRate, 0, 30)}%` }} />
          </div>
        </WeatherItemWithTimeline>

        <WeatherItemWithTimeline
          entityId='sensor.gw2000a_daily_rain_piezo'
          entities={entities}
          hassUrl={hassUrl}
          icon='mdi:weather-rainy'
          label='Rain daily'
          value={withUnit(rainDaily, ' mm')}
        />

        <WeatherItemWithTimeline
          entityId='sensor.gw2000a_24h_rain_piezo'
          entities={entities}
          hassUrl={hassUrl}
          icon='mdi:clock-time-four-outline'
          label='Rain 24h'
          value={withUnit(rain24h, ' mm')}
        />

        <WeatherItemWithTimeline
          entityId='sensor.gw2000a_uv_index'
          entities={entities}
          hassUrl={hassUrl}
          icon='mdi:weather-sunny-alert'
          label='UV'
          value={withUnit(uv, '')}
          valueClass='subtle'
          childrenFirst
        >
          <div className='bar'>
            <div className='bar-fill uv' style={{ width: `${Math.min(Number(uv ?? 0) * 10, 100)}%` }} />
          </div>
        </WeatherItemWithTimeline>

        <WeatherItemWithTimeline
          entityId='sensor.gw2000a_solar_lux'
          entities={entities}
          hassUrl={hassUrl}
          icon='mdi:weather-sunny'
          label='Lux'
          value={withUnit(lux, ' lx')}
          valueClass='subtle'
          childrenFirst
        >
          <div className='bar'>
            <div className='bar-fill lux' style={{ width: `${Math.min((Number(lux ?? 0) / 100000) * 100, 100)}%` }} />
          </div>
        </WeatherItemWithTimeline>

        <WeatherItemWithTimeline
          entityId='sensor.gw2000a_solar_radiation'
          entities={entities}
          hassUrl={hassUrl}
          icon='mdi:weather-sunny-off'
          label='Irradiance'
          value={withUnit(irradiance, ' W/m²')}
          valueClass='subtle'
          childrenFirst
        >
          <div className='bar'>
            <div className='bar-fill irr' style={{ width: `${Math.min((Number(irradiance ?? 0) / 1200) * 100, 100)}%` }} />
          </div>
        </WeatherItemWithTimeline>

        <WeatherItemWithTimeline
          entityId={
            entities?.['sensor.gw2000a_relative_pressure'] ? 'sensor.gw2000a_relative_pressure' : 'sensor.gw2000a_absolute_pressure'
          }
          entities={entities}
          hassUrl={hassUrl}
          icon='mdi:gauge'
          label='Pressure'
          value={withUnit(pressure, ' hPa')}
        />
      </div>
    </div>
  );
}
