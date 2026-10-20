import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import { useModalBackButton, useViewer } from '../../hooks';
import { SmokeAlarmSheet } from '../FireSafety';
import { FIRE_SAFETY_SENSOR } from '../../config/entities';
import './Menu.css';

// Rendered only after a tap, so it stays out of the main bundle.
const BatteryOverview = lazy(() => import('./BatteryOverview').then(module => ({ default: module.BatteryOverview })));

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
  onOpenEnergy?: () => void;
  onOpenMap?: () => void;
  onOpenHeating?: () => void;
  onOpenLists?: () => void;
}

const KIOSK_TOGGLE_ENTITY = 'input_boolean.kiosk_mode';
const BUILD_VERSION = __APP_BUILD_VERSION__;

export function Menu({ isOpen, onClose, entities, callService, onOpenEnergy, onOpenMap, onOpenHeating, onOpenLists }: MenuProps) {
  const [isKioskActive, setIsKioskActive] = useState(false);
  const [isBatteryOverviewOpen, setIsBatteryOverviewOpen] = useState(false);
  const [isSmokeAlarmOpen, setIsSmokeAlarmOpen] = useState(false);
  const viewer = useViewer();
  const isAdmin = viewer.isAdmin === true;
  const showSmokeAlarm = isAdmin && !!entities?.[FIRE_SAFETY_SENSOR];

  const handleCloseBatteryOverview = useCallback(() => {
    setIsBatteryOverviewOpen(false);
  }, []);

  const { requestClose: requestCloseBatteryOverview } = useModalBackButton({
    isOpen: isBatteryOverviewOpen,
    onRequestClose: handleCloseBatteryOverview,
    historyKey: 'battery-overview',
  });

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

  const handleOpenBatteryOverview = () => {
    onClose();
    setIsBatteryOverviewOpen(true);
  };

  const handleOpenEnergy = () => {
    onClose();
    onOpenEnergy?.();
  };

  const handleOpenMap = () => {
    onClose();
    onOpenMap?.();
  };

  const handleOpenHeating = () => {
    onClose();
    onOpenHeating?.();
  };

  const handleOpenLists = () => {
    onClose();
    onOpenLists?.();
  };

  const handleOpenSmokeAlarm = () => {
    onClose();
    setIsSmokeAlarmOpen(true);
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
          <button className='menu-item menu-item-energy' onClick={handleOpenEnergy}>
            <Icon icon='mdi:lightning-bolt' />
            <span>Energy</span>
          </button>
          <button className='menu-item' onClick={handleOpenLists}>
            <Icon icon='mdi:format-list-checks' />
            <span>Lists</span>
          </button>

          {isAdmin && (
            <>
              <div className='menu-divider' />
              <button className='menu-item menu-item-battery' onClick={handleOpenBatteryOverview}>
                <Icon icon='mdi:battery-outline' />
                <span>Batteries</span>
              </button>
              <button className='menu-item' onClick={handleOpenMap}>
                <Icon icon='mdi:map-marker-radius-outline' />
                <span>Map</span>
              </button>
              <button className='menu-item' onClick={handleOpenHeating}>
                <Icon icon='mdi:radiator' />
                <span>Heating</span>
              </button>
            </>
          )}

          {showSmokeAlarm && (
            <button className='menu-item' onClick={handleOpenSmokeAlarm}>
              <Icon icon='mdi:smoke-detector-variant' />
              <span>Smoke alarm</span>
            </button>
          )}

          <div className='menu-divider' />

          <button className={`menu-item menu-item-toggle ${isKioskActive ? 'active' : ''}`} onClick={handleToggleKioskMode}>
            <Icon icon={isKioskActive ? 'mdi:monitor-dashboard' : 'mdi:monitor-off'} />
            <span>{isKioskActive ? 'Disable Kiosk Mode' : 'Enable Kiosk Mode'}</span>
          </button>
        </nav>
        <div className='menu-footer'>
          <span className='menu-version' title={`Build ${BUILD_VERSION}`}>
            {BUILD_VERSION}
          </span>
        </div>
      </aside>
      {isBatteryOverviewOpen && typeof document !== 'undefined'
        ? createPortal(
            <Suspense fallback={null}>
              <BatteryOverview entities={entities} onRequestClose={requestCloseBatteryOverview} />
            </Suspense>,
            document.body
          )
        : null}
      {isSmokeAlarmOpen && showSmokeAlarm && (
        <SmokeAlarmSheet entities={entities} callService={callService} onClose={() => setIsSmokeAlarmOpen(false)} />
      )}
    </>
  );
}
