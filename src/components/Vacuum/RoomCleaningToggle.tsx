import { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import {
  VACUUM_ENTITY,
  VACUUM_CURRENT_ROOM_SENSOR,
  ROBOT_CLEAN_PREFIX,
  ROBOT_CLEAN_KITCHEN_1,
  ROBOT_CLEAN_KITCHEN_2,
} from '../../config/entities';
import { useModalBackButton, useSwipeToClose } from '../../hooks';
import { formatRoberRoomName } from './rooms';
import { fetchMapsIndex, formatMapDate, latestMapForRoom, type MapEntry } from './maps';
import './VacuumCard.css';

// The request row every room that isn't the kitchen gets: one line, one control. The room's
// request IS a boolean, so it wears the same knob as the Rober2 card's own preference row;
// words only state ("Requested", "Cleaning here").

interface RoomCleaningToggleProps {
  areaName: string;
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

/** "2026-07-31" -> "Cleaned today" / "yesterday" / "3 days ago" / "21/04". Older dates use
 * Danish day-month order (the household reads DD/MM, never MM/DD). Empty for a missing or
 * unparseable value: a room that has never been cleaned says nothing rather than guessing. */
function lastCleanLabel(raw: string | undefined, todayMs: number): string | null {
  if (!raw || raw === 'unknown' || raw === 'unavailable') return null;
  const then = Date.parse(`${raw}T12:00:00`);
  if (!Number.isFinite(then)) return null;
  const days = Math.round((todayMs - then) / 86_400_000);
  if (days <= 0) return 'Cleaned today';
  if (days === 1) return 'Cleaned yesterday';
  if (days < 7) return `Cleaned ${days} days ago`;
  const d = new Date(then);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `Cleaned ${dd}/${mm}`;
}

interface RequestRowProps {
  title: string;
  requested: boolean;
  cleaningHere: boolean;
  lastClean: string | null;
  onToggle: () => void;
  /** Present when this room has an archived run: the small map button opens it. */
  onOpenMap?: () => void;
}

function RequestRow({ title, requested, cleaningHere, lastClean, onToggle, onOpenMap }: RequestRowProps) {
  return (
    <div
      className='rober-request-row'
      onClick={onToggle}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      role='switch'
      tabIndex={0}
      aria-checked={requested}
      aria-label={`${title} — request a clean`}
      title={requested ? 'Cancel cleaning request' : 'Request cleaning'}
    >
      <span className={`rober-request-glyph ${cleaningHere ? 'is-live' : ''}`}>
        <Icon icon='mdi:broom' aria-hidden='true' />
      </span>
      <span className='rober-request-title'>{title}</span>
      {cleaningHere ? (
        <span className='rober-request-state tint'>Cleaning here</span>
      ) : requested ? (
        <span className='rober-request-state muted'>Requested</span>
      ) : lastClean ? (
        // The idle row had nothing to say; the last-clean date is the one fact worth
        // knowing before you ask for another pass (user 2026-07-31).
        <span className='rober-request-state faint'>{lastClean}</span>
      ) : null}
      {onOpenMap && (
        <button
          type='button'
          className='rober-request-map'
          onClick={e => {
            e.stopPropagation();
            onOpenMap();
          }}
          aria-label={`${title} — see the last cleaning run`}
          title='Last cleaning run'
        >
          <Icon icon='mdi:map-outline' aria-hidden='true' />
        </button>
      )}
      <span className={`rober-knob ${requested ? 'on' : ''}`} aria-hidden='true' />
    </div>
  );
}

/** The archived-run viewer: the Rober2 card's map modal, openable from a request row. */
function RoomMapModal({ map, onClose }: { map: MapEntry; onClose: () => void }) {
  const { requestClose } = useModalBackButton({ isOpen: true, onRequestClose: onClose, historyKey: 'rober-room-map' });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestClose);
  return (
    <>
      <div className='vacuum-map-overlay' onClick={requestClose} />
      <div className='vacuum-map-modal' onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
        <div className='vacuum-map-modal-header'>
          <div className='vacuum-map-modal-title'>
            <Icon icon='mdi:map' />
            <div>
              <span className='room'>{formatRoberRoomName(map.room) || map.room || 'Unknown room'}</span>
              <span className='date'>{formatMapDate(map.datetime, map.timestamp)}</span>
            </div>
          </div>
          <button className='vacuum-map-modal-close modal-close-button' onClick={requestClose}>
            <Icon icon='mdi:close' />
          </button>
        </div>
        <div className='vacuum-map-modal-content'>
          <img src={map.url} alt={map.filename} />
        </div>
      </div>
    </>
  );
}

export function RoomCleaningToggle({ areaName, entities, callService }: RoomCleaningToggleProps) {
  const areaNameNormalized = areaName.toLowerCase().replace(/\s+/g, '_');

  // Maps index (small JSON, fetched once per room-detail open): the map button only
  // appears on rows whose room actually has an archived run to show.
  const [maps, setMaps] = useState<MapEntry[] | null>(null);
  const [openMap, setOpenMap] = useState<MapEntry | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchMapsIndex()
      .then(entries => {
        if (!cancelled) setMaps(entries);
      })
      .catch(() => {
        if (!cancelled) setMaps([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const mapFor = (slug: string) => (maps ? latestMapForRoom(maps, slug) : null);
  const openMapFor = (map: MapEntry | null) => (map ? () => setOpenMap(map) : undefined);

  const vacuum = entities?.[VACUUM_ENTITY];
  const vacuumState = vacuum?.state;
  // "Cleaning here" is only true while it is actually CLEANING and its live room IS this
  // row's room - a robot merely returning through the room leaves the request row usable.
  const isCleaning = vacuumState === 'cleaning';
  const liveRoomName = formatRoberRoomName(entities?.[VACUUM_CURRENT_ROOM_SENSOR]?.state);
  const cleaningIn = (roomName: string) => isCleaning && !!liveRoomName && liveRoomName.toLowerCase() === roomName.toLowerCase();

  const isKitchen = areaNameNormalized === 'kitchen';
  // Local midday anchor, so "today" flips at midnight rather than 24 h after the last clean.
  const todayMs = new Date().setHours(12, 0, 0, 0);
  const lastCleanOf = (id: string) => lastCleanLabel(entities?.[id]?.state, todayMs);

  const handleToggle = (entityId: string | null, currentlyOn: boolean) => {
    if (!entityId || !callService) return;
    callService({
      domain: 'input_boolean',
      service: currentlyOn ? 'turn_off' : 'turn_on',
      target: { entity_id: entityId },
    });
  };

  if (isKitchen) {
    const cookId = ROBOT_CLEAN_KITCHEN_1;
    const diningId = ROBOT_CLEAN_KITCHEN_2;
    const cookToggle = entities?.[cookId];
    const diningToggle = entities?.[diningId];
    const hasAny = !!cookToggle || !!diningToggle;

    if (!hasAny) return null;

    return (
      <div className='rober-request-card'>
        {cookToggle && (
          <RequestRow
            title='Clean cook side'
            requested={cookToggle.state === 'on'}
            cleaningHere={cleaningIn('Kitchen cook side')}
            lastClean={lastCleanOf('input_text.kitchen_last_clean')}
            onToggle={() => handleToggle(cookId, cookToggle.state === 'on')}
            onOpenMap={openMapFor(mapFor('kitchen'))}
          />
        )}
        {diningToggle && (
          <RequestRow
            title='Clean dining side'
            requested={diningToggle.state === 'on'}
            cleaningHere={cleaningIn('Kitchen dining side')}
            lastClean={lastCleanOf('input_text.kitchen_2_last_clean')}
            onToggle={() => handleToggle(diningId, diningToggle.state === 'on')}
            onOpenMap={openMapFor(mapFor('kitchen_2'))}
          />
        )}
        {openMap && <RoomMapModal map={openMap} onClose={() => setOpenMap(null)} />}
      </div>
    );
  }

  // Default single row for non-kitchen rooms
  const toggleId = `${ROBOT_CLEAN_PREFIX}${areaNameNormalized}`;
  const toggle = entities?.[toggleId];

  if (!toggle) return null;

  const isRequested = toggle.state === 'on';

  return (
    <div className='rober-request-card'>
      <RequestRow
        title='Clean this room'
        requested={isRequested}
        cleaningHere={cleaningIn(areaName)}
        lastClean={lastCleanOf(`input_text.${areaNameNormalized}_last_clean`)}
        onToggle={() => handleToggle(toggleId, isRequested)}
        onOpenMap={openMapFor(mapFor(areaNameNormalized))}
      />
      {openMap && <RoomMapModal map={openMap} onClose={() => setOpenMap(null)} />}
    </div>
  );
}
