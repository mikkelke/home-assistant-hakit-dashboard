import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import type { CallServiceFunction, HassEntities } from '../../types';
import { ROBOT_PAUSED_BOOLEAN_ENTITY, ROBOT_PAUSE_REASON_ENTITY, VACUUM_ENTITY, ROBOT_MAPS_PATH } from '../../config/entities';
import { PersonStatus } from './PersonStatus';
import '../Vacuum/VacuumCard.css';
import './StatusBar.css';

interface StatusBarProps {
  entities: HassEntities;
  hassUrl: string | null;
  onMenuToggle: () => void;
  callService?: CallServiceFunction;
}

interface BatteryItem {
  entityId: string;
  name: string;
  value: number;
  isLow: boolean;
}

const ALERT_BATTERY_THRESHOLD = 12;
const MOBILE_BATTERY_EXCLUDE_KEYWORDS = ['iphone', 'ipad', 'oppopad', 'ofx9p', 'phone', 'tablet'];

const STUCK_MAP_ROOMS = ['stuck_in_the_office', 'stuck_trying_to_leave_the_office'];

const DISHWASHER_STATE_ID = 'sensor.dishwasher_state';
const WASHER_STATE_ID = 'sensor.washer_state';
const DRYER_STATE_ID = 'sensor.dryer_state';
const APPLIANCE_READY_STATES = ['complete', 'finished', 'done', 'ready', 'end', 'completed', 'end of cycle', 'unemptied'];

function isApplianceReadyToEmpty(state: string | undefined): boolean {
  if (!state || typeof state !== 'string') return false;
  const lower = state.toLowerCase().trim();
  if (['off', 'idle', 'emptied', 'standby', 'unknown', 'unavailable'].includes(lower)) return false;
  return APPLIANCE_READY_STATES.some(keyword => lower.includes(keyword));
}

