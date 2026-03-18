import { useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities } from '../../types';
import { deriveBatteryItems, type BatteryAlertItem } from '../../utils/batteryAlerts';
import { PersonStatus } from './PersonStatus';
import './StatusBar.css';

interface StatusBarProps {
  entities: HassEntities;
  hassUrl: string | null;
  onMenuToggle: () => void;
}

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

export function StatusBar({ entities, hassUrl, onMenuToggle }: StatusBarProps) {
  const entityKeys = Object.keys(entities || {});
  const [isInfoOpen, setIsInfoOpen] = useState(false);

  const personEntities = entityKeys.filter(key => key.startsWith('person.'));

  const batteryItems = useMemo<BatteryAlertItem[]>(() => deriveBatteryItems(entities), [entities]);

  const lowBatteryCount = batteryItems.filter(b => b.isLow).length;
  const hasBatteryAlert = lowBatteryCount > 0;

  return (
    <>
      <header className='status-bar'>
        <div className='status-bar-content'>
          <div className='people-section'>
            {personEntities.map(person => (
              <PersonStatus key={person} entity={person} entities={entities} hassUrl={hassUrl} />
            ))}
          </div>
          <div className='status-section'>
            <button
              className={`info-alert-btn ${hasBatteryAlert ? 'active-orange' : ''}`}
              onClick={() => setIsInfoOpen(true)}
              title={
                hasBatteryAlert
                  ? `${lowBatteryCount} batter${lowBatteryCount === 1 ? 'y needs' : 'ies need'} changing`
                  : 'Open battery info'
              }
              aria-label='Open battery info'
            >
              <Icon icon={hasBatteryAlert ? 'mdi:battery-alert-variant-outline' : 'mdi:battery-outline'} />
              {hasBatteryAlert && <span className='info-alert-badge badge-orange'>{lowBatteryCount}</span>}
            </button>
            <button className='sidebar-toggle-btn' onClick={onMenuToggle} title='Toggle menu'>
              <Icon icon='mdi:menu' />
            </button>
          </div>
        </div>
      </header>

      {isInfoOpen && (
        <div className='qa-overlay' onClick={() => setIsInfoOpen(false)}>
          <div className='qa-modal info-modal' onClick={e => e.stopPropagation()}>
            <div className='qa-modal-header'>
              <span className='qa-title'>Batteries</span>
              <div className='qa-header-actions'>
                <button className='qa-close' onClick={() => setIsInfoOpen(false)} aria-label='Close'>
                  <Icon icon='mdi:close' />
                </button>
              </div>
            </div>
            <div className='qa-modal-body'>
              {hasBatteryAlert && (
                <p className='info-battery-summary'>
                  {lowBatteryCount} batter{lowBatteryCount === 1 ? 'y needs' : 'ies need'} changing
                </p>
              )}

              <div className='info-battery-list'>
                {batteryItems.map(item => (
                  <div key={item.entityId} className={`info-battery-row ${item.isLow ? 'low' : ''}`}>
                    <Icon icon={getBatteryIcon(item.value)} style={{ color: getBatteryColor(item.value) }} />
                    <span className='info-battery-name'>{item.name}</span>
                    <div className='info-battery-bar-wrap'>
                      <div
                        className='info-battery-bar-fill'
                        style={{ width: `${item.value}%`, background: getBatteryColor(item.value) }}
                      />
                    </div>
                    <span className='info-battery-value' style={{ color: getBatteryColor(item.value) }}>
                      {item.value}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
