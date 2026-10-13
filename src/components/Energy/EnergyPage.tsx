import { memo, useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { useEnergyConfig, type Period } from '../../energy';
import { nextDisabled, startOfLocalDay, startOfPeriod, stepAnchor } from '../../energy/period';
import { useSwipeToClose } from '../../hooks';
import { buildHistoryUrlWithHash, getAccessibleHistoryWindow } from '../../utils/navigation';
import { BillTab } from './BillTab';
import { EnergyTabs } from './EnergyTabs';
import { LiveTab } from './LiveTab';
import { energyHash, energyTabFromHash, type EnergyTab } from './energyTab';
import { PlanTab } from './PlanTab';
import { RoomsTab } from './RoomsTab';
import { UsageTab } from './UsageTab';
import './EnergyPage.css';

interface EnergyPageProps {
  onClose: () => void;
}

/** Reads the initial tab from the `#energy=<tab>` hash through `getAccessibleHistoryWindow()`, like
 * every other hash read in this app (iframe-safe, see utils/navigation.ts). */
function tabFromHash(): EnergyTab {
  return energyTabFromHash(getAccessibleHistoryWindow()?.location.hash ?? '');
}

function EnergyPageView({ onClose }: EnergyPageProps) {
  const [tab, setTab] = useState<EnergyTab>(() => tabFromHash());
  const [period, setPeriod] = useState<Period>('day');
  const [anchorStartMs, setAnchorStartMs] = useState(() => startOfLocalDay(Date.now()));
  // Clock-in-state (purity lint forbids Date.now()/new Date() in render): a 1-minute tick keeps
  // the period label and the next-arrow clamp correct across midnight.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [unit, setUnit] = useState<'kwh' | 'kr'>('kwh');

  const { config } = useEnergyConfig();

  // Mobile swipe-to-close on the page root (mirrors RoomDetail's usage). The hook's own
  // interactive-target allowlist already ignores buttons/[role="button"] and anything marked
  // data-interactive="true" (the Usage chart and clock, and the period label's long-press target);
  // it's a no-op on non-mobile viewports.
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(onClose);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const todayStartMs = useMemo(() => startOfLocalDay(nowMs), [nowMs]);

  const handleTabChange = (nextTab: EnergyTab) => {
    setTab(nextTab);
    const targetWindow = getAccessibleHistoryWindow();
    if (!targetWindow) return;
    try {
      // replaceState fires no hashchange/popstate, and Dashboard's own hash poll still sees kind
      // 'energy' either way — no isUpdatingHashRef guard dance needed here (contrast Dashboard's
      // own history helpers, which do need it to avoid reacting to their own writes).
      targetWindow.history.replaceState(null, '', buildHistoryUrlWithHash(targetWindow, energyHash(nextTab)));
    } catch (err) {
      console.debug('Failed to replace energy tab history:', err);
    }
  };

  const handlePeriodChange = (nextPeriod: Period) => {
    setPeriod(nextPeriod);
    setAnchorStartMs(startOfPeriod(nextPeriod, Date.now()));
  };

  const handleStep = (delta: 1 | -1) => {
    setAnchorStartMs(current => (delta === 1 && nextDisabled(period, current, nowMs) ? current : stepAnchor(period, current, delta)));
  };

  const nextStepDisabled = nextDisabled(period, anchorStartMs, nowMs);

  return (
    <div className='energy-page' onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <div className='energy-page-tabs'>
        <EnergyTabs tab={tab} onChange={handleTabChange} />
      </div>

      <div className='energy-page-content'>
        <div className='energy-page-inner'>
          {tab === 'live' && config && <LiveTab config={config} todayStartMs={todayStartMs} onOpenTab={handleTabChange} />}

          {tab === 'plan' && <PlanTab />}

          {tab === 'usage' && (
            <UsageTab
              period={period}
              anchorStartMs={anchorStartMs}
              todayStartMs={todayStartMs}
              nowMs={nowMs}
              nextStepDisabled={nextStepDisabled}
              onPeriodChange={handlePeriodChange}
              onStep={handleStep}
              unit={unit}
              onUnitChange={setUnit}
            />
          )}

          {tab === 'rooms' && (
            <RoomsTab
              period={period}
              anchorStartMs={anchorStartMs}
              todayStartMs={todayStartMs}
              nextStepDisabled={nextStepDisabled}
              onPeriodChange={handlePeriodChange}
              onStep={handleStep}
            />
          )}

          {tab === 'bill' && <BillTab nowMs={nowMs} todayStartMs={todayStartMs} />}
        </div>
      </div>

      <button className='energy-page-exit' onClick={onClose} aria-label='Close energy'>
        <Icon icon='mdi:chevron-left' />
      </button>
    </div>
  );
}

/** Memoised: its only prop is a stable callback, so a Dashboard re-render does not re-render the whole page. */
export const EnergyPage = memo(EnergyPageView);
