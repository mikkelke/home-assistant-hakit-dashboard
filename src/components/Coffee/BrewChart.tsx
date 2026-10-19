import { useId } from 'react';
import type { PlanPour } from '../../coffee/model';
import { areaPath, axisLabel, bandMiddle, bandPath, laneStates, linePath, valueAt, type ChartSeries, type Scale } from './chart';
import type { BrewChartLook } from './looks';

export type BrewChartMode = 'idle' | 'live' | 'ready' | 'hist' | 'plan';

export interface BrewChartProps {
  look: BrewChartLook;
  mode: BrewChartMode;
  width: number;
  height: number;
  tMax: number;
  yMax: number;
  cup?: ChartSeries | null;
  water?: ChartSeries | null;
  bandLo?: ChartSeries | null;
  bandHi?: ChartSeries | null;
  planWater?: ChartSeries | null;
  planPours?: readonly PlanPour[];
  /** Live: seconds since the first bloom now. */
  nowS?: number | null;
  /** Live: the current pour's number and the second it really started. */
  pour?: number | null;
  pourStartS?: number | null;
  /** Live: the second the pour lane is read at, when it is not now: where a pause or a lost link left the pour. */
  laneAtS?: number | null;
  /** Live: no fresh data since this second. */
  staleFromS?: number | null;
  /** Paused: the brew waits at its stage. */
  frozen?: boolean;
  /** The live head may glow and the current pour breathe. */
  glow?: boolean;
  breathe?: boolean;
  readyS?: number | null;
  /** End labels: the cup's expected or final grams and the water's total. */
  cupEndG?: number | null;
  waterEndMl?: number | null;
  /** Where the drawdown ends, to place its label. */
  drawdownEndS?: number | null;
  label: string;
}

const BLOCK = {
  plan: { fill: 'rgba(56,189,248,.16)', text: '#7dd3fc' },
  done: { fill: '#38bdf8', text: '#082f49' },
  cur: { fill: 'rgba(56,189,248,.16)', text: '#f0f9ff' },
  next: { fill: '#2c2c2e', text: 'rgba(235,235,245,.6)' },
} as const;

/** The one brew chart: the cup (copper area) and the water (sky line) over seconds since the first bloom, the plan as
 * its own dashed line, the usual's band, and the pours as blocks on the same axis. Gaps stay open, and both series end
 * at their last valid sample. */
