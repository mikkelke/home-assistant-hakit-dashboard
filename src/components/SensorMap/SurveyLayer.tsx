import { memo } from 'react';
import type { SurveyPoint, SurveyProgress } from '../../sensorMap/survey';
import { activateOnKey } from './activateOnKey';

interface SurveyLayerProps {
  points: readonly SurveyPoint[];
  progress: SurveyProgress;
  yTop: number;
  /** The point being captured. */
  activeId: string | null;
  onActivate: (id: string) => void;
}

const STATUS_TEXT = { todo: 'to do', done: 'done', skipped: 'skipped' } as const;

/** The survey points: numbered rings, hollow while to do, solid once captured (amber when the capture holds no Wi-Fi),
 * dashed when skipped. A captured point is drawn where it was captured. */
export const SurveyLayer = memo(function SurveyLayer({ points, progress, yTop, activeId, onActivate }: SurveyLayerProps) {
  return (
    <g className='sm-survey'>
      {points.map(point => {
        const status = progress.status[point.id] ?? 'todo';
        const capture = progress.latest[point.id];
        const [x, y] = capture ? [capture.pos.x, capture.pos.y] : point.at;
        const noWifi = status === 'done' && capture?.wifi.dbm === null;
        const classes = ['sm-sv', status, noWifi ? 'nowifi' : '', activeId === point.id ? 'sel' : ''].filter(Boolean).join(' ');
        return (
          <g
            key={point.id}
            className={classes}
            transform={`translate(${x} ${yTop - y})`}
            data-hit='survey'
            data-id={point.id}
            tabIndex={0}
            role='button'
            aria-label={`Survey point ${point.n}, ${point.label}, ${STATUS_TEXT[status]}${noWifi ? ', no Wi-Fi' : ''}`}
            onKeyDown={activateOnKey(() => onActivate(point.id))}
          >
            <title>{`${point.n}: ${point.label}`}</title>
            <g className='sm-mk-hit'>
              <circle r={22} />
            </g>
            <g className='sm-mk-body'>
              <circle className='sm-sv-halo' r={15} />
              <circle className='sm-sv-ring' r={11} />
              <text className='sm-sv-n' y={0.5}>
                {point.n}
              </text>
              {activeId === point.id && (
                <text className='sm-mk-name' x={16} y={4}>
                  {point.label}
                </text>
              )}
            </g>
          </g>
        );
      })}
    </g>
  );
});
