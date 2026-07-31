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

// The request row every room that isn't the kitchen gets: one line, one action. Words state
// ("Requested", "Cleaning here"), the action is quiet - same grammar as the Rober2 card itself.

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
    <div className='rober-request-row'>
      <span className={`rober-request-glyph ${cleaningHere ? 'is-live' : ''}`}>
        <Icon icon='mdi:broom' aria-hidden='true' />
      </span>
      <span className='rober-request-title'>{title}</span>
      {cleaningHere ? (
        <span className='rober-request-state tint'>Cleaning here</span>
      ) : requested ? (
        <>
          <span className='rober-request-state muted'>Requested</span>
          <button type='button' className='rober-request-action' onClick={onToggle} title='Cancel cleaning request'>
            Cancel
          </button>
        </>
      ) : (
        <button type='button' className='rober-request-action' onClick={onToggle} title='Request cleaning'>
          Request clean
        </button>
      )}
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
            title='Cook side'
            requested={cookToggle.state === 'on'}
            cleaningHere={cleaningIn('Kitchen cook side')}
            onToggle={() => handleToggle(cookId, cookToggle.state === 'on')}
          />
        )}
        {diningToggle && (
          <RequestRow
            title='Dining side'
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
        title='Rober2'
        requested={isRequested}
        cleaningHere={cleaningIn(areaName)}
        onToggle={() => handleToggle(toggleId, isRequested)}
      />
    </div>
  );
}
