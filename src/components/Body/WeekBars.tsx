import { signed } from '../../body/chartScale';
import type { WeekdayOffset } from '../../body/insights';
import { useChartSize } from '../../body/useChartSize';

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAYS = [1, 2, 3, 4, 5, 6, 0];
const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PAD_X = 4;
const LABEL_ROOM = 18;
const AXIS_ROOM = 22;

interface WeekBarsProps {
  /** Monday first; only the weekdays with enough weighings. */
  weekdays: WeekdayOffset[];
}

/** How far each weekday's weighings sit above or below the trend, as bars either side of a zero line, with the highest
 * and the lowest named. */
export function WeekBars({ weekdays }: WeekBarsProps) {
  const [plotRef, { width, height }] = useChartSize<HTMLDivElement>({ width: 340, height: 130 });
  const top = weekdays.reduce((best, w) => (w.offset > best.offset ? w : best));
  const bottom = weekdays.reduce((best, w) => (w.offset < best.offset ? w : best));
  const slot = (width - 2 * PAD_X) / 7;
  const mid = LABEL_ROOM + (height - LABEL_ROOM - AXIS_ROOM) / 2;
  const unit = (mid - LABEL_ROOM - 14) / Math.max(0.3, ...weekdays.map(w => Math.abs(w.offset)));
  const summary = weekdays.map(w => `${NAMES[w.day]} ${signed(w.offset)}`).join(', ');

  return (
    <div className='body-rhythm body-week'>
      <div className='body-rhythm-head'>
        <span className='body-caption'>Week</span>
      </div>
      <div className='body-week-plot' ref={plotRef}>
        <svg
          className='body-week-chart'
          viewBox={`0 0 ${width} ${height}`}
          role='img'
          aria-label={`Weight against the trend by weekday, in kg: ${summary}.`}
        >
          <line className='body-week-zero' x1={PAD_X} x2={width - PAD_X} y1={mid} y2={mid} />
          {DAYS.map((day, i) => {
            const w = weekdays.find(o => o.day === day);
            const cx = PAD_X + slot * (i + 0.5);
            const named = w === top || w === bottom;
            const barH = w ? Math.max(1.5, Math.abs(w.offset) * unit) : 0;
            return (
              <g key={day}>
                {w && (
                  <rect
                    className={named ? 'body-week-bar is-named' : 'body-week-bar'}
                    x={cx - Math.min(slot * 0.56, 26) / 2}
                    y={w.offset >= 0 ? mid - barH : mid}
                    width={Math.min(slot * 0.56, 26)}
                    height={barH}
                    rx={Math.min(3, barH / 2)}
                  />
                )}
                {w && named && (
                  <text className='body-week-value' x={cx} y={w.offset >= 0 ? mid - barH - 5 : mid + barH + 13} textAnchor='middle'>
                    {signed(w.offset)}
                  </text>
                )}
                <text className={named ? 'body-chart-xlabel is-named' : 'body-chart-xlabel'} x={cx} y={height - 6} textAnchor='middle'>
                  {LETTERS[i]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
