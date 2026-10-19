import { Icon } from '@iconify/react';
import { brewProgressPct, faultView, phaseWord, type CoffeeState } from '../../coffee/state';
import { formatHomeClock } from '../../energy/homeTime';
import { useNowMs } from '../../hooks/useNowMs';

/** The brew on the sky's ground while it runs, its stage with a hairline of how far it got; green once ready. Nothing
 * on an ordinary day. */
export function CoffeeTickerChip({ state, onOpen }: { state: CoffeeState; onOpen: () => void }) {
  const nowMs = useNowMs();
  const ready = state.phase === 'ready';
  const paused = state.phase === 'paused';
  const fault = paused ? faultView(state.fault) : null;
  const word = fault?.text ?? phaseWord(state) ?? 'Coffee';
  const tone = ready ? 'is-coffee-ready' : paused ? 'is-coffee-alert' : 'is-coffee';
  const pct = ready ? 100 : brewProgressPct(state, nowMs);
  const eta = !ready && !paused && state.etaMs != null ? formatHomeClock(state.etaMs) : null;
  return (
    <button
      type='button'
      className={`ticker-chip ${tone} is-new`}
      onClick={onOpen}
      aria-label={
        ready
          ? `Coffee ready${state.cupG != null ? `, ${Math.round(state.cupG)} g` : ''}`
          : `Coffee, ${word}${eta ? `, ready about ${eta}` : ''}`
      }
    >
      <Icon icon={fault ? 'mdi:water-off-outline' : 'mdi:coffee'} aria-hidden='true' />
      <b>{word}</b>
      {ready && state.cupG != null && <em>{Math.round(state.cupG)} g</em>}
      {!ready && (
        <span className='ticker-fill' aria-hidden='true'>
          <i style={{ width: `${Math.round(pct)}%` }} />
        </span>
      )}
    </button>
  );
}