export function BrewChart(props: BrewChartProps) {
  const { look, mode, width: W, height: H, tMax, yMax } = props;
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const f = look.font;
  const lanePad = look.lane ? 10 : 4;
  const ph = Math.max(10, H - look.padT - look.lane - look.axis - lanePad);
  const x0 = look.padL;
  const x1 = W - look.padR;
  const yb = look.padT + ph;
  const scale: Scale = {
    x: s => x0 + ((x1 - x0) * Math.min(tMax, Math.max(0, s))) / tMax,
    y: grams => yb - (ph * Math.min(yMax, Math.max(0, grams))) / yMax,
  };
  const stroke = look.thin ? { water: 1.6, cup: 2, plan: 1.5, mid: 1.2 } : { water: 2.6, cup: 3.4, plan: 2, mid: 1.8 };
  const measured = mode === 'live' || mode === 'ready' || mode === 'hist';
  const live = mode === 'live';
  const stale = live && props.staleFromS != null;
  const nowS = props.nowS ?? 0;
  const lastS = stale ? (props.staleFromS as number) : live ? nowS : Infinity;
  const ticks: number[] = [];
  for (let v = 100; v <= yMax; v += 100) ticks.push(v);
  const xTicks: number[] = [];
  for (let s = 0; s <= tMax; s += look.xStep) xTicks.push(s);

  const band = props.bandLo && props.bandHi ? { lo: props.bandLo, hi: props.bandHi } : null;
  const middle = band ? bandMiddle(band.lo, band.hi) : null;
  const headCup = live ? valueAt(props.cup, Math.min(lastS, nowS)) : null;
  const headWater = live ? valueAt(props.water, Math.min(lastS, nowS)) : null;
  const headS = stale ? (props.staleFromS as number) : nowS;

  const pours = props.planPours ?? [];
  const states =
    mode === 'live'
      ? laneStates(pours, props.pour ?? null, props.pourStartS ?? null, props.laneAtS ?? nowS)
      : pours.map(() => ({ state: mode === 'idle' || mode === 'plan' ? ('plan' as const) : ('done' as const), fill: 1 }));
  const ly = yb + 10;
  const bh = look.blockH;
  const total = pours.length;

  return (
    <svg className='brew-chart' width={W} height={H} viewBox={`0 0 ${W} ${H}`} role='img' aria-label={props.label}>
      <defs>
        <linearGradient id={`gc${uid}`} x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor='#d4956a' stopOpacity='.42' />
          <stop offset='1' stopColor='#d4956a' stopOpacity='0' />
        </linearGradient>
        <linearGradient id={`gw${uid}`} x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor='#38bdf8' stopOpacity='.22' />
          <stop offset='1' stopColor='#38bdf8' stopOpacity='0' />
        </linearGradient>
        <pattern id={`hz${uid}`} width='8' height='8' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'>
          <rect width='3' height='8' fill='rgba(251,191,36,.10)' />
        </pattern>
      </defs>

      {ticks.map(v => (
        <g key={v}>
          <line x1={x0} x2={x1} y1={scale.y(v)} y2={scale.y(v)} stroke='rgba(255,255,255,.07)' />
          {look.yLabels && (
            <text x={x0 - (f < 12 ? 4 : 10)} y={scale.y(v) + f * 0.35} textAnchor='end' fontSize={f} fill='#8b8b94'>
              {v}
            </text>
          )}
        </g>
      ))}
      <line x1={x0} x2={x1} y1={yb} y2={yb} stroke='rgba(255,255,255,.16)' />

      {band && middle && (
        <>
          <path
            d={bandPath(band.lo, band.hi, scale)}
            fill='rgba(212,149,106,.2)'
            stroke='rgba(212,149,106,.4)'
            strokeWidth={1}
            strokeDasharray='3 4'
          />
          <path
            d={linePath(middle, scale)}
            fill='none'
            stroke='rgba(240,201,173,.45)'
            strokeWidth={stroke.mid}
            strokeDasharray={look.thin ? '3 3' : '5 5'}
          />
          {mode === 'idle' && <path d={areaPath(middle, scale, yb)} fill={`url(#gc${uid})`} opacity={0.55} />}
        </>
      )}

      {props.planWater && (mode === 'idle' || mode === 'plan' || mode === 'live') && (
        <>
          {mode === 'plan' && <path d={areaPath(props.planWater, scale, yb)} fill={`url(#gw${uid})`} />}
          <path
            d={linePath(props.planWater, scale)}
            fill='none'
            stroke={live ? 'rgba(56,189,248,.45)' : '#38bdf8'}
            strokeWidth={stroke.plan}
            strokeDasharray={mode === 'plan' ? undefined : '6 5'}
          />
        </>
      )}

      {mode === 'idle' && look.endLabels && (
        <>
          {props.waterEndMl != null && (
            <text x={x1 + 10} y={scale.y(props.waterEndMl) + f * 0.35} fontSize={f + 1} fill='#7dd3fc' fontWeight={600}>
              {Math.round(props.waterEndMl)} ml
            </text>
          )}
          {props.cupEndG != null && (
            <text x={x1 + 10} y={scale.y(props.cupEndG) + f * 0.35 + 6} fontSize={f + 1} fill='#f0c9ad' fontWeight={600}>
              ≈{Math.round(props.cupEndG)} g
            </text>
          )}
        </>
      )}

      {measured && (
        <>
          <path d={areaPath(props.water, scale, yb, lastS)} fill={`url(#gw${uid})`} />
          <path d={linePath(props.water, scale, lastS)} fill='none' stroke='#38bdf8' strokeWidth={stroke.water} strokeLinejoin='round' />
          <path d={areaPath(props.cup, scale, yb, lastS)} fill={`url(#gc${uid})`} />
          <path
            d={linePath(props.cup, scale, lastS)}
            fill='none'
            stroke='#d4956a'
            strokeWidth={stroke.cup}
            strokeLinejoin='round'
            strokeLinecap='round'
          />
        </>
      )}

      {stale && (
        <>
          <rect
            x={scale.x(props.staleFromS as number)}
            y={look.padT}
            width={Math.max(0, scale.x(nowS) - scale.x(props.staleFromS as number))}
            height={ph}
            fill={`url(#hz${uid})`}
          />
          {!look.thin && (
            <text
              x={(scale.x(props.staleFromS as number) + scale.x(nowS)) / 2}
              y={look.padT + f + 6}
              textAnchor='middle'
              fontSize={f}
              fill='#fcd34d'
              fontWeight={600}
            >
              no data
            </text>
          )}
          <line x1={scale.x(nowS)} x2={scale.x(nowS)} y1={look.padT} y2={yb} stroke='rgba(251,191,36,.5)' strokeDasharray='2 4' />
        </>
      )}

      {live && (
        <>
          {!stale && (
            <line
              x1={scale.x(headS)}
              x2={scale.x(headS)}
              y1={look.padT}
              y2={yb}
              stroke={props.frozen ? 'rgba(251,191,36,.5)' : 'rgba(255,255,255,.28)'}
              strokeDasharray='2 4'
            />
          )}
          {headCup != null && props.glow && !props.frozen && !stale && (
            <circle className='brew-chart-glow' cx={scale.x(headS)} cy={scale.y(headCup)} r={9} fill='#d4956a' opacity={0.35} />
          )}
          {headCup != null && (
            <circle
              cx={scale.x(headS)}
              cy={scale.y(headCup)}
              r={look.thin ? 4 : 5.5}
              fill={stale ? '#71717a' : '#f0c9ad'}
              stroke='#1c1c1e'
              strokeWidth={2}
            />
          )}
          {headWater != null && (
            <circle
              cx={scale.x(headS)}
              cy={scale.y(headWater)}
              r={look.thin ? 3.5 : 5}
              fill={stale ? '#71717a' : '#bae6fd'}
              stroke='#1c1c1e'
              strokeWidth={2}
            />
          )}
        </>
      )}

      {mode === 'ready' && props.readyS != null && (
        <>
          <line
            x1={scale.x(props.readyS)}
            x2={scale.x(props.readyS)}
            y1={look.padT}
            y2={yb}
            stroke='rgba(34,197,94,.45)'
            strokeDasharray='2 4'
          />
          {props.cupEndG != null && (
            <circle
              cx={scale.x(props.readyS)}
              cy={scale.y(props.cupEndG)}
              r={look.thin ? 4 : 5.5}
              fill='#f0c9ad'
              stroke='#1c1c1e'
              strokeWidth={2}
            />
          )}
          {look.endLabels && (
            <>
              <text x={scale.x(props.readyS)} y={look.padT + f} textAnchor='middle' fontSize={f} fill='#86efac' fontWeight={600}>
                ready {axisLabel(props.readyS)}
              </text>
              {props.cupEndG != null && (
                <text
                  x={scale.x(props.readyS) + 12}
                  y={scale.y(props.cupEndG) + f * 0.35 + 4}
                  fontSize={f + 3}
                  fill='#f0c9ad'
                  fontWeight={700}
                  stroke='#1c1c1e'
                  strokeWidth={5}
                  paintOrder='stroke'
                >
                  {Math.round(props.cupEndG)} g
                </text>
              )}
              {props.waterEndMl != null && (
                <text
                  x={scale.x(props.readyS) + 12}
                  y={scale.y(props.waterEndMl) + f * 0.35 - 4}
                  fontSize={f + 1}
                  fill='#7dd3fc'
                  fontWeight={600}
                >
                  {Math.round(props.waterEndMl)} ml
                </text>
              )}
            </>
          )}
        </>
      )}

      {look.lane > 0 &&
        pours.map((pour, index) => {
          const bx = scale.x(pour.start);
          const bw = Math.max(2, scale.x(pour.end) - bx);
          const { state, fill } = states[index];
          const color = BLOCK[state];
          const radius = Math.min(8, bh / 3);
          const accent = props.frozen ? '#fbbf24' : '#38bdf8';
          const moving = state === 'cur' && props.breathe && !props.frozen;
          const name = index === 0 && look.names === 'full' ? `Bloom 1/${total}` : `${index + 1}/${total}`;
          const next = pours[index + 1];
          return (
            <g key={`${pour.start}-${index}`}>
              <rect x={bx} y={ly} width={bw} height={bh} rx={radius} fill={color.fill} />
              {state === 'cur' && (
                <>
                  <rect
                    className={moving ? 'brew-chart-pour' : undefined}
                    x={bx}
                    y={ly}
                    width={bw * fill}
                    height={bh}
                    rx={radius}
                    fill={props.frozen ? 'rgba(251,191,36,.35)' : 'rgba(56,189,248,.5)'}
                  />
                  <rect
                    className={moving ? 'brew-chart-pour' : undefined}
                    x={bx}
                    y={ly}
                    width={bw}
                    height={bh}
                    rx={radius}
                    fill='none'
                    stroke={accent}
                    strokeWidth={look.thin ? 1.5 : 2.5}
                  />
                </>
              )}
              {look.blockText && bw > 14 && pour.ml != null && (
                <text
                  x={bx + bw / 2}
                  y={ly + bh / 2 + look.blockFont * 0.36}
                  textAnchor='middle'
                  fontSize={look.blockFont}
                  fontWeight={700}
                  fill={color.text}
                >
                  {Math.round(pour.ml)}
                </text>
              )}
              {look.names && (
                <text
                  x={bx + bw / 2}
                  y={ly + bh + f + (look.thin ? 2 : 4)}
                  textAnchor='middle'
                  fontSize={f - 1}
                  fill={state === 'cur' ? (props.frozen ? '#fcd34d' : '#7dd3fc') : '#8b8b94'}
                  fontWeight={state === 'cur' ? 700 : 400}
                >
                  {name}
                </text>
              )}
              {look.pauses && next && next.start > pour.end && (
                <text
                  x={(scale.x(pour.end) + scale.x(next.start)) / 2}
                  y={ly + bh / 2 + f * 0.35}
                  textAnchor='middle'
                  fontSize={f - 2}
                  fill='#6b6f78'
                >
                  {Math.round(next.start - pour.end)}s
                </text>
              )}
            </g>
          );
        })}
      {look.lane > 0 &&
        look.drawdown &&
        pours.length > 0 &&
        props.drawdownEndS != null &&
        props.drawdownEndS > pours[pours.length - 1].end + 20 && (
          <text
            x={(scale.x(pours[pours.length - 1].end) + scale.x(props.drawdownEndS)) / 2}
            y={ly + bh / 2 + f * 0.35}
            textAnchor='middle'
            fontSize={f - 2}
            fill='#6b6f78'
          >
            drawdown
          </text>
        )}

      {look.axis > 0 &&
        xTicks.map(s => (
          <text key={s} x={scale.x(s)} y={H - 4} textAnchor={s === 0 ? 'start' : s === tMax ? 'end' : 'middle'} fontSize={f} fill='#8b8b94'>
            {axisLabel(s)}
          </text>
        ))}
    </svg>
  );
}
