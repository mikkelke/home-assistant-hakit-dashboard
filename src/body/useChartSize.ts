import { useEffect, useState } from 'react';

export interface ChartSize {
  width: number;
  height: number;
}

/** The size of the element the returned ref is put on, in whole pixels, for a chart that draws one unit per pixel. */
export function useChartSize<T extends HTMLElement>(initial: ChartSize = { width: 340, height: 160 }): [(el: T | null) => void, ChartSize] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState(initial);
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: Math.max(120, Math.round(entry.contentRect.width)), height: Math.max(40, Math.round(entry.contentRect.height)) })
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, size];
}
