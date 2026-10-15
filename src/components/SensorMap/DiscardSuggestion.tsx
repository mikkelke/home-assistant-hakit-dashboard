import { useEffect, useState } from 'react';

/** A confirming tap does nothing for this long after it appears, so the second tap of a double tap cannot confirm. */
export const DISCARD_ARM_MS = 600;

interface DiscardSuggestionProps {
  onDiscard: () => void;
  small?: boolean;
}

/** The control that throws a suggestion away. It asks first, and its confirming tap is dead for a moment, so a suggestion
 * is never lost to one stray touch. */
export function DiscardSuggestion({ onDiscard, small = false }: DiscardSuggestionProps) {
  const [stage, setStage] = useState<'idle' | 'asking' | 'armed'>('idle');
  const size = small ? ' small' : '';

  useEffect(() => {
    if (stage !== 'asking') return;
    const timer = setTimeout(() => setStage('armed'), DISCARD_ARM_MS);
    return () => clearTimeout(timer);
  }, [stage]);

  if (stage === 'idle') {
    return (
      <button type='button' className={`sm-chip${size}`} onClick={() => setStage('asking')}>
        Discard suggestion
      </button>
    );
  }
  return (
    <span className='sm-discard' role='group' aria-label='Discard this suggestion?'>
      <span className='sm-muted'>Discard this suggestion?</span>
      <button type='button' className={`sm-chip${size}`} onClick={() => setStage('idle')}>
        Keep it
      </button>
      <button type='button' className={`sm-chip warn${size}`} disabled={stage !== 'armed'} onClick={onDiscard}>
        Yes, discard
      </button>
    </span>
  );
}
