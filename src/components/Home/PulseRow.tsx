import { useMemo } from 'react';
import { useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import { HOUSE_UPCOMING_ENTITY, QUIET_HOURS_END_ENTITY, QUIET_HOURS_START_ENTITY, SUN_ENTITY } from '../../config/entities';
import { formatHomeClock } from '../../energy/homeTime';
import { useEnergyConfig } from '../../energy/useEnergyConfig';
import { parseHouseUpcoming } from '../../home/houseUpcoming';
import { timelineMarkers } from '../../home/markers';
import { nextUp } from '../../home/nextUp';
import { readQuietHours } from '../../home/quietHours';
import { readUpcoming } from '../../home/upcoming';
import { useNowMs } from '../../hooks/useNowMs';
import { useTrackedEntities } from '../../hooks/useTrackedEntities';
import { useViewer } from '../../hooks/useViewer';
import { formatW } from '../../utils/format';
import type { OpenNow } from '../../utils/navigation';
import { trackUiTap } from '../../utils/trackUiTap';
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

/** The soonest thing in the house the viewer sees, of any kind; a tap opens the timeline on it. */
function NextChip({ onOpenNow }: { onOpenNow: OpenNow }) {
  const entities = useTrackedEntities();
  const viewer = useViewer();
  const nowMs = useNowMs();
  // Primitive selectors: `sun.sun` changes every few minutes, but these values only a few times a day.
  const nextRising = useHass(s => s.entities[SUN_ENTITY]?.attributes?.next_rising);
  const nextSetting = useHass(s => s.entities[SUN_ENTITY]?.attributes?.next_setting);
  const quietStart = useHass(s => s.entities[QUIET_HOURS_START_ENTITY]?.state);
  const quietEnd = useHass(s => s.entities[QUIET_HOURS_END_ENTITY]?.state);
  const next = useMemo(
    () =>
      nextUp(
        readUpcoming(id => entities[id], nowMs, viewer),
        timelineMarkers(nextRising, nextSetting, readQuietHours(quietStart, quietEnd), nowMs),
        parseHouseUpcoming(entities[HOUSE_UPCOMING_ENTITY]?.attributes, nowMs),
        viewer
      ),
    [entities, nowMs, viewer, nextRising, nextSetting, quietStart, quietEnd]
  );
  const time = next ? (next.atMs <= nowMs ? 'Soon' : formatHomeClock(next.atMs)) : null;
  return (
    <button
      type='button'
      className={`pulse-chip pulse-next ${next ? '' : 'is-empty'}`}
      onClick={() => {
        onOpenNow(next?.focus ?? null, next?.itemId);
        trackUiTap('home.next', next?.focus?.kind);
      }}
      aria-label={next ? `Next: ${next.name} ${time}, open timeline` : 'Open timeline'}
    >
      <Icon icon='mdi:timeline-clock-outline' className='pulse-rail' aria-hidden='true' />
      {next && (
        <>
          {time}
          <Icon icon={next.icon} className='pulse-next-icon' aria-hidden='true' />
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
