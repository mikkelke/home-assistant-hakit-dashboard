import { useMemo } from 'react';
import { useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import { formatHomeClock } from '../../energy/homeTime';
import { useEnergyConfig } from '../../energy/useEnergyConfig';
import { nextTimedItem, readUpcoming, upcomingFocus, type UpcomingItem } from '../../home/upcoming';
import { useNowMs } from '../../hooks/useNowMs';
import { useTrackedEntities } from '../../hooks/useTrackedEntities';
import { useViewer } from '../../hooks/useViewer';
import { formatW } from '../../utils/format';
import type { OpenNow } from '../../utils/navigation';
import type { EnergyTab } from '../Energy/energyTab';
import { PriceAdvisor } from '../PriceAdvisor';
import './PulseRow.css';

function watts(state: string | undefined): number | null {
  if (state == null || state === '' || state === 'unknown' || state === 'unavailable') return null;
  const value = Number(state);
  return Number.isFinite(value) ? Math.round(value) : null;
}

/** Grid draw right now; the grid power sensor changes several times a minute, so only this chip
 * follows it. */
function PowerChip({ onOpen }: { onOpen: () => void }) {
  const { config } = useEnergyConfig();
  const gridId = config?.gridPowerEntityId ?? null;
  const gridW = useHass(s => (gridId ? watts(s.entities[gridId]?.state) : null));
  return (
    <button type='button' className='pulse-chip' onClick={onOpen} aria-label='Power now, open live energy'>
      <span className='pulse-live' aria-hidden='true' />
      {gridW == null ? '— W' : formatW(gridW)}
    </button>
  );
}

function itemIcon(item: UpcomingItem): string {
  if (item.type === 'appliance') return item.appliance.config.icon;
  return item.type === 'wake' ? 'mdi:alarm' : 'mdi:robot-vacuum';
}

function itemName(item: UpcomingItem): string {
  if (item.type === 'appliance') return `${item.appliance.config.label} done`;
  return item.type === 'wake' ? 'Wake alarm' : 'Rober2';
}

/** The next timed thing in the house; a tap opens the timeline on it. */
function NextChip({ onOpenNow }: { onOpenNow: OpenNow }) {
  const entities = useTrackedEntities();
  const viewer = useViewer();
  const nowMs = useNowMs();
  const next = useMemo(() => nextTimedItem(readUpcoming(id => entities[id], nowMs, viewer)), [entities, nowMs, viewer]);
  const overrun = next?.atMs != null && next.atMs <= nowMs;
  const time = next?.atMs != null ? (overrun ? 'Soon' : formatHomeClock(next.atMs)) : null;
  return (
    <button
      type='button'
      className={`pulse-chip pulse-next ${next ? '' : 'is-empty'}`}
      onClick={() => onOpenNow(next ? upcomingFocus(next) : null)}
      aria-label={next && time ? `Next: ${itemName(next)} ${time}, open timeline` : 'Open timeline'}
    >
      <Icon icon='mdi:timeline-outline' className='pulse-rail' aria-hidden='true' />
      {next && time && (
        <>
          {time}
          <Icon icon={itemIcon(next)} className='pulse-next-icon' aria-hidden='true' />
        </>
      )}
    </button>
  );
}

interface PulseRowProps {
  onOpenEnergy: (tab: EnergyTab) => void;
  onOpenNow: OpenNow;
}

/** Power now, the price band and the next thing, under the sky. */
export function PulseRow({ onOpenEnergy, onOpenNow }: PulseRowProps) {
  return (
    <div className='pulse-row'>
      <PowerChip onOpen={() => onOpenEnergy('live')} />
      <PriceAdvisor onOpen={() => onOpenEnergy('plan')} />
      <NextChip onOpenNow={onOpenNow} />
    </div>
  );
}
