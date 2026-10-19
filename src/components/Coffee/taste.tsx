import { useState } from 'react';
import { sendCoffeeCommand } from '../../coffee/command';
import { TASTES, type Taste } from '../../coffee/model';

const LONG: Record<Taste, string> = { sour: 'Sour', balanced: 'Balanced', bitter: 'Bitter' };
const SHORT: Record<Taste, string> = { sour: 'Sour', balanced: 'Bal.', bitter: 'Bitter' };

export function TasteDot({ taste, long = false }: { taste: Taste | null; long?: boolean }) {
  return <span className={`coffee-tdot is-${taste ?? 'none'}`}>{taste ? (long ? LONG : SHORT)[taste] : '—'}</span>;
}

/** One tap rates the brew. The tap shows at once and holds until the ledger has it. */
export function TasteRow({ brewId, rating, size = 'lg' }: { brewId: string | null; rating: Taste | null; size?: 'lg' | 'sm' }) {
  const [tapped, setTapped] = useState<{ taste: Taste; base: Taste | null; brewId: string } | null>(null);
  const shown = tapped && tapped.brewId === brewId && tapped.base === rating ? tapped.taste : rating;
  return (
    <div className={`coffee-trow is-${size}`} role='radiogroup' aria-label='How is it?'>
      {TASTES.map(taste => (
        <button
          key={taste}
          type='button'
          role='radio'
          aria-checked={shown === taste}
          className={shown === taste ? 'is-on' : ''}
          disabled={!brewId}
          onClick={() => {
            if (!brewId) return;
            setTapped({ taste, base: rating, brewId });
            void sendCoffeeCommand('rate', { brew_id: brewId, taste }).catch(() => setTapped(null));
          }}
        >
          {LONG[taste]}
        </button>
      ))}
    </div>
  );
}
