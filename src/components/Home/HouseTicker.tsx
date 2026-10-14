import { useMemo, useState } from 'react';
import { useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import { HOUSE_EVENTS_ENTITY } from '../../config/entities';
import { formatHomeClock } from '../../energy/homeTime';
import { houseEpisodes, houseEventLabel, parseHouseEvents, visibleHouseEvents, type HouseEpisode } from '../../home/houseEvents';
import { useMotionSlot } from '../../home/motionBudget';
import { useNowMs } from '../../hooks/useNowMs';
import { useViewer } from '../../hooks/useViewer';
import { nowFocusAt, type OpenNow } from '../../utils/navigation';
import './HouseTicker.css';

const TICKER_EPISODES = 3;
/** An episode that arrived while the screen was open is marked new for this long, in ms. */
const NEW_FOR_MS = 10 * 60_000;
const ARRIVAL_MS = 320;

function TickerChip({ episode, isNew, onOpen }: { episode: HouseEpisode; isNew: boolean; onOpen: () => void }) {
  const arriving = useMotionSlot(`ticker:${episode.id}`, 'oneShot', isNew, ARRIVAL_MS);
  const first = episode.rows[0];
  const last = episode.rows[episode.rows.length - 1];
  const label = houseEventLabel(last);
  const time = formatHomeClock(episode.startMs);
  return (
    <button
      type='button'
      className={`ticker-chip ${isNew ? 'is-new' : ''} ${arriving ? 'is-anim' : ''}`}
      onClick={onOpen}
      aria-label={`${last.effect ?? last.text}, ${time}`}
    >
      <Icon icon={first.icon} aria-hidden='true' />
      {last.icon !== first.icon && (
        <>
          <Icon icon='mdi:arrow-right' className='ticker-arrow' aria-hidden='true' />
          <Icon icon={last.icon} aria-hidden='true' />
        </>
      )}
      {label && <b>{label}</b>}
      <em>{time}</em>
    </button>
  );
}

/** The newest few things the house did, under the pulse row; a tap opens the timeline on one. */
export function HouseTicker({ onOpenNow }: { onOpenNow: OpenNow }) {
  const feed = useHass(s => s.entities[HOUSE_EVENTS_ENTITY]?.attributes?.events);
  const viewer = useViewer();
  const nowMs = useNowMs();
  const [shownSinceMs] = useState(() => Date.now());
  const episodes = useMemo(
    () => houseEpisodes(visibleHouseEvents(parseHouseEvents(feed), viewer)).slice(0, TICKER_EPISODES),
    [feed, viewer]
  );
  return (
    <div className='ticker'>
      <button type='button' className='ticker-history' onClick={() => onOpenNow(null)} aria-label='House activity'>
        <Icon icon='mdi:timeline-clock-outline' />
      </button>
      {episodes.map(episode => (
        <TickerChip
          key={episode.id}
          episode={episode}
          isNew={episode.endMs > shownSinceMs && nowMs - episode.endMs < NEW_FOR_MS}
          onOpen={() => onOpenNow(nowFocusAt('evt', episode.startMs), episode.id)}
        />
      ))}
    </div>
  );
}
