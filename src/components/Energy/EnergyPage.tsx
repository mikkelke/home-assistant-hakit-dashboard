import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { useEnergyConfig, type Period } from '../../energy';
import { nextDisabled, startOfLocalDay, startOfPeriod, stepAnchor } from '../../energy/period';
import { useSwipeToClose } from '../../hooks';
import { buildHistoryUrlWithHash, getAccessibleHistoryWindow } from '../../utils/navigation';
import { BillTab } from './BillTab';
import { DevicesTab } from './DevicesTab';
import { EnergyTabs } from './EnergyTabs';
import { LiveTab } from './LiveTab';
import { UsageTab } from './UsageTab';
import './EnergyPage.css';

interface EnergyPageProps {
  onClose: () => void;
}

export type EnergyTab = 'live' | 'usage' | 'devices' | 'bill';

const ENERGY_TAB_VALUES: readonly EnergyTab[] = ['live', 'usage', 'devices', 'bill'];

function isEnergyTab(value: string): value is EnergyTab {
  return (ENERGY_TAB_VALUES as readonly string[]).includes(value);
}

/** Reads the initial tab from `#energy=<tab>` — bare `#energy` or anything unrecognized falls back
 * to `live`, the page's default. Goes through `getAccessibleHistoryWindow()` like every other hash
 * read in this app (iframe-safe — see utils/navigation.ts). */
function tabFromHash(): EnergyTab {
  const hash = getAccessibleHistoryWindow()?.location.hash ?? '';
  const candidate = hash.startsWith('#energy=') ? hash.slice('#energy='.length) : '';
  return isEnergyTab(candidate) ? candidate : 'live';
}

export function EnergyPage({ onClose }: EnergyPageProps) {
  const [tab, setTab] = useState<EnergyTab>(() => tabFromHash());
  const [period, setPeriod] = useState<Period>('day');
  const [anchorStartMs, setAnchorStartMs] = useState(() => startOfLocalDay(Date.now()));
  // Clock-in-state (purity lint forbids Date.now()/new Date() in render): a 1-minute tick keeps
  // the period label and the next-arrow clamp correct across midnight.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [unit, setUnit] = useState<'kwh' | 'kr'>('kwh');

  const { config } = useEnergyConfig();

  // Mobile swipe-to-close on the page root (mirrors RoomDetail's usage). The hook's own
  // interactive-target allowlist already ignores buttons/[role="button"] (EnergyTabs' and
  // PeriodPicker's segments and arrows, tappable device rows) and anything marked
  // data-interactive="true" (EnergyChart's SVG, whose bar hit-rects are real tap targets, and the
  // period label's long-press target); it's a no-op on non-mobile viewports.
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
      const hash = nextTab === 'live' ? '#energy' : `#energy=${nextTab}`;
      targetWindow.history.replaceState(null, '', buildHistoryUrlWithHash(targetWindow, hash));
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
          {tab === 'live' && config && <LiveTab config={config} nowMs={nowMs} todayStartMs={todayStartMs} />}

          {tab === 'usage' && (
            <UsageTab
              period={period}
              anchorStartMs={anchorStartMs}
              todayStartMs={todayStartMs}
              nextStepDisabled={nextStepDisabled}
              onPeriodChange={handlePeriodChange}
              onStep={handleStep}
              unit={unit}
              onUnitChange={setUnit}
            />
          )}

          {tab === 'devices' && (
            <DevicesTab
              period={period}
              anchorStartMs={anchorStartMs}
              todayStartMs={todayStartMs}
              nextStepDisabled={nextStepDisabled}
              onPeriodChange={handlePeriodChange}
              onStep={handleStep}
            />
          )}

          {tab === 'bill' && (
            <BillTab
              period={period}
              anchorStartMs={anchorStartMs}
              todayStartMs={todayStartMs}
              nextStepDisabled={nextStepDisabled}
              onPeriodChange={handlePeriodChange}
              onStep={handleStep}
              nowMs={nowMs}
            />
          )}
        </div>
      </div>

      <button className='energy-page-exit' onClick={onClose} aria-label='Close energy'>
        <Icon icon='mdi:chevron-left' />
      </button>
    </div>
  );
}
