import { useState, useCallback } from 'react';

/**
 * Boolean state persisted to `localStorage` under `key`. Every touch of storage is guarded (same
 * caution as the energy cache: a locked-down/private-mode WebView can throw on read or write) —
 * a blocked store just silently falls back to `defaultValue` / non-persisted state instead of
 * breaking the page. The initial read happens inside the `useState` lazy initializer (the same
 * first-render environment-read pattern `useMediaQuery` uses); only the returned setter ever
 * touches storage again.
 */
export function useLocalStorageBoolean(
  key: string,
  defaultValue: boolean
): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setPersisted = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setValue(prev => {
        const resolved = typeof next === 'function' ? (next as (prev: boolean) => boolean)(prev) : next;
        try {
          window.localStorage.setItem(key, String(resolved));
        } catch {
          // Storage blocked (private mode / full) - state still updates for this session.
        }
        return resolved;
      });
    },
    [key]
  );

  return [value, setPersisted];
}
