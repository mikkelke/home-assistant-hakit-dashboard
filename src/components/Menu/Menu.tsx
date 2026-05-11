import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import { useModalBackButton } from '../../hooks';
import { deriveBatteryItems } from '../../utils/batteryAlerts';
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

function getBatteryIcon(value: number): string {
  if (value <= 10) return 'mdi:battery-alert-variant-outline';
  if (value <= 20) return 'mdi:battery-10';
  if (value <= 30) return 'mdi:battery-30';
  if (value <= 50) return 'mdi:battery-50';
  if (value <= 70) return 'mdi:battery-70';
  if (value <= 90) return 'mdi:battery-90';
  return 'mdi:battery';
}

function getBatteryColor(value: number): string {
  if (value <= 10) return '#ef4444';
  if (value <= 30) return '#f97316';
  if (value <= 50) return '#fbbf24';
  return '#22c55e';
}

export function Menu({ isOpen, onClose, entities, callService }: MenuProps) {
  const [isKioskActive, setIsKioskActive] = useState(false);
  const [isBatteryOverviewOpen, setIsBatteryOverviewOpen] = useState(false);
  const batteryItems = useMemo(() => deriveBatteryItems(entities), [entities]);
  const lowBatteryCount = batteryItems.filter(item => item.isLow).length;

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

  const batteryOverviewContent = isBatteryOverviewOpen ? (
    <div className='battery-overview-overlay' role='presentation' onClick={requestCloseBatteryOverview}>
      <div
        className='battery-overview-modal'
        role='dialog'
        aria-modal='true'
        aria-labelledby='battery-overview-title'
        onClick={event => event.stopPropagation()}
      >
        <div className='battery-overview-header'>
          <div className='battery-overview-title-wrap'>
            <div className='battery-overview-title-icon'>
              <Icon icon='mdi:battery-outline' />
            </div>
            <div>
              <h2 id='battery-overview-title'>Battery overview</h2>
              <p>{lowBatteryCount > 0 ? `${lowBatteryCount} devices need attention` : `${batteryItems.length} tracked devices`}</p>
            </div>
          </div>
          <button
            className='battery-overview-close modal-close-button'
            onClick={requestCloseBatteryOverview}
            aria-label='Close battery overview'
          >
            <Icon icon='mdi:close' />
          </button>
        </div>

        <div className='battery-overview-body'>
          <div className='battery-overview-summary'>
            {lowBatteryCount > 0 ? <span className='menu-section-badge is-alert'>{`${lowBatteryCount} low`}</span> : null}
            <span className='battery-overview-count'>{batteryItems.length} tracked devices</span>
          </div>

          <div className='menu-battery-list battery-overview-list'>
            {batteryItems.map(item => (
              <div key={item.entityId} className={`menu-battery-row ${item.isLow ? 'low' : ''}`}>
                <Icon icon={getBatteryIcon(item.value)} style={{ color: getBatteryColor(item.value) }} />
                <span className='menu-battery-name'>{item.name}</span>
                <div className='menu-battery-bar-wrap'>
                  <div className='menu-battery-bar-fill' style={{ width: `${item.value}%`, background: getBatteryColor(item.value) }} />
                </div>
                <span className='menu-battery-value' style={{ color: getBatteryColor(item.value) }}>
                  {item.value}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  ) : null;

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
          <button className='menu-item menu-item-battery' onClick={handleOpenBatteryOverview}>
            <Icon icon='mdi:battery-outline' />
            <span>Batteries</span>
            {lowBatteryCount > 0 ? <span className='menu-section-badge is-alert'>{`${lowBatteryCount} low`}</span> : null}
          </button>

          <div className='menu-divider' />

          <button className={`menu-item menu-item-toggle ${isKioskActive ? 'active' : ''}`} onClick={handleToggleKioskMode}>
            <Icon icon={isKioskActive ? 'mdi:monitor-dashboard' : 'mdi:monitor-off'} />
            <span>{isKioskActive ? 'Disable Kiosk Mode' : 'Enable Kiosk Mode'}</span>
          </button>
        </nav>
      </aside>
      {typeof document !== 'undefined' && batteryOverviewContent ? createPortal(batteryOverviewContent, document.body) : null}
    </>
  );
}
