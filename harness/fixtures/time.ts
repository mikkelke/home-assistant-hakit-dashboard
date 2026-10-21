export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** A deterministic pseudo-random sequence for a seed, in [0, 1). */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export const iso = (ms: number): string => new Date(ms).toISOString();

/** A smooth day-and-night wave around `base`, peaking mid-afternoon, with a little noise that is the same on every run. */
export function dailyWave(base: number, amplitude: number, seed: number): (ms: number) => number {
  const noise = rng(seed);
  const jitter = new Map<number, number>();
  return ms => {
    const hourOfDay = (((ms / HOUR) % 24) + 24 + 2) % 24;
    const key = Math.floor(ms / (10 * MINUTE));
    if (!jitter.has(key)) jitter.set(key, (noise() - 0.5) * 0.3);
    return Math.round((base + Math.sin(((hourOfDay - 9) / 24) * Math.PI * 2) * amplitude + (jitter.get(key) ?? 0)) * 10) / 10;
  };
}
