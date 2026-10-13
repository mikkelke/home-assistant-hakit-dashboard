import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { assignPriceBands } from '../../../energy/priceBands';
import type { CostCurve } from '../../../energy/startPlan';
import { home, hourly } from '../../../energy/__tests__/testUtils';
import { CostByStartChart } from '../CostByStartChart';
import { PriceCurve48 } from '../PriceCurve48';

const numbers = (text: string) => text.match(/-?\d+(\.\d+)?/g)!.map(Number);

describe('negative prices in the Plan charts', () => {
  it('draws negative run costs below the zero line, the cheaper start deeper', () => {
    const t0 = home(2026, 10, 9, 20);
    const curve: CostCurve = {
      points: Array.from({ length: 24 }, (_, i) => ({
        startMs: t0 + i * 300_000,
        costKr: i < 12 ? -1 : -2,
        estimated: false,
        tooLate: false,
      })),
      knobs: [],
    };
    const svg = renderToStaticMarkup(createElement(CostByStartChart, { curve, plan: null, startLabel: 'now', doneByLabel: null }));
    const paths = Array.from(svg.matchAll(/class="plan-cost-bar" d="([^"]+)"|d="([^"]+)" class="plan-cost-bar"/g)).map(m => m[1] ?? m[2]);
    expect(paths).toHaveLength(2);
    const [first, second] = paths.map(d => {
      const base = numbers(d)[1];
      const tops = Array.from(d.matchAll(/V (-?[\d.]+)/g)).map(m => Number(m[1]));
      return { base, deepest: Math.max(...tops) };
    });
    for (const run of [first, second]) {
      expect(run.base).toBeGreaterThanOrEqual(0);
      expect(run.deepest).toBeGreaterThan(run.base);
      expect(run.deepest).toBeLessThanOrEqual(122);
    }
    expect(second.deepest).toBeGreaterThan(first.deepest);
  });

  it('keeps all-negative hourly prices inside the price chart, below the zero line', () => {
    const today = home(2026, 10, 9);
    const banded = assignPriceBands(
      hourly(
        today,
        Array.from({ length: 24 }, (_, h) => -0.1 - h * 0.01)
      )
    );
    const svg = renderToStaticMarkup(
      createElement(PriceCurve48, { banded, nowMs: home(2026, 10, 9, 12), cheapest: null, peakHours: null })
    );
    const bars = Array.from(svg.matchAll(/<rect x="[^"]+" y="([^"]+)" width="[^"]+" height="([^"]+)"[^>]*class="plan-bar"/g)).map(m => ({
      y: Number(m[1]),
      h: Number(m[2]),
    }));
    expect(bars).toHaveLength(24);
    const zeroY = Math.min(...bars.map(b => b.y));
    for (const bar of bars) {
      expect(bar.y).toBe(zeroY);
      expect(bar.y + bar.h).toBeLessThanOrEqual(132);
      expect(bar.y).toBeGreaterThanOrEqual(0);
    }
    expect(bars[23].h).toBeGreaterThan(bars[0].h);
  });
});
