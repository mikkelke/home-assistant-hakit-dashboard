import { useMemo } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import { deriveBatteryItems } from '../../utils/batteryAlerts';

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

/** Every battery level the dashboard can read, lowest first. */
export function BatteryOverview({ entities, onRequestClose }: { entities: HassEntities; onRequestClose: () => void }) {
  const batteryItems = useMemo(() => deriveBatteryItems(entities), [entities]);
  return (
    <div className='battery-overview-overlay' role='presentation' onClick={onRequestClose}>
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
              <p>{`${batteryItems.length} tracked devices`}</p>
            </div>
          </div>
          <button className='battery-overview-close modal-close-button' onClick={onRequestClose} aria-label='Close battery overview'>
            <Icon icon='mdi:close' />
          </button>
        </div>

        <div className='battery-overview-body'>
          <div className='battery-overview-summary'>
            <span className='battery-overview-count'>{batteryItems.length} tracked devices</span>
          </div>

          <div className='menu-battery-list battery-overview-list'>
            {batteryItems.map(item => (
              <div key={item.entityId} className='menu-battery-row'>
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
  );
}
