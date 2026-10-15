import { BUCKET_LABEL, BUCKET_SHORT, DBM_BUCKETS, type ApChoice } from '../../sensorMap/coverage';

interface CoverageBarProps {
  choices: readonly ApChoice[];
  selected: string;
  /** How many captures with a reading the filter lets through. */
  shown: number;
  onSelect: (id: string) => void;
}

/** The legend of the coverage colours and the access point filter, under the layer chips. */
export function CoverageBar({ choices, selected, shown, onSelect }: CoverageBarProps) {
  return (
    <div className='sm-subbar' role='group' aria-label='Wi-Fi coverage'>
      <div className='sm-subbar-row'>
        {DBM_BUCKETS.map(bucket => (
          <span key={bucket} className='sm-chip small static' title={BUCKET_LABEL[bucket]}>
            <span className={`sm-dot cov b-${bucket}`} />
            {BUCKET_SHORT[bucket]}
          </span>
        ))}
      </div>
      <div className='sm-subbar-row' role='group' aria-label='Access point'>
        {choices.map(choice => (
          <button
            key={choice.id}
            type='button'
            className='sm-chip small toggle'
            aria-pressed={selected === choice.id}
            onClick={() => onSelect(choice.id)}
          >
            {choice.label} <span className='sm-count'>{choice.count}</span>
          </button>
        ))}
      </div>
      {shown === 0 && <p className='sm-subbar-note'>No capture holds a Wi-Fi reading yet.</p>}
    </div>
  );
}
