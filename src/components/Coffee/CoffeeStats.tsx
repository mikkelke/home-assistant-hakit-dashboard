import { useRef } from 'react';
import { Icon } from '@iconify/react';
import { sendCoffeeCommand } from '../../coffee/command';
import { BEANS_TOP_UP_G } from '../../coffee/entities';
import {
  advisorShown,
  adviceFieldWord,
  type BrewRecord,
  type CoffeeAdvice,
  type CoffeeBaseline,
  type CoffeeBeans,
  type CoffeeBrews,
} from '../../coffee/model';
import type { CoffeeRecentData } from '../../coffee/recent';
import { formatDayMonth } from '../../coffee/view';
import { homeDayStartMs, homeWallTime } from '../../energy/homeTime';
import { HOME_TIME_ZONE } from '../../config/plan';
import { bandPath, linePath, series } from './chart';
import { Glyph } from './Glyph';
import { CoffeeSheet } from './parts';
import { SpreadChips } from './sheets';
import { useElementSize } from './useElementSize';

const DAY_MS = 86_400_000;
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: HOME_TIME_ZONE });

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  return { ref, width: useElementSize(ref).width };
}

/** Brews per week, the current week in copper. */
export function WeeksBars({ weeks, nowMs }: { weeks: number[]; nowMs: number }) {
  const { ref, width } = useWidth();
  const height = 52;
  const max = Math.max(3, ...weeks);
  const gap = 5;
  const n = weeks.length;
  const barW = n > 0 ? (width - gap * (n - 1)) / n : 0;
  const monday = homeDayStartMs(nowMs) - ((homeWallTimeDay(nowMs) + 6) % 7) * DAY_MS;
  const firstWeek = monday - (n - 1) * 7 * DAY_MS;
  return (
    <div ref={ref} className='cst-weeks'>
      {width > 0 && n > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden='true'>
          {weeks.map((count, index) => {
            const h = Math.max(count > 0 ? 3 : 1, ((height - 14) * count) / max);
            return (
              <rect
                key={index}
                x={index * (barW + gap)}
                y={height - 14 - h}
                width={barW}
                height={h}
                rx={3}
                fill={index === n - 1 ? '#d4956a' : '#3f3f46'}
              />
            );
          })}
          <text x={0} y={height - 2} fontSize={9} fill='#71717a'>
            {formatDayMonth(firstWeek)}
          </text>
          <text x={width} y={height - 2} fontSize={9} fill='#71717a' textAnchor='end'>
            this wk
          </text>
        </svg>
      )}
    </div>
  );
}

