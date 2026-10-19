import { useMemo, useState } from 'react';
import { useHass } from '@hakit/core';
import { Icon } from '@iconify/react';
import { isOnHome } from '../../coffee/state';
import { useCoffeeState } from '../../coffee/useCoffeeState';
import { HOUSE_EVENTS_ENTITY } from '../../config/entities';
import { formatHomeClock } from '../../energy/homeTime';
import { houseEpisodes, houseEventLabel, parseHouseEvents, visibleHouseEvents, type HouseEpisode } from '../../home/houseEvents';
import { useMotionSlot } from '../../home/motionBudget';
import { useNowMs } from '../../hooks/useNowMs';
import { useViewer } from '../../hooks/useViewer';
import { nowFocusAt, type OpenNow } from '../../utils/navigation';
import { trackUiTap } from '../../utils/trackUiTap';
import { CoffeeTickerChip } from './CoffeeTickerChip';
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

const COFFEE_ICON = 'mdi:coffee';

/** The newest few things the house did, on the sky's ground after the people: the newest shows in
 * full, older ones scroll in from under the fade, and a tap opens the timeline on one. A brew under way leads,
 * standing in for its own ready row until it is picked up. */
export function HouseTicker({ onOpenNow, onOpenCoffee }: { onOpenNow: OpenNow; onOpenCoffee?: () => void }) {
  const feed = useHass(s => s.entities[HOUSE_EVENTS_ENTITY]?.attributes?.events);
  const viewer = useViewer();
  const nowMs = useNowMs();
  const coffee = useCoffeeState();
  const coffeeShown = coffee != null && isOnHome(coffee.phase) && onOpenCoffee != null;
  const brewStartMs = coffeeShown ? (coffee.startedAtMs ?? coffee.firstBloomAtMs ?? 0) : null;
  const [shownSinceMs] = useState(() => Date.now());
  const episodes = useMemo(
    () =>
      houseEpisodes(visibleHouseEvents(parseHouseEvents(feed), viewer))
        .filter(episode => brewStartMs == null || episode.rows[0].icon !== COFFEE_ICON || episode.startMs < brewStartMs - 60_000)
        .slice(0, TICKER_EPISODES),
    [feed, viewer, brewStartMs]
  );
  if (episodes.length === 0 && !coffeeShown) return null;
  return (
    <>
      <i className='ticker-divider' aria-hidden='true' />
      <div className='ticker' role='group' aria-label='House activity, newest first'>
        {coffeeShown && onOpenCoffee && <CoffeeTickerChip state={coffee} onOpen={onOpenCoffee} />}
        {episodes.map(episode => (
          <TickerChip
            key={episode.id}
            episode={episode}
            isNew={episode.endMs > shownSinceMs && nowMs - episode.endMs < NEW_FOR_MS}
            onOpen={() => {
              onOpenNow(nowFocusAt('evt', episode.startMs), episode.id);
              trackUiTap('home.ticker');
            }}
          />
        ))}
      </div>
    </>
  );
}
