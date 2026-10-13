import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PLAN_APPLIANCES } from '../../../config/plan';
import { assembleAppliancePlan } from '../../../energy/appliancePlan';
import { home, hourly, programme } from '../../../energy/__tests__/testUtils';
import { RunLaterCard } from '../RunLaterCard';

const washer = PLAN_APPLIANCES.find(a => a.key === 'washer')!;
const nowMs = home(2026, 10, 12, 15, 30);
const timeline = hourly(home(2026, 10, 12, 15), Array(20).fill(1));

function card(dryer: boolean, withDryer: boolean): string {
  const appliance = assembleAppliancePlan({
    config: washer,
    run: { status: 'idle', etaMs: null },
    programmes: [programme(Array(60).fill(10))],
    dryer: dryer ? programme(Array(60).fill(15)) : null,
    withDryer,
    timeline,
    nowMs,
  });
  return renderToStaticMarkup(createElement(RunLaterCard, { appliance, onOpen: () => {}, onToggleDryer: () => {} }));
}

describe('RunLaterCard dryer chip', () => {
  it('is hidden without a dryer profile', () => {
    const html = card(false, true);
    expect(html).not.toContain('+ dryer');
    expect(html).toContain('>Washer<');
  });

  it('toggles the label between the washer and washer + dryer', () => {
    expect(card(true, false)).toMatch(/aria-pressed="false"[^>]*>\+ dryer</);
    expect(card(true, false)).toContain('>Washer<');
    const on = card(true, true);
    expect(on).toMatch(/aria-pressed="true"[^>]*>\+ dryer</);
    expect(on).toContain('>Washer + dryer<');
  });
});