/** 0 for Sunday, like `Date.getDay`, on the house calendar. */
function homeWallTimeDay(ms: number): number {
  const { year, month, day } = homeWallTime(ms);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** When in the day brews happen, one dot per brew over 24 h. */
export function TimeOfDay({ hours }: { hours: number[] }) {
  const { ref, width } = useWidth();
  const height = 34;
  const dots: { x: number; night: boolean }[] = [];
  hours.forEach((count, hour) => {
    for (let index = 0; index < count; index++) dots.push({ x: (width * (hour + (index + 1) / (count + 1))) / 24, night: hour < 5 });
  });
  return (
    <div ref={ref} className='cst-tod'>
      {width > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden='true'>
          <rect x={0} y={8} width={width} height={12} rx={6} fill='#2c2c2e' />
          <rect x={(width * 6) / 24} y={8} width={(width * 15) / 24} height={12} rx={6} fill='rgba(212,149,106,.12)' />
          {dots.map((dot, index) => (
            <circle key={index} cx={dot.x} cy={14} r={4} fill={dot.night ? '#a78bfa' : 'rgba(212,149,106,.8)'} />
          ))}
          {[0, 6, 12, 18, 24].map(hour => (
            <text
              key={hour}
              x={(width * hour) / 24}
              y={height - 1}
              fontSize={9}
              fill='#71717a'
              textAnchor={hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle'}
            >
              {String(hour).padStart(2, '0')}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

/** The usual's band with each of its brews drawn in it. */
export function SpreadChart({ baseline, recent }: { baseline: CoffeeBaseline; recent: CoffeeRecentData | null }) {
  const { ref, width } = useWidth();
  const height = 110;
  const lo = series(baseline.cupLo, baseline.stepS);
  const hi = series(baseline.cupHi, baseline.stepS);
  const curves = baseline.brewIds.map(id => recent?.curves[id]).filter(curve => curve != null);
  const tMax = 240;
  const yMax = 230;
  const scale = {
    x: (s: number) => 4 + ((width - 8) * Math.min(tMax, s)) / tMax,
    y: (g: number) => height - 14 - ((height - 20) * Math.min(yMax, g)) / yMax,
  };
  return (
    <div ref={ref} className='cst-spread'>
      {width > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden='true'>
          {lo && hi && <path d={bandPath(lo, hi, scale)} fill='rgba(212,149,106,.12)' />}
          {curves.map(curve => (
            <path
              key={curve.id}
              d={linePath(series(curve.cup, curve.stepS), scale)}
              fill='none'
              stroke='rgba(212,149,106,.5)'
              strokeWidth={1}
            />
          ))}
          {[0, 60, 120, 180, 240].map(s => (
            <text
              key={s}
              x={scale.x(s)}
              y={height - 2}
              fontSize={9}
              fill='#71717a'
              textAnchor={s === 0 ? 'start' : s === tMax ? 'end' : 'middle'}
            >
              {`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

/** The last 60 days, one tick per brew: the newest light, a stopped one short and rose. */
export function BrewStrip({
  brews,
  nowMs,
  selectedId,
  onSelect,
}: {
  brews: BrewRecord[];
  nowMs: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { ref, width } = useWidth();
  const height = 40;
  const startMs = homeDayStartMs(nowMs) - 59 * DAY_MS;
  const x = (ms: number) => 3 + ((width - 6) * Math.min(59.99, Math.max(0, (ms - startMs) / DAY_MS))) / 60;
  const months: { at: number; label: string }[] = [];
  for (let day = 1; day < 60; day++) {
    const ms = startMs + day * DAY_MS;
    if (homeWallTime(ms).day === 1) months.push({ at: ms, label: MONTH.format(ms) });
  }
  return (
    <div ref={ref} className='cst-strip'>
      {width > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role='img' aria-label={`${brews.length} brews in 60 days`}>
          <line x1={0} x2={width} y1={height - 14} y2={height - 14} stroke='rgba(255,255,255,.1)' />
          {brews.map((brew, index) => {
            if (brew.atMs == null || brew.atMs < startMs) return null;
            const stopped = brew.outcome === 'stopped' || brew.outcome === 'failed';
            const h = (height - 18) * (stopped ? 0.15 : 0.82 + ((index * 37) % 18) / 100);
            const fill = brew.id === selectedId ? '#f0c9ad' : stopped ? '#fb7185' : 'rgba(212,149,106,.55)';
            return (
              <rect
                key={brew.id}
                className='cst-strip-tick'
                x={x(brew.atMs) - 2}
                y={height - 14 - h}
                width={4}
                height={h}
                rx={2}
                fill={fill}
                onClick={() => onSelect(brew.id)}
              />
            );
          })}
          <text x={0} y={height - 2} fontSize={9} fill='#71717a'>
            {formatDayMonth(startMs)}
          </text>
          {months.map(month => (
            <text key={month.at} x={x(month.at)} y={height - 2} fontSize={9} fill='#71717a' textAnchor='middle'>
              {month.label}
            </text>
          ))}
          <text x={width} y={height - 2} fontSize={9} fill='#71717a' textAnchor='end'>
            today
          </text>
        </svg>
      )}
    </div>
  );
}

/** The undo for the last top-up, while it lasts. */
export function BeansUndo({ beans, nowMs }: { beans: CoffeeBeans | null; nowMs: number }) {
  if (!beans?.lastOpId || beans.undoUntilMs == null || beans.undoUntilMs <= nowMs) return null;
  const opId = beans.lastOpId;
  return (
    <button
      type='button'
      className='coffee-chip is-ok cst-undo'
      onClick={() => void sendCoffeeCommand('beans_undo', { op_id: opId }).catch(() => {})}
    >
      <Icon icon='mdi:undo' aria-hidden='true' />
      Undo the top-up
    </button>
  );
}

const tasteTotal = (taste: { sour: number; balanced: number; bitter: number }) => taste.sour + taste.balanced + taste.bitter;

/** Four tiles that stay interesting when one recipe repeats: how much, how many beans are left, how steady the usual
 * is, and how it tastes on these beans. Bean grams are the planned doses. */
export function StatsSheet({
  brews,
  beans,
  baseline,
  advice,
  recent,
  nowMs,
  onBeans,
  onClose,
}: {
  brews: CoffeeBrews | null;
  beans: CoffeeBeans | null;
  baseline: CoffeeBaseline | null;
  advice: CoffeeAdvice | null;
  recent: CoffeeRecentData | null;
  nowMs: number;
  onBeans: () => void;
  onClose: () => void;
}) {
  const weeks = brews?.weeks ?? [];
  const avg = weeks.length ? weeks.reduce((sum, count) => sum + count, 0) / weeks.length : null;
  const taste = brews?.taste ?? null;
  const rated = taste ? tasteTotal(taste) : 0;
  const suggestion = advisorShown(advice) && advice.status === 'suggested' && advice.to ? advice : null;
  const share = beans?.remainingG != null ? Math.min(1, beans.remainingG / Math.max(BEANS_TOP_UP_G, beans.remainingG)) : 0;
  const count = brews?.brews60d ?? brews?.brews.length ?? 0;
  return (
    <CoffeeSheet
      icon='mdi:chart-bar'
      title='Coffee'
      subtitle={`60 days · ${count} brew${count === 1 ? '' : 's'}`}
      historyKey='coffee-stats'
      onClose={onClose}
    >
      <div className='coffee-sheet-stack cst'>
        <div className='coffee-tile'>
          <h4>
            Cups a week<span className='coffee-tile-r'>last {weeks.length} weeks</span>
          </h4>
          <div className='cst-weekrow'>
            <div className='coffee-big'>
              {avg == null ? '—' : avg.toFixed(1)}
              <small>avg</small>
            </div>
            <WeeksBars weeks={weeks} nowMs={nowMs} />
          </div>
        </div>
        {beans && (
          <div className='coffee-tile'>
            <h4>
              <Glyph name='jar' />
              {beans.beanName ?? 'Beans'}
              {beans.addedAtMs != null && <span className='coffee-tile-r'>added {formatDayMonth(beans.addedAtMs)}</span>}
            </h4>
            <div className='cst-beans'>
              <div className='coffee-big'>
                {beans.remainingG == null ? '—' : `≈${Math.round(beans.remainingG)}`}
                <small>g left</small>
              </div>
              <div className='cst-beans-bar'>
                <div className='coffee-bar'>
                  <i style={{ width: `${Math.round(share * 100)}%` }} />
                </div>
                {beans.brewsLeft != null && (
                  <span>
                    ≈ {beans.brewsLeft} brew{beans.brewsLeft === 1 ? '' : 's'}
                    {beans.doseG != null ? ` at ${beans.doseG} g` : ''}
                  </span>
                )}
              </div>
            </div>
            <div className='coffee-row cst-beans-acts'>
              <button
                type='button'
                className='coffee-btn is-ghost is-grow'
                onClick={() =>
                  void sendCoffeeCommand(
                    'beans_add',
                    beans.beanId ? { grams: BEANS_TOP_UP_G, bean_id: beans.beanId } : { grams: BEANS_TOP_UP_G }
                  ).catch(() => {})
                }
              >
                <Icon icon='mdi:plus' aria-hidden='true' />
                Added {BEANS_TOP_UP_G} g
              </button>
              <button type='button' className='coffee-btn is-ghost' onClick={onBeans}>
                <Glyph name='bean' />
                Beans
              </button>
            </div>
            <BeansUndo beans={beans} nowMs={nowMs} />
          </div>
        )}
        {baseline && baseline.status === 'ready' && (
          <div className='coffee-tile'>
            <h4>
              The usual, how steady<span className='coffee-tile-r'>n={baseline.n} · same recipe + beans</span>
            </h4>
            <SpreadChart baseline={baseline} recent={recent} />
            <SpreadChips baseline={baseline} />
          </div>
        )}
        {taste && rated > 0 && (
          <div className='coffee-tile'>
            <h4>
              Taste on these beans
              <span className='coffee-tile-r'>
                {rated} rated{beans?.addedAtMs != null ? ` since ${formatDayMonth(beans.addedAtMs)}` : ''}
              </span>
            </h4>
            <div className='cst-taste'>
              {(['sour', 'balanced', 'bitter'] as const)
                .filter(key => taste[key] > 0)
                .map(key => (
                  <span key={key} className={`is-${key}`} style={{ flex: taste[key] }}>
                    {key === 'sour' ? 'Sour' : key === 'balanced' ? 'Balanced' : 'Bitter'} {taste[key]}
                  </span>
                ))}
            </div>
            {suggestion && (
              <div className='cst-suggest'>
                <Icon icon='mdi:creation' aria-hidden='true' />
                Suggested: try {adviceFieldWord(suggestion.field)} {suggestion.to} once · from these {rated}
              </div>
            )}
          </div>
        )}
        {brews && brews.hours.some(count => count > 0) && (
          <div className='coffee-tile'>
            <h4>
              When
              <span className='coffee-tile-r'>
                60 days{brews.beansPlannedG60d ? ` · ≈${Math.round(brews.beansPlannedG60d)} g beans planned` : ''}
              </span>
            </h4>
            <TimeOfDay hours={brews.hours} />
          </div>
        )}
      </div>
    </CoffeeSheet>
  );
}
