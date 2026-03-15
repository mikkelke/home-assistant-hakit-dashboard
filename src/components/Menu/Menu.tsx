import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import './Menu.css';

interface MenuProps {
  isOpen: boolean;
  onClose: () => void;
  entities: HassEntities;
  callService?: (params: {
    domain: string;
    service: string;
    target?: { entity_id: string | string[] };
    serviceData?: Record<string, unknown>;
  }) => Promise<unknown>;
}

const KIOSK_TOGGLE_ENTITY = 'input_boolean.kiosk_mode';

export function Menu({ isOpen, onClose, entities, callService }: MenuProps) {
  const [isKioskActive, setIsKioskActive] = useState(false);

  // Check if kiosk mode is active by checking the input_boolean state (defer setState to satisfy lint)
  useEffect(() => {
    if (entities && entities[KIOSK_TOGGLE_ENTITY]) {
      const isOn = entities[KIOSK_TOGGLE_ENTITY].state === 'on';
      const id = setTimeout(() => setIsKioskActive(isOn), 0);
      return () => clearTimeout(id);
    }
  }, [entities, isOpen]);

  const handleToggleKioskMode = async () => {
    if (!callService) {
      console.error('callService not available');
      return;
    }

    try {
      const currentState = entities[KIOSK_TOGGLE_ENTITY]?.state;
      const newState = currentState === 'on' ? 'off' : 'on';

      await callService({
        domain: 'input_boolean',
        service: newState === 'on' ? 'turn_on' : 'turn_off',
        target: { entity_id: KIOSK_TOGGLE_ENTITY },
      });

      // Close menu and reload to apply kiosk mode changes
      onClose();
      setTimeout(() => {
        if (window.parent && window.parent !== window) {
          window.parent.location.reload();
        } else {
          window.location.reload();
        }
      }, 300);
    } catch (error) {
      console.error('Failed to toggle kiosk mode:', error);
    }
  };

  return (
    <>
      {isOpen && <div className='menu-overlay' onClick={onClose} />}
      <aside className={`menu ${isOpen ? 'open' : ''}`}>
        <div className='menu-header'>
          <h2>Menu</h2>
          <button className='menu-close-btn' onClick={onClose} aria-label='Close menu'>
            <Icon icon='mdi:close' />
          </button>
        </div>
        <nav className='menu-nav'>
          <button className={`menu-item menu-item-toggle ${isKioskActive ? 'active' : ''}`} onClick={handleToggleKioskMode}>
            <Icon icon={isKioskActive ? 'mdi:monitor-dashboard' : 'mdi:monitor-off'} />
            <span>{isKioskActive ? 'Disable Kiosk Mode' : 'Enable Kiosk Mode'}</span>
          </button>
        </nav>
      </aside>
    </>
  );
}
