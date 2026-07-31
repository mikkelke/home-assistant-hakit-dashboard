import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import {
  VACUUM_ENTITY,
  VACUUM_CURRENT_ROOM_SENSOR,
  ROBOT_CLEAN_PREFIX,
  ROBOT_CLEAN_KITCHEN_1,
  ROBOT_CLEAN_KITCHEN_2,
} from '../../config/entities';
import { formatRoberRoomName } from './rooms';
import './VacuumCard.css';

// The request row every room that isn't the kitchen gets: one line, one control. The room's
// request IS a boolean, so it wears the same knob as the Rober2 card's own preference row;
// words only state ("Requested", "Cleaning here").

interface RoomCleaningToggleProps {
  areaName: string;
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

interface RequestRowProps {
  title: string;
  requested: boolean;
  cleaningHere: boolean;
  onToggle: () => void;
}

function RequestRow({ title, requested, cleaningHere, onToggle }: RequestRowProps) {
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
      ) : null}
      <span className={`rober-knob ${requested ? 'on' : ''}`} aria-hidden='true' />
    </div>
  );
}

export function RoomCleaningToggle({ areaName, entities, callService }: RoomCleaningToggleProps) {
  const areaNameNormalized = areaName.toLowerCase().replace(/\s+/g, '_');

  const vacuum = entities?.[VACUUM_ENTITY];
  const vacuumState = vacuum?.state;
  // "Cleaning here" is only true while it is actually CLEANING and its live room IS this
  // row's room - a robot merely returning through the room leaves the request row usable.
  const isCleaning = vacuumState === 'cleaning';
  const liveRoomName = formatRoberRoomName(entities?.[VACUUM_CURRENT_ROOM_SENSOR]?.state);
  const cleaningIn = (roomName: string) => isCleaning && !!liveRoomName && liveRoomName.toLowerCase() === roomName.toLowerCase();

  const isKitchen = areaNameNormalized === 'kitchen';

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
            onToggle={() => handleToggle(cookId, cookToggle.state === 'on')}
          />
        )}
        {diningToggle && (
          <RequestRow
            title='Clean dining side'
            requested={diningToggle.state === 'on'}
            cleaningHere={cleaningIn('Kitchen dining side')}
            onToggle={() => handleToggle(diningId, diningToggle.state === 'on')}
          />
        )}
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
        onToggle={() => handleToggle(toggleId, isRequested)}
      />
    </div>
  );
}
