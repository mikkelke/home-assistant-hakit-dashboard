import { useHass } from '@hakit/core';

export function useAnovaReachable(): boolean {
  return useHass(store => {
    const state = store.entities?.['climate.anova_cooker']?.state;
    return state != null && state !== 'unavailable' && state !== 'unknown';
  });
}
