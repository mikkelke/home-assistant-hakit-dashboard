interface StatsStateProps {
  error: string | null;
  onRetry: () => void;
}

/** Stand-in for a tab's numbers while its statistics are missing: the error with a retry, else a
 * loading skeleton. */
export function StatsState({ error, onRetry }: StatsStateProps) {
  return (
    <div className='plan-card plan-card--chart'>
      {error ? (
        <div className='energy-page-state-error'>
          <p>{error}</p>
          <button type='button' onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : (
        <div className='energy-chart-skeleton' aria-hidden='true' />
      )}
    </div>
  );
}
