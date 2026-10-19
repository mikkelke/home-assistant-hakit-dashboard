import { useEffect, useState } from 'react';

/** Epoch ms that moves on every `everyMs` while the page shows: the stage's countdowns and ages tick with it. */
export function useClock(everyMs = 1000, active = true): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (!document.hidden) setNowMs(Date.now());
    };
    const timer = setInterval(tick, everyMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [everyMs, active]);
  return nowMs;
}
