import { useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import type { PlanApplianceKey } from '../../config/plan';
import { assignPriceBands, PRICE_BAND_LABEL, PRICE_BANDS } from '../../energy/priceBands';
import { useAppliancePlans } from '../../energy/useAppliancePlans';
import { krValue } from '../../energy/planView';
import { AppliancePlanSheet } from './AppliancePlanSheet';
import { CheapestHero } from './CheapestHero';
import { PriceCurve48 } from './PriceCurve48';
import { RunLaterCard } from './RunLaterCard';
import { WeekAhead } from './WeekAhead';
import './PlanTab.css';

/** Tab "Plan": when to run things. The cheapest 3 hours ahead, today's and tomorrow's prices in
 * relative bands, start advice per appliance from its measured run profile, and the week ahead.
 * Reads live entities only; no recorder or history calls. */
export function PlanTab() {
  const { nowMs, timeline, cheapest, tomorrowValid, peakHours, profilesError, appliances } = useAppliancePlans();
  const banded = useMemo(() => assignPriceBands(timeline), [timeline]);
  const [openKey, setOpenKey] = useState<PlanApplianceKey | null>(null);
  const [showBandInfo, setShowBandInfo] = useState(false);

  const totalSavingKr = appliances.reduce((sum, a) => sum + (a.run.status === 'idle' ? (a.plan?.savingKr ?? 0) : 0), 0);
  const open = appliances.find(a => a.config.key === openKey) ?? null;

  if (timeline.length === 0) {
    return (
      <div className='plan-empty'>
        <Icon icon='mdi:flash-off-outline' aria-hidden='true' />
        <span>No electricity prices right now</span>
      </div>
    );
  }

  return (
    <div className='plan-tab'>
      <CheapestHero cheapest={cheapest} banded={banded} nowMs={nowMs} tomorrowValid={tomorrowValid} />

      <div className='plan-card plan-card--chart'>
        <PriceCurve48 banded={banded} nowMs={nowMs} cheapest={cheapest} peakHours={peakHours} />
      </div>

      <div className='plan-chips plan-legend'>
        <span className='plan-chip plan-chip--tiny plan-chip--strip'>
          {PRICE_BANDS.map(band => (
            <span key={band} className={`plan-legend-item band--${band}`}>
              <i className='plan-dot' />
              {PRICE_BAND_LABEL[band]}
            </span>
          ))}
        </span>
        <button
          type='button'
          className={`plan-chip plan-chip--tiny plan-chip--ghost plan-chip--button ${showBandInfo ? 'plan-chip--on' : ''}`}
          aria-expanded={showBandInfo}
          onClick={() => setShowBandInfo(value => !value)}
        >
          <Icon icon='mdi:information-outline' aria-hidden='true' />
          quarters
        </button>
      </div>
      {showBandInfo && <p className='plan-note'>Each day's hours ranked into quarters. Hatched hours are forecast.</p>}

      <div className='plan-row-head'>
        <span>Run later</span>
        {totalSavingKr > 0 && <span className='plan-chip band--cheap plan-chip--band'>save {krValue(totalSavingKr)} kr</span>}
        {profilesError && (
          <span className='plan-chip plan-chip--ghost'>
            <Icon icon='mdi:chart-timeline-variant' aria-hidden='true' />
            no run profiles
          </span>
        )}
      </div>
      <div className='plan-stack'>
        {appliances.map(appliance => (
          <RunLaterCard key={appliance.config.key} appliance={appliance} onOpen={() => setOpenKey(appliance.config.key)} />
        ))}
      </div>

      <WeekAhead timeline={timeline} nowMs={nowMs} />

      {open && open.programme && (
        <AppliancePlanSheet appliance={open} timeline={timeline} banded={banded} nowMs={nowMs} onClose={() => setOpenKey(null)} />
      )}
    </div>
  );
}
