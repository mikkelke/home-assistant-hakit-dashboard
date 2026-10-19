import { drSeed, drStatus, progressText, type DrFollowed, type DrResult } from './drtv';
import { PosterArt, StatusIcon } from './parts';

interface DrResultsRowProps {
  results: DrResult[];
  stale: boolean;
  onOpen: (result: DrResult) => void;
}

/** DR shows in one row that scrolls sideways. `data-interactive` keeps a sideways swipe on it from closing the sheet. */
export function DrResultsRow({ results, stale, onOpen }: DrResultsRowProps) {
  return (
    <div className={`rq-dr ${stale ? 'is-stale' : ''}`} data-interactive='true'>
      {results.map(result => (
        <button
          key={result.id}
          type='button'
          className='rq-cell'
          aria-label={result.following ? `${result.title}, DR, following` : `${result.title}, DR`}
          onClick={() => onOpen(result)}
        >
          <PosterArt seed={drSeed(result.id)} title={result.title} src={result.poster} />
          <span className='rq-mark'>DR</span>
          {result.following && <StatusIcon status='available' className='rq-badge' />}
        </button>
      ))}
    </div>
  );
}

interface DrFollowedRowProps {
  entry: DrFollowed;
  onOpen: (entry: DrFollowed) => void;
}

export function DrFollowedRow({ entry, onOpen }: DrFollowedRowProps) {
  return (
    <button type='button' className='rq-row' aria-label={`${entry.title}, DR, ${progressText(entry)}`} onClick={() => onOpen(entry)}>
      <PosterArt seed={drSeed(entry.id)} title={entry.title} src={entry.poster} />
      <span className='rq-row-title'>
        <span className='rq-mark rq-mark--inline'>DR</span>
        {entry.title}
      </span>
      <StatusIcon status={drStatus(entry)} className='rq-ring' />
    </button>
  );
}