function formatTimeAgo(ts: string | undefined): string {
  if (!ts) return '';
  try {
    const then = new Date(ts).getTime();
    const now = Date.now();
    const diffMs = now - then;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay === 1) return 'Yesterday';
    if (diffDay < 7) return `${diffDay}d ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

interface RobotMapEntry {
  filename: string;
  timestamp: string;
  datetime?: string;
  room?: string;
  url: string;
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

export function StatusBar({ entities, hassUrl, onMenuToggle, callService }: StatusBarProps) {
  const entityKeys = Object.keys(entities || {});
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [infoTab, setInfoTab] = useState<'cta' | 'batteries'>('cta');

  const personEntities = entityKeys.filter(key => key.startsWith('person.'));

  const robotPaused = entities?.[ROBOT_PAUSED_BOOLEAN_ENTITY]?.state === 'on';
  const robotPauseReason = (entities?.[ROBOT_PAUSE_REASON_ENTITY]?.state?.trim() as string) || 'Automation paused';
  const vacuumState = entities?.[VACUUM_ENTITY]?.state ?? '';
  const isRobotDocked = vacuumState === 'docked' || /blocked at dock/i.test(robotPauseReason);
  const robotResetLabel = isRobotDocked ? 'Resume' : 'Reset and send robot home';

  const haBase = useMemo(() => {
    const base =
      (typeof window !== 'undefined' && (import.meta.env.VITE_HA_URL as string)?.length > 0
        ? (import.meta.env.VITE_HA_URL as string)
        : (hassUrl ?? (typeof window !== 'undefined' ? window.location.origin : ''))
      )?.replace(/\/$/, '') ?? '';
    return base;
  }, [hassUrl]);
  const sameOrigin = useMemo(
    () => (typeof window !== 'undefined' && haBase ? new URL(haBase).origin === window.location.origin : false),
    [haBase]
  );
  const isDev = useMemo(
    () => typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'),
    []
  );

  const [stuckMapUrl, setStuckMapUrl] = useState<string | null>(null);
  const [stuckMapLoading, setStuckMapLoading] = useState(false);
  const [stuckMapViewerOpen, setStuckMapViewerOpen] = useState(false);

  useEffect(() => {
    if (!robotPaused) {
      setStuckMapUrl(null);
      return;
    }
    let cancelled = false;
    const toHaUrl = (path: string) => (path.startsWith('http') ? path : `${haBase}${path}`);
    const load = async () => {
      setStuckMapLoading(true);
      setStuckMapUrl(null);
      try {
        const indexUrl = sameOrigin || isDev ? `/local/${ROBOT_MAPS_PATH}/index.json` : toHaUrl(`/local/${ROBOT_MAPS_PATH}/index.json`);
        const res = await fetch(indexUrl, { cache: 'no-cache' });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const entries: RobotMapEntry[] = Array.isArray(data?.maps) ? data.maps : [];
        const stuck = entries.find((e: RobotMapEntry) => e.room && STUCK_MAP_ROOMS.includes(e.room));
        if (cancelled) return;
        if (stuck) {
          const fullUrl = sameOrigin || isDev ? stuck.url : toHaUrl(stuck.url);
          setStuckMapUrl(fullUrl);
        }
      } catch {
        if (!cancelled) setStuckMapUrl(null);
      } finally {
        if (!cancelled) setStuckMapLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [robotPaused, haBase, sameOrigin, isDev]);

  const batteryItems = useMemo<BatteryItem[]>(() => {
    const grouped = new Map<string, { entityId: string; name: string; value: number; isBt: boolean }>();

    for (const [entityId, entity] of Object.entries(entities || {})) {
      if (!entityId.startsWith('sensor.')) continue;
      if (entity.attributes?.device_class !== 'battery') continue;
      if (entity.attributes?.unit_of_measurement !== '%') continue;

      const value = Number(entity.state);
      if (!Number.isFinite(value) || value < 0) continue;

      const isBt = /_bt$/i.test(entityId);
      const groupKey = entityId.replace(/_bt$/i, '');
      const existing = grouped.get(groupKey);

      if (!existing || (isBt && !existing.isBt)) {
        const rawName = String(entity.attributes?.friendly_name ?? entityId);
        const searchText = `${entityId} ${rawName}`.toLowerCase();
        if (MOBILE_BATTERY_EXCLUDE_KEYWORDS.some(keyword => searchText.includes(keyword))) continue;

        const name = rawName.replace(/\s+battery(\s+bt)?$/i, '').trim();
        grouped.set(groupKey, { entityId, name, value, isBt });
      }
    }

    return [...grouped.values()]
      .map(item => ({ ...item, isLow: item.value <= ALERT_BATTERY_THRESHOLD }))
      .sort((a, b) => {
        if (a.isLow !== b.isLow) return a.isLow ? -1 : 1;
        return a.value - b.value;
      });
  }, [entities]);

  const lowBatteryCount = batteryItems.filter(b => b.isLow).length;
  const redCount = lowBatteryCount + (robotPaused ? 1 : 0);
  const hasRed = redCount > 0;

  const applianceReady = useMemo(() => {
    const dishwasher = isApplianceReadyToEmpty(entities?.[DISHWASHER_STATE_ID]?.state);
    const washer = isApplianceReadyToEmpty(entities?.[WASHER_STATE_ID]?.state);
    const dryer = isApplianceReadyToEmpty(entities?.[DRYER_STATE_ID]?.state);
    return { dishwasher, washer, dryer };
  }, [entities]);
  const applianceReadyList = useMemo(() => {
    const list: { id: string; label: string; icon: string; entityId: string }[] = [];
    if (applianceReady.dishwasher)
      list.push({ id: 'dishwasher', label: 'Dishwasher is ready to be emptied', icon: 'mdi:dishwasher', entityId: DISHWASHER_STATE_ID });
    if (applianceReady.dryer)
      list.push({ id: 'dryer', label: 'Dryer is ready to be emptied', icon: 'mdi:tumble-dryer', entityId: DRYER_STATE_ID });
    if (applianceReady.washer)
      list.push({ id: 'washer', label: 'Washer is ready to be emptied', icon: 'mdi:washing-machine', entityId: WASHER_STATE_ID });
    return list;
  }, [applianceReady]);

  const orangeCount = applianceReadyList.length;
  const hasOrange = orangeCount > 0;
  const hasAlert = hasRed || hasOrange;
  const issueCount = hasRed ? redCount : orangeCount;

  function handleRobotReset() {
    callService?.({ domain: 'input_boolean', service: 'turn_off', target: { entity_id: ROBOT_PAUSED_BOOLEAN_ENTITY } });
    if (!isRobotDocked) {
      callService?.({ domain: 'vacuum', service: 'return_to_base', target: { entity_id: VACUUM_ENTITY } });
    }
  }

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
              className={`info-alert-btn ${hasRed ? 'active' : ''} ${hasOrange && !hasRed ? 'active-orange' : ''}`}
              onClick={() => {
                setInfoTab('cta');
                setIsInfoOpen(true);
              }}
              title={
                hasAlert
                  ? `${issueCount} thing${issueCount !== 1 ? 's' : ''} need${issueCount === 1 ? 's' : ''} attention`
                  : 'Open apartment info'
              }
              aria-label='Open apartment info'
            >
              <Icon icon={hasAlert ? 'mdi:alert-circle-outline' : 'mdi:information-outline'} />
              {hasAlert && <span className={`info-alert-badge ${hasRed ? 'badge-red' : 'badge-orange'}`}>{issueCount}</span>}
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
              <span className='qa-title'>Apartment info</span>
              <div className='qa-header-actions'>
                <button className='qa-close' onClick={() => setIsInfoOpen(false)} aria-label='Close'>
                  <Icon icon='mdi:close' />
                </button>
              </div>
            </div>
            <div className='qa-modal-body'>
              <div className='info-modal-tabs'>
                <button
                  type='button'
                  className={`info-modal-tab ${infoTab === 'cta' ? 'active' : ''} ${hasRed ? 'tab-has-red' : ''} ${hasOrange && !hasRed ? 'tab-has-orange' : ''}`}
                  onClick={() => setInfoTab('cta')}
                >
                  <Icon icon='mdi:bell-alert-outline' />
                  Call to action
                  {issueCount > 0 && <span className={`info-tab-badge ${hasRed ? 'badge-red' : 'badge-orange'}`}>{issueCount}</span>}
                </button>
                <button
                  type='button'
                  className={`info-modal-tab ${infoTab === 'batteries' ? 'active' : ''}`}
                  onClick={() => setInfoTab('batteries')}
                >
                  <Icon icon='mdi:battery' />
                  Batteries
                </button>
              </div>

              {infoTab === 'cta' && (
                <div className='info-call-to-action'>
                  {robotPaused ? (
                    <div className='info-issue-card'>
                      <div className='info-issue-head'>
                        <span className='info-issue-title'>Robot paused</span>
                        <span className='info-issue-subtitle'>{robotPauseReason}</span>
                        {(entities?.[ROBOT_PAUSED_BOOLEAN_ENTITY]?.last_changed ||
                          entities?.[ROBOT_PAUSED_BOOLEAN_ENTITY]?.last_updated) && (
                          <span className='info-issue-time'>
                            {formatTimeAgo(
                              entities?.[ROBOT_PAUSED_BOOLEAN_ENTITY]?.last_changed ?? entities?.[ROBOT_PAUSED_BOOLEAN_ENTITY]?.last_updated
                            )}
                          </span>
                        )}
                      </div>
                      <div className='info-issue-actions'>
                        {stuckMapLoading && (
                          <span className='info-issue-map-btn' aria-disabled='true'>
                            <Icon icon='mdi:map-outline' />
                            Map…
                          </span>
                        )}
                        {!stuckMapLoading && stuckMapUrl && (
                          <button
                            type='button'
                            className='info-issue-map-btn'
                            onClick={() => setStuckMapViewerOpen(true)}
                            title='View map snapshot'
                          >
                            <Icon icon='mdi:map-outline' />
                            Map
                          </button>
                        )}
                        <button type='button' className='info-issue-reset-btn' onClick={handleRobotReset} disabled={!callService}>
                          <Icon icon='mdi:robot-vacuum' />
                          {robotResetLabel}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {lowBatteryCount > 0 ? (
                    <div className='info-cta-batteries'>
                      <p className='info-cta-batteries-summary'>
                        {lowBatteryCount} battery{lowBatteryCount !== 1 ? 'ies' : ''} need{lowBatteryCount === 1 ? 's' : ''} changing
                      </p>
                      <div className='info-cta-battery-list'>
                        {batteryItems
                          .filter(b => b.isLow)
                          .map(item => (
                            <div key={item.entityId} className='info-cta-battery-row'>
                              <Icon icon={getBatteryIcon(item.value)} style={{ color: getBatteryColor(item.value) }} />
                              <span className='info-cta-battery-name'>{item.name}</span>
                              <span className='info-cta-battery-meta'>
                                <span className='info-cta-battery-value' style={{ color: getBatteryColor(item.value) }}>
                                  {item.value}%
                                </span>
                                {(entities?.[item.entityId]?.last_updated || entities?.[item.entityId]?.last_changed) && (
                                  <span className='info-cta-battery-time'>
                                    {formatTimeAgo(entities?.[item.entityId]?.last_updated ?? entities?.[item.entityId]?.last_changed)}
                                  </span>
                                )}
                              </span>
                            </div>
                          ))}
                      </div>
                    </div>
                  ) : null}
                  {applianceReadyList.length > 0 ? (
                    <div className='info-cta-appliances'>
                      {applianceReadyList.map(item => (
                        <div key={item.id} className='info-cta-appliance-item'>
                          <Icon icon={item.icon} className='info-cta-appliance-icon' />
                          <span className='info-cta-appliance-label'>{item.label}</span>
                          {(entities?.[item.entityId]?.last_changed || entities?.[item.entityId]?.last_updated) && (
                            <span className='info-cta-appliance-time'>
                              {formatTimeAgo(entities?.[item.entityId]?.last_changed ?? entities?.[item.entityId]?.last_updated)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {!robotPaused && lowBatteryCount === 0 && applianceReadyList.length === 0 ? (
                    <p className='info-cta-empty'>Nothing needs attention</p>
                  ) : null}
                </div>
              )}

              {infoTab === 'batteries' && (
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
              )}
            </div>
          </div>
        </div>
      )}
      {/* Stuck map image viewer (same pattern as VacuumCard map modal) */}
      {stuckMapViewerOpen && stuckMapUrl && (
        <>
          <div className='vacuum-map-overlay' onClick={() => setStuckMapViewerOpen(false)} />
          <div className='vacuum-map-modal'>
            <div className='vacuum-map-modal-header'>
              <div className='vacuum-map-modal-title'>
                <Icon icon='mdi:map' />
                <div>
                  <span className='room'>Stuck map</span>
                  <span className='date'>{robotPauseReason}</span>
                </div>
              </div>
              <button
                type='button'
                className='vacuum-map-modal-close modal-close-button'
                onClick={() => setStuckMapViewerOpen(false)}
                aria-label='Close'
              >
                <Icon icon='mdi:close' />
              </button>
            </div>
            <div className='vacuum-map-modal-content'>
              <img src={stuckMapUrl} alt='Map when robot got stuck' />
            </div>
          </div>
        </>
      )}
    </>
  );
}
