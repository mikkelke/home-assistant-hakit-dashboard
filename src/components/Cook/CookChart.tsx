import { useId, useRef } from 'react';
import type { CookLive, CookState } from '../../cook/model';
import { formatHomeClock } from '../../energy/homeTime';
import { areaPath, lastValidS, linePath, series, valueAt } from '../Coffee/chart';
import { useElementSize } from '../Coffee/useElementSize';

export function CookChart({
  state,
  live,
  nowMs,
  mini = false,
}: {
  state: CookState;
  live: CookLive | null;
  nowMs: number;
  mini?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const size = useElementSize(box);
  const gradient = useId();
  const width = size.width || (mini ? 340 : 720);
  const height = size.height || (mini ? 130 : 340);
  const inset = mini ? 12 : 34;
  const bottom = height - (mini ? 18 : 28);
  const top = 22;
  const bath = state.bath.phase !== 'off' ? series(live?.bath, live?.stepS ?? 30) : null;
  const core = state.probe.phase !== 'off' ? series(live?.core, live?.stepS ?? 30) : null;
  const coreEnd = lastValidS(core);
  const bathEnd = lastValidS(bath);
  const latest = Math.max(coreEnd ?? 0, bathEnd ?? 0);
  const t0 = live?.t0Ms ?? nowMs;
  const etaS = state.probe.etaMs != null ? (state.probe.etaMs - t0) / 1000 : null;
  const fresh = state.probe.staleSinceMs == null;
  const forecast =
    fresh &&
    live?.t0Ms != null &&
    state.probe.etaMs != null &&
    state.probe.etaMs > nowMs &&
    (state.probe.phase === 'tracking' || state.probe.phase === 'near') &&
    coreEnd != null &&
    etaS != null &&
    etaS > coreEnd &&
    state.probe.pull != null;
  const tMax = Math.max(300, latest + 60, forecast ? etaS : 0);
  const values = [
    ...(bath?.values ?? []),
    ...(core?.values ?? []),
    state.probe.phase !== 'off' ? state.probe.serve : null,
    state.probe.phase !== 'off' ? state.probe.pull : null,
    state.bath.phase !== 'off' ? state.bath.target : null,
  ].filter((value): value is number => value != null);
  const yMin = Math.floor(Math.min(15, ...values) / 10) * 10;
  const yMax = Math.ceil(Math.max(60, ...values) / 10) * 10 + 5;
  const scale = {
    x: (s: number) => inset + (Math.max(0, s) / tMax) * (width - inset * 2),
    y: (v: number) => bottom - ((v - yMin) / (yMax - yMin)) * (bottom - top),
  };
  const coreValue = coreEnd == null ? null : valueAt(core, coreEnd);
  const bathValue = bathEnd == null ? null : valueAt(bath, bathEnd);
  const hasData = coreEnd != null || bathEnd != null;
  const mark = live?.pullMark != null ? live.pullMark * live.stepS : null;
  const label = `${state.probe.phase !== 'off' ? 'Core temperature and pull and serve targets' : 'Bath temperature'} over time${fresh ? '' : ', probe readings stalled'}`;
  return (
    <div ref={box} className={`cook-chart ${mini ? 'is-mini' : ''}`}>
      <svg viewBox={`0 0 ${width} ${height}`} role='img' aria-label={label}>
        <defs>
          <linearGradient id={gradient} x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0' stopColor='var(--heat)' stopOpacity='.2' />
            <stop offset='1' stopColor='var(--heat)' stopOpacity='0' />
          </linearGradient>
        </defs>
        {!mini &&
          [20, 40, 60, 80]
            .filter(value => value > yMin && value < yMax)
            .map(value => (
              <g key={value}>
                <line x1={inset} x2={width - inset} y1={scale.y(value)} y2={scale.y(value)} className='cook-chart-grid' />
                <text x='0' y={scale.y(value) + 4} className='cook-chart-axis'>
                  {value}°
                </text>
              </g>
            ))}
        {state.probe.phase !== 'off' &&
          (
            [
              ['pull', state.probe.pull],
              ['serve', state.probe.serve],
            ] as const
          ).map(
            ([kind, value]) =>
              value != null && (
                <g key={kind}>
                  <line x1={inset} x2={width - inset} y1={scale.y(value)} y2={scale.y(value)} className={`cook-chart-target is-${kind}`} />
                  {!mini && (
                    <text
                      x={width - inset}
                      y={scale.y(value) + (kind === 'pull' ? 16 : -7)}
                      textAnchor='end'
                      className={`cook-chart-label is-${kind}`}
                    >
                      {kind} {value}°
                    </text>
                  )}
                </g>
              )
          )}
        {mark != null && mark <= latest && (
          <g>
            <rect
              x={scale.x(mark)}
              y={top}
              width={Math.max(0, scale.x(latest) - scale.x(mark))}
              height={bottom - top}
              className='cook-chart-rest'
            />
            <line x1={scale.x(mark)} x2={scale.x(mark)} y1={top} y2={bottom} className='cook-chart-grid' />
            {!mini && (
              <text x={scale.x(mark) + 6} y={bottom - 8} className='cook-chart-axis'>
                pulled
              </text>
            )}
          </g>
        )}
        <path d={areaPath(core, scale, bottom)} fill={`url(#${gradient})`} />
        <path d={linePath(bath, scale)} className='cook-chart-line is-bath' />
        <path d={linePath(core, scale)} className={`cook-chart-line is-core ${fresh ? '' : 'is-stale'}`} />
        {forecast && coreValue != null && (
          <path
            d={`M${scale.x(coreEnd)} ${scale.y(coreValue)}L${scale.x(etaS)} ${scale.y(state.probe.pull!)}`}
            className='cook-chart-forecast'
          />
        )}
        {forecast && <circle cx={scale.x(etaS)} cy={scale.y(state.probe.pull!)} r={mini ? 4 : 6} className='cook-chart-prediction' />}
        {coreEnd != null && coreValue != null && (
          <circle
            cx={scale.x(coreEnd)}
            cy={scale.y(coreValue)}
            r={mini ? 4 : 6}
            className={`cook-chart-dot is-core ${fresh ? '' : 'is-stale'}`}
          />
        )}
        {bathEnd != null && bathValue != null && (
          <circle cx={scale.x(bathEnd)} cy={scale.y(bathValue)} r={mini ? 3 : 5} className='cook-chart-dot is-bath' />
        )}
        {hasData &&
          live?.t0Ms != null &&
          [0, 0.5, 1].map(part => (
            <text
              key={part}
              x={scale.x(tMax * part)}
              y={height - 3}
              textAnchor={part === 0 ? 'start' : part === 1 ? 'end' : 'middle'}
              className='cook-chart-axis'
            >
              {formatHomeClock(t0 + tMax * part * 1000)}
            </text>
          ))}
        {!hasData && (
          <text x={width / 2} y={height / 2} textAnchor='middle' className='cook-chart-axis'>
            Waiting for readings
          </text>
        )}
      </svg>
    </div>
  );
}
