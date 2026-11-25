import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '@iconify/react';
import { dateLabel, durationLabel, signed, spanLabel } from '../../body/chartScale';
import type { BodyInsights, LegDirection } from '../../body/insights';
import { useChartSize } from '../../body/useChartSize';
import { DAY_MS } from '../../body/weighings';

const MIN_SPAN_MS = 60 * DAY_MS;
const WEEK_MS = 7 * DAY_MS;
const PAD_X = 4;

const WORD: Record<LegDirection, string> = { down: 'Down', up: 'Up', steady: 'Steady' };
const ARROW: Record<LegDirection, string> = { down: 'mdi:arrow-bottom-right', up: 'mdi:arrow-top-right', steady: 'mdi:arrow-right' };

function RateChip({ kg, label }: { kg: number; label: string }) {
  const icon = Math.abs(kg) < 0.05 ? ARROW.steady : kg < 0 ? ARROW.down : ARROW.up;
  return (
    <span className='body-chip'>
      <Icon icon={icon} aria-hidden='true' />
      <span className='body-chip-value'>
        {signed(kg)}
        <span className='body-chip-unit'> kg</span>
      </span>
      <span className='body-chip-label'>{label}</span>
    </span>
  );
}

interface PhaseCardProps {
  insights: BodyInsights;
  nowMs: number;
}

/** The weight trend's legs, one bar each in time order, and the one picked in words: the current leg until another is tapped. */
export function PhaseCard({ insights, nowMs }: PhaseCardProps) {
  const { legs, spanMs, firstYear, fourWeek } = insights;
  const [picked, setPicked] = useState<number | null>(null);
  const [plotRef, { width, height }] = useChartSize<HTMLDivElement>({ width: 340, height: 64 });
  if (legs.length === 0 || spanMs < MIN_SPAN_MS) return null;

  const last = legs.length - 1;
  const index = picked != null && picked < last ? picked : last;
  const leg = legs[index];
  const isCurrent = index === last;
  const lengthMs = leg.endTs - leg.startTs;
  const perWeek = lengthMs >= 2 * WEEK_MS ? leg.delta / (lengthMs / WEEK_MS) : null;
  const caption = `${WORD[leg.direction]} ${isCurrent ? `since ${dateLabel(leg.startTs, nowMs)}` : spanLabel(leg.startTs, leg.endTs)}`;

  const slot = (width - 2 * PAD_X) / legs.length;
  const mid = height / 2;
  const unit = (mid - 3) / Math.max(0.5, ...legs.map(l => Math.abs(l.delta)));
  const pick = (event: ReactPointerEvent<SVGSVGElement>, toggle: boolean) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * width;
    const target = Math.min(last, Math.max(0, Math.floor((x - PAD_X) / slot)));
    setPicked(toggle && target === index ? null : target === last ? null : target);
  };

  return (
    <section className='body-card body-phase' aria-label='Weight phase'>
      <div className='body-hero-top'>
        <span className='body-phase-caption'>
          <span className='body-glyph' aria-hidden='true'>
            <Icon icon={ARROW[leg.direction]} />
          </span>
          {caption}
        </span>
        <span className='body-chip is-quiet'>
          <Icon icon='mdi:calendar-range' aria-hidden='true' />
          {durationLabel(lengthMs)}
        </span>
      </div>
      <div className='body-figure is-small'>
        {signed(leg.delta)}
        <span className='body-figure-unit'>kg</span>
      </div>
      <div className='body-phase-plot' ref={plotRef}>
        <svg
          className='body-phase-chart'
          viewBox={`0 0 ${width} ${height}`}
          role='img'
          data-interactive='true'
          aria-label={`${legs.length} legs of the weight trend since ${firstYear}. ${caption}, ${signed(leg.delta)} kg.`}
          onPointerDown={event => pick(event, true)}
          onPointerMove={event => event.buttons === 1 && pick(event, false)}
        >
          <rect className='body-phase-pick' x={PAD_X + slot * index} y={0} width={slot} height={height} rx={6} />
          <line className='body-phase-zero' x1={PAD_X} x2={width - PAD_X} y1={mid} y2={mid} />
          {legs.map((l, i) => {
            const barW = Math.min(slot * 0.62, 18);
            const barH = Math.max(2, Math.abs(l.delta) * unit);
            return (
              <rect
                key={l.startIndex}
                className={i === index ? 'body-phase-bar is-picked' : 'body-phase-bar'}
                x={PAD_X + slot * (i + 0.5) - barW / 2}
                y={l.delta >= 0 ? mid - barH : mid}
                width={barW}
                height={barH}
                rx={Math.min(3, barH / 2)}
              />
            );
          })}
        </svg>
      </div>
      <div className='body-phase-axis' aria-hidden='true'>
        <span>{firstYear}</span>
        <span>now</span>
      </div>
      {((isCurrent && fourWeek != null) || (!isCurrent && perWeek != null) || leg.largest) && (
        <div className='body-chips'>
          {isCurrent && fourWeek != null && <RateChip kg={fourWeek} label='4 wk' />}
          {!isCurrent && perWeek != null && <RateChip kg={perWeek} label='per wk' />}
          {leg.largest && (
            <span className='body-chip'>
              <Icon icon='mdi:trophy-outline' aria-hidden='true' />
              Largest since {firstYear}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
