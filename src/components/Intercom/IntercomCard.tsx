import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import './IntercomCard.css';

interface IntercomCardProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
  showHeader?: boolean; // Show header/title (for hallway room detail)
}

export function IntercomCard({ entities, callService, showHeader = false }: IntercomCardProps) {
  const autoOpenId = 'input_boolean.auto_open_intercom';
  const frontLockId = 'lock.intercomproxy_front_door';
  const backLockId = 'lock.intercomproxy_back_door';
  const aptLockId = 'lock.yale_bt';
  const aptDoorSensorId = 'binary_sensor.yale_door';

  const autoOpen = entities?.[autoOpenId];
  const autoOpenEnabled = autoOpen?.state === 'on';

  const frontLock = entities?.[frontLockId];
  const backLock = entities?.[backLockId];
  const aptLock = entities?.[aptLockId];
  const aptDoorSensor = entities?.[aptDoorSensorId];

  const aptLocked = aptLock?.state === 'locked';
  const aptDoorOpen = aptDoorSensor?.state === 'on';

  // Show only if we have any relevant entity
  if (!autoOpen && !frontLock && !backLock && !aptLock) return null;

  const toggleAutoOpen = () => {
    if (!callService || !autoOpen) return;
    callService({
      domain: 'input_boolean',
      service: autoOpenEnabled ? 'turn_off' : 'turn_on',
      target: { entity_id: autoOpenId },
    });
  };

  const pulseUnlock = (entityId: string, lockEntity?: { state: string; attributes?: Record<string, unknown> }) => {
    if (!callService) return;
    // Prefer the HA lock "open" service when supported (bit 1), otherwise fall back to "unlock"
    const supported = Number(lockEntity?.attributes?.supported_features ?? 0);
    const supportsOpen = (supported & 1) !== 0;
    const service = supportsOpen ? 'open' : 'unlock';
    callService({
      domain: 'lock',
      service,
      target: { entity_id: entityId },
    });
  };

  const handleAptLockToggle = () => {
    if (!callService || !aptLock) return;
    callService({
      domain: 'lock',
      service: aptLocked ? 'unlock' : 'lock',
      target: { entity_id: aptLockId },
    });
  };

  return (
    <div className={`intercom-card ${!showHeader ? 'no-inner-header' : ''}`}>
      {showHeader && (
        <div className='intercom-header'>
          <div className='intercom-header-left'>
            <Icon icon='mdi:door' />
            <div className='intercom-titles'>
              <span className='intercom-title'>Apartment access</span>
            </div>
          </div>
        </div>
      )}
      <div className='intercom-content'>
        {/* Intercom doors */}
        <div className='intercom-row'>
          {frontLock && (
            <button className='intercom-btn' onClick={() => pulseUnlock(frontLockId, frontLock)}>
              <Icon icon='mdi:door-open' />
              <span>Open Front</span>
            </button>
          )}
          {backLock && (
            <button className='intercom-btn' onClick={() => pulseUnlock(backLockId, backLock)}>
              <Icon icon='mdi:door-open' />
              <span>Open Back</span>
            </button>
          )}
        </div>

        {/* Apartment door lock/status */}
        {aptLock && (
          <div className='intercom-apt'>
            <div className='apt-status'>
              <div className='apt-line'>
                <Icon icon={aptLocked ? 'mdi:lock' : 'mdi:lock-open-variant'} />
                <span>Apartment lock</span>
                <span className={`apt-pill ${aptLocked ? 'locked' : 'unlocked'}`}>{aptLocked ? 'Locked' : 'Unlocked'}</span>
              </div>
              <div className='apt-line'>
                <Icon icon={aptDoorOpen ? 'mdi:door-open' : 'mdi:door-closed'} />
                <span>Apartment door</span>
                <span className={`apt-pill ${aptDoorOpen ? 'open' : 'closed'}`}>{aptDoorOpen ? 'Open' : 'Closed'}</span>
              </div>
            </div>
            <button className={`apt-lock-btn ${aptLocked ? 'locked' : 'unlocked'}`} onClick={handleAptLockToggle}>
              <Icon icon={aptLocked ? 'mdi:lock-open-variant' : 'mdi:lock'} />
              <span>{aptLocked ? 'Unlock' : 'Lock'}</span>
            </button>
          </div>
        )}

        {/* Auto-open toggle - shown at bottom */}
        {autoOpen && (
          <button className={`intercom-toggle ${autoOpenEnabled ? 'on' : ''}`} onClick={toggleAutoOpen}>
            <Icon icon={autoOpenEnabled ? 'mdi:lock-open-variant' : 'mdi:lock'} />
            <span>Auto open on ring</span>
            <div className={`toggle-indicator ${autoOpenEnabled ? 'on' : ''}`} />
          </button>
        )}
      </div>
    </div>
  );
}
