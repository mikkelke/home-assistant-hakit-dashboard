import './ApplianceCycleTiming.css';

export interface ApplianceCycleTimingProps {
  /** True when we have at least start, end, or remaining info (not a bare “running” state). */
  hasDetail: boolean;
  startedDisplay?: string;
  estimatedEndTime?: string;
  /** e.g. "20 min left" or "Almost done" */
  countdownLabel: string | null;
  formatTimeOnly: (isoOrTime: string | undefined) => string;
}

function Sep() {
  return (
    <span className='appliance-cycle-timing__sep' aria-hidden>
      ·
    </span>
  );
}

/**
 * Single-line cycle timing for washer / dryer / dishwasher while Running.
 */
export function ApplianceCycleTiming({
  hasDetail,
  startedDisplay,
  estimatedEndTime,
  countdownLabel,
  formatTimeOnly,
}: ApplianceCycleTimingProps) {
  const endFormatted = estimatedEndTime != null && String(estimatedEndTime).trim() !== '' ? formatTimeOnly(estimatedEndTime) : '';

  const timeLeftShort =
    countdownLabel && countdownLabel !== 'Almost done' ? countdownLabel.replace(/\s+left$/i, '').trim() || countdownLabel : null;

  const hasStarted = Boolean(startedDisplay && String(startedDisplay).trim() !== '');

  if (!hasDetail) {
    return <span className='appliance-cycle-timing__placeholder'>Running…</span>;
  }

  if (countdownLabel === 'Almost done') {
    return (
      <div className='appliance-cycle-timing' aria-label='Cycle timing'>
        <span className='appliance-cycle-timing__emph'>Almost done</span>
        {hasStarted && (
          <>
            <Sep />
            <span className='appliance-cycle-timing__muted'>Started {startedDisplay}</span>
          </>
        )}
      </div>
    );
  }

  if (timeLeftShort) {
    return (
      <div className='appliance-cycle-timing' aria-label='Cycle timing'>
        <span>
          <span className='appliance-cycle-timing__emph'>{timeLeftShort}</span>
          <span className='appliance-cycle-timing__suffix'> left</span>
        </span>
        {endFormatted && (
          <>
            <Sep />
            <span>
              Done ~<span className='appliance-cycle-timing__time'>{endFormatted}</span>
            </span>
          </>
        )}
        {hasStarted && (
          <>
            <Sep />
            <span className='appliance-cycle-timing__muted'>Started {startedDisplay}</span>
          </>
        )}
      </div>
    );
  }

  if (endFormatted) {
    return (
      <div className='appliance-cycle-timing' aria-label='Cycle timing'>
        <span>
          Done ~<span className='appliance-cycle-timing__time'>{endFormatted}</span>
        </span>
        {hasStarted && (
          <>
            <Sep />
            <span className='appliance-cycle-timing__muted'>Started {startedDisplay}</span>
          </>
        )}
      </div>
    );
  }

  if (hasStarted) {
    return (
      <div className='appliance-cycle-timing' aria-label='Cycle timing'>
        <span className='appliance-cycle-timing__muted'>In progress</span>
        <Sep />
        <span className='appliance-cycle-timing__muted'>Started {startedDisplay}</span>
      </div>
    );
  }

  return <span className='appliance-cycle-timing__placeholder'>Running…</span>;
}
