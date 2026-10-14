import type { ReactNode, Ref } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import { HOUSEHOLD } from '../../home/household';
import { useMotionSlot } from '../../home/motionBudget';
import { arcPoint, celestialPosition, windArrowDeg } from '../../home/sky';
import { formatDecimal } from '../../utils/format';
import { getWeatherConditionIcon } from '../Weather/weatherIcons';
import { PersonAvatar, PersonStatus } from '../StatusBar/PersonStatus';
import { useSky, type SkyReadings } from './useSky';
import './LivingSky.css';

const STARS: readonly (readonly [number, number, number])[] = [
  [150, 18, 1],
  [205, 40, 0.8],
  [232, 14, 1.1],
  [300, 66, 0.8],
  [120, 44, 0.7],
  [40, 78, 0.8],
  [168, 50, 0.8],
  [262, 56, 0.8],
  [95, 70, 0.8],
  [330, 70, 0.7],
];

const CLOUDS: readonly (readonly [number, number, number])[] = [
  [190, 78, 34],
  [96, 58, 26],
  [276, 46, 30],
];

function conditionIcon(condition: string | undefined, sunUp: boolean): string {
  if (!sunUp && (condition === 'sunny' || condition === 'clear-night')) return 'mdi:weather-night';
  if (!sunUp && condition === 'partlycloudy') return 'mdi:weather-night-partly-cloudy';
  return getWeatherConditionIcon(condition);
}

function SkyTemp({ sky, compact }: { sky: SkyReadings; compact?: boolean }) {
  return (
    <span className={compact ? 'sky-strip-temp' : 'sky-temp'}>
      <Icon icon={conditionIcon(sky.condition, sky.sunUp)} className='sky-temp-icon' />
      {sky.tempC == null ? (
        '—'
      ) : compact ? (
        `${formatDecimal(sky.tempC, 1)} °C`
      ) : (
        <span className='sky-temp-value'>
          {formatDecimal(sky.tempC, 1)}
          <small>°C</small>
        </span>
      )}
    </span>
  );
}

function SkyDrawing({ sky }: { sky: SkyReadings }) {
  const drifting = useMotionSlot('clouds', 'clouds', sky.clouds > 0);
  const starCount = sky.phase === 'night' ? STARS.length : sky.phase === 'dusk' || sky.phase === 'dawn' ? 5 : 0;
  return (
    <svg className='sky-svg' viewBox='0 0 358 152' preserveAspectRatio='none' aria-hidden='true'>
      {STARS.slice(0, starCount).map(([cx, cy, r]) => (
        <circle key={`${cx}-${cy}`} className='sky-star' cx={cx} cy={cy} r={r} />
      ))}
      {sky.clouds > 0 && (
        <g className={`sky-clouds ${drifting ? 'is-anim' : ''}`}>
          {CLOUDS.slice(0, sky.clouds).map(([cx, cy, rx]) => (
            <g key={cx}>
              <ellipse cx={cx} cy={cy} rx={rx} ry={7} />
              <ellipse cx={cx + rx * 0.45} cy={cy - 5} rx={rx * 0.55} ry={7} />
            </g>
          ))}
          {sky.raining &&
            CLOUDS.slice(0, sky.clouds).map(([cx, cy]) => (
              <path
                key={`rain-${cx}`}
                className='sky-rain'
                d={`M${cx - 14} ${cy + 10}l-4 10M${cx} ${cy + 10}l-4 10M${cx + 14} ${cy + 10}l-4 10`}
              />
            ))}
        </g>
      )}
      <path className='sky-arc' d='M20 104Q179-60 338 104' />
    </svg>
  );
}

function CelestialBody({ sky }: { sky: SkyReadings }) {
  const position = celestialPosition(sky.sunUp, sky.nextRisingMs, sky.nextSettingMs, sky.nowMs);
  if (!position) return null;
  const { x, y } = arcPoint(position.t);
  const style = { left: `${x * 100}%`, top: `${y}px` };
  return position.body === 'sun' ? (
    <span className='sky-sun' style={style} />
  ) : (
    <Icon icon='mdi:moon-waning-crescent' className='sky-moon' style={style} />
  );
}

interface LivingSkyProps {
  entities: HassEntities;
  hassUrl: string | null;
  onMenu: () => void;
  ref?: Ref<HTMLElement>;
  /** Shown on the ground after the people. */
  children?: ReactNode;
}

/** The home screen's header: the sky as it is now, the outdoor temperature and wind, and along its
 * ground who is home. */
export function LivingSky({ entities, hassUrl, onMenu, ref, children }: LivingSkyProps) {
  const sky = useSky();
  const windFrom = sky.windFromDeg;
  return (
    <section ref={ref} className={`sky sky--${sky.phase}`} aria-label='Weather and people'>
      <SkyDrawing sky={sky} />
      <CelestialBody sky={sky} />
      <i className='sky-ground' />
      <div className='sky-wx'>
        <SkyTemp sky={sky} />
        {sky.windMs != null && (
          <span className='sky-chip' aria-label={`Wind ${sky.windMs} m/s`}>
            {windFrom != null && <Icon icon='mdi:arrow-up' style={{ transform: `rotate(${windArrowDeg(windFrom)}deg)` }} />}
            {sky.windMs} m/s
          </span>
        )}
      </div>
      <button type='button' className='sky-menu' onClick={onMenu} aria-label='Open menu'>
        <Icon icon='mdi:menu' />
      </button>
      <div className='sky-ground-line'>
        <div className='sky-people'>
          {HOUSEHOLD.map(member => (
            <PersonStatus key={member.key} entity={member.personEntityId} entities={entities} hassUrl={hassUrl} size='sky' />
          ))}
        </div>
        {children}
      </div>
    </section>
  );
}

interface SkyStripProps {
  entities: HassEntities;
  hassUrl: string | null;
  className?: string;
  /** Back to the grid; shown at the start of the strip. */
  onBack?: () => void;
  onMenu?: () => void;
  /** Avatars open the presence timeline; otherwise they only show. */
  interactive?: boolean;
  /** HA user name of the viewer, whose avatar gets a ring. */
  viewerName?: string | null;
}

/** The sky folded into one 52 px row: the grid shows it once the big sky scrolls away, and the
 * timeline uses it as its header. */
export function SkyStrip({ entities, hassUrl, className = '', onBack, onMenu, interactive = true, viewerName }: SkyStripProps) {
  const sky = useSky();
  const viewer = viewerName?.trim().toLowerCase();
  return (
    <div className={`sky-strip sky--${sky.phase} ${className}`}>
      {onBack && (
        <button type='button' className='sky-strip-back' onClick={onBack} aria-label='Back to rooms'>
          <Icon icon='mdi:chevron-left' />
          <Icon icon='mdi:view-grid-outline' />
        </button>
      )}
      <SkyTemp sky={sky} compact />
      {HOUSEHOLD.map(member =>
        interactive ? (
          <PersonStatus key={member.key} entity={member.personEntityId} entities={entities} hassUrl={hassUrl} size='strip' />
        ) : (
          <PersonAvatar
            key={member.key}
            entity={member.personEntityId}
            entities={entities}
            hassUrl={hassUrl}
            size='strip'
            isViewer={viewer != null && member.name.toLowerCase() === viewer}
          />
        )
      )}
      {onMenu && (
        <button type='button' className='sky-menu sky-strip-menu' onClick={onMenu} aria-label='Open menu'>
          <Icon icon='mdi:menu' />
        </button>
      )}
    </div>
  );
}
