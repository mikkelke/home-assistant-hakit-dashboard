import { useRef } from 'react';
import { BrewChart, type BrewChartProps } from './BrewChart';
import { useElementSize } from './useElementSize';

/** A brew chart drawn at its box's own width, in px, so its text stays crisp at any size. With no `height` it fills the
 * box's height too. */
export function ChartBox({
  className = '',
  height,
  ...chart
}: Omit<BrewChartProps, 'width' | 'height'> & { className?: string; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  const h = height ?? size.height;
  return (
    <div ref={ref} className={`coffee-chartbox ${className}`} style={height != null ? { height } : undefined}>
      {size.width > 0 && h > 0 && <BrewChart {...chart} width={size.width} height={h} />}
    </div>
  );
}
