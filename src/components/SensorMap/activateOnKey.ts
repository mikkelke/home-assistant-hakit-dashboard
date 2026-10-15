import type { KeyboardEvent } from 'react';

/** Enter or Space on a focused mark, for a keyboard user. */
export function activateOnKey(activate: () => void) {
  return (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      activate();
    }
  };
}
