import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import './VacuumCard.css';

interface RoomCleaningToggleProps {
  areaName: string;
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
}

export function RoomCleaningToggle({ areaName, entities, callService }: RoomCleaningToggleProps) {
  const areaNameNormalized = areaName.toLowerCase().replace(/\s+/g, '_');

  // Also check vacuum status
  const vacuum = entities?.['vacuum.rober2'];
  const vacuumState = vacuum?.state;
  const isVacuumActive = vacuumState === 'cleaning' || vacuumState === 'returning';

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
    const cookId = 'input_boolean.rober2_clean_kitchen';
    const diningId = 'input_boolean.rober2_clean_kitchen_2';
    const cookToggle = entities?.[cookId];
    const diningToggle = entities?.[diningId];
    const hasAny = !!cookToggle || !!diningToggle;

    if (!hasAny) return null;

    const renderToggle = (label: string, entityId: string | null, toggle: { state: string } | null | undefined, icon: string) => {
      if (!entityId || !toggle) return null;
      const isRequested = toggle.state === 'on';
      return (
        <button
          key={entityId}
          className={`room-cleaning-toggle small ${isRequested ? 'requested' : ''} ${isVacuumActive ? 'vacuum-active' : ''}`}
          onClick={() => handleToggle(entityId, isRequested)}
          title={isRequested ? 'Cancel cleaning request' : 'Request cleaning'}
        >
          <Icon icon={icon} className={isVacuumActive ? 'cleaning' : ''} />
          <span className='toggle-text'>
            {label}
            <span className='toggle-subtext'>{isRequested ? 'Requested' : 'Tap to request'}</span>
          </span>
          <div className={`toggle-indicator ${isRequested ? 'on' : 'off'}`} />
        </button>
      );
    };

    return (
      <div className='room-cleaning-toggle-group'>
        <div className='toggle-group-header'>
          <Icon icon='mdi:robot-vacuum' />
          <div className='toggle-header-text'>
            <span>Kitchen cleaning</span>
          </div>
        </div>
        <div className='toggle-group-grid'>
          {renderToggle('Cook side', cookId, cookToggle, 'mdi:countertop-outline')}
          {renderToggle('Dining side', diningId, diningToggle, 'mdi:table-chair')}
        </div>
      </div>
    );
  }

  // Default single toggle for non-kitchen rooms
  const toggleId = `input_boolean.rober2_clean_${areaNameNormalized}`;
  const toggle = entities?.[toggleId];

  if (!toggle) return null;

  const isRequested = toggle.state === 'on';

  return (
    <button
      className={`room-cleaning-toggle ${isRequested ? 'requested' : ''} ${isVacuumActive ? 'vacuum-active' : ''}`}
      onClick={() => handleToggle(toggleId, isRequested)}
      title={isRequested ? 'Cancel cleaning request' : 'Request room cleaning'}
    >
      <Icon icon='mdi:robot-vacuum' className={isVacuumActive ? 'cleaning' : ''} />
      <span className='toggle-text'>{isRequested ? 'Cleaning requested' : 'Request cleaning'}</span>
      <div className={`toggle-indicator ${isRequested ? 'on' : 'off'}`} />
    </button>
  );
}
