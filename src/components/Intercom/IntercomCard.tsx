import { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { APARTMENT_DOOR_OPEN_ENTITY, APARTMENT_ENTRY_SECURE_ENTITY, resolveHallwayDoorSensorId } from '../../config/entities';
import { useLocalStorageBoolean, useTouchScrollSlopGuard } from '../../hooks';
import './IntercomCard.css';

// "Access" card - the apartment lock, the two building doors, and the auto-open ritual, in the
// Climate-card grammar (see AC/TonightCard). Two homes, one component: the Hallway room detail
// gets the collapsible card (showHeader), the QuickAccess "Apartment access" modal renders the
// same body headerless. House rule: actions are icons, words are states.

interface IntercomCardProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
  showHeader?: boolean; // Show the collapse header (hallway room detail); the modal renders headerless
}

/** How long the apartment may sit unlocked before the card says so out loud. */
const UNLOCKED_ALERT_MINUTES = 10;

export function IntercomCard({ entities, callService, showHeader = false }: IntercomCardProps) {
  // Now-tick: the unlocked-too-long alert is the only thing here that changes with time
  // (same pattern as TonightCard - lazy initializer for the first render, interval after).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const [collapsed, setCollapsed] = useLocalStorageBoolean('accesscard-collapsed', true);
  const topSlop = useTouchScrollSlopGuard();

  const autoOpenId = 'input_boolean.auto_open_intercom';
  const frontLockId = 'lock.intercomproxy_front_door';
  const backLockId = 'lock.intercomproxy_back_door';
  const aptLockId = 'lock.yale_bt';
  const aptDoorSensorId = resolveHallwayDoorSensorId(entities) ?? APARTMENT_DOOR_OPEN_ENTITY;

  const autoOpen = entities?.[autoOpenId];
  const autoOpenEnabled = autoOpen?.state === 'on';

  const frontLock = entities?.[frontLockId];
  const backLock = entities?.[backLockId];
  const aptLock = entities?.[aptLockId];
  const aptDoorSensor = entities?.[aptDoorSensorId];

  // Entry truth middle layer: BLE-authoritative state + cloud-divergence knowledge.
  // Falls back to the raw BLE lock when the semantic entity is unavailable.
  const entrySecure = entities?.[APARTMENT_ENTRY_SECURE_ENTITY];
  const entryAttrs = (entrySecure?.attributes ?? {}) as Record<string, unknown>;
  const lockStateSource = typeof entryAttrs.lock_state === 'string' ? entryAttrs.lock_state : aptLock?.state;
  const aptLocked = lockStateSource === 'locked';
  const cloudStale = !!entrySecure && entryAttrs.cloud_agrees === false;
  const aptDoorOpen = aptDoorSensor?.state === 'on';

  // Show only if we have any relevant entity
  if (!autoOpen && !frontLock && !backLock && !aptLock) return null;

  // Unlocked for longer than the grace window -> the one red row this card is allowed.
  // Measured from the BLE lock's own last_changed (the entity the unlock button drives).
  const unlockedSinceMs = !aptLocked && aptLock?.last_changed ? Date.parse(aptLock.last_changed) : NaN;
  const unlockedMinutes = Number.isFinite(unlockedSinceMs) ? Math.floor((now - unlockedSinceMs) / 60_000) : 0;
  const unlockedTooLong = Number.isFinite(unlockedSinceMs) && unlockedMinutes >= UNLOCKED_ALERT_MINUTES;

  const stateWord = `${aptLocked ? 'Locked' : 'Unlocked'} · ${aptDoorOpen ? 'Open' : 'Closed'}`;

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

  // The alert row is loud on purpose: it sits under the header whether or not the card is
  // expanded (a collapsed card must not be able to hide an unlocked door).
  const alertRow = unlockedTooLong ? (
    <div className='access-alert'>
      <Icon icon='mdi:alert' aria-hidden='true' />
      <span>Apartment door has been unlocked for {unlockedMinutes} min.</span>
    </div>
  ) : null;

  const body = (
    <>
      <div className='access-rows'>
        {aptLock && (
          <div className='access-row'>
            <span className='access-row-name'>Apartment</span>
            <span className={`access-pill ${aptLocked ? '' : 'bad'}`}>{aptLocked ? 'Locked' : 'Unlocked'}</span>
            <span className={`access-pill ${aptDoorOpen ? 'warn' : ''}`}>{aptDoorOpen ? 'Open' : 'Closed'}</span>
            {cloudStale && (
              <span
                className='access-pill warn'
                title={String(entryAttrs.reason ?? 'Yale cloud out of sync — the lock itself is authoritative')}
              >
                Yale app stale
              </span>
            )}
            <button
              type='button'
              className='access-ibtn access-ibtn--sm'
              onClick={handleAptLockToggle}
              aria-label={aptLocked ? 'Unlock the apartment' : 'Lock the apartment'}
              title={aptLocked ? 'Unlock' : 'Lock'}
            >
              <Icon icon={aptLocked ? 'mdi:lock-open-outline' : 'mdi:lock-outline'} aria-hidden='true' />
            </button>
          </div>
        )}

        {(frontLock || backLock) && (
          <div className='access-row'>
            <span className='access-row-name'>Building</span>
            <div className='access-doors'>
              {frontLock && (
                <div className='access-door'>
                  <button
                    type='button'
                    className='access-ibtn access-ibtn--sm'
                    onClick={() => pulseUnlock(frontLockId, frontLock)}
                    aria-label='Open the front building door'
                  >
                    <Icon icon='mdi:door-open' aria-hidden='true' />
                  </button>
                  <span className='access-door-label'>front</span>
                </div>
              )}
              {backLock && (
                <div className='access-door'>
                  <button
                    type='button'
                    className='access-ibtn access-ibtn--sm'
                    onClick={() => pulseUnlock(backLockId, backLock)}
                    aria-label='Open the back building door'
                  >
                    <Icon icon='mdi:door-open' aria-hidden='true' />
                  </button>
                  <span className='access-door-label'>back</span>
                </div>
              )}
            </div>
          </div>
        )}

        {autoOpen && (
          <div
            className='access-row access-row--wide'
            onClick={toggleAutoOpen}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleAutoOpen();
              }
            }}
            role='switch'
            tabIndex={0}
            aria-checked={autoOpenEnabled}
          >
            <span className='access-row-name'>Open on next ring</span>
            <span className={`access-knob ${autoOpenEnabled ? 'on' : ''}`} aria-hidden='true' />
          </div>
        )}
      </div>
    </>
  );

  if (!showHeader) {
    return (
      <div className='access-card is-embedded'>
        {alertRow}
        {body}
      </div>
    );
  }

  return (
    <div className={`access-card ${unlockedTooLong ? 'is-alert' : ''}`}>
      <div
        className='access-top'
        onClick={() => {
          if (topSlop.consumeBlockClick()) return;
          setCollapsed(v => !v);
        }}
        onTouchStart={topSlop.onTouchStart}
        onTouchMove={topSlop.onTouchMove}
        onTouchEnd={topSlop.onTouchEnd}
        onTouchCancel={topSlop.onTouchCancel}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed(v => !v);
          }
        }}
        role='button'
        tabIndex={0}
        aria-expanded={!collapsed}
      >
        <span className={`access-glyph ${unlockedTooLong ? 'alert' : ''}`}>
          <Icon icon='mdi:key-variant' aria-hidden='true' />
        </span>
        <span className='access-title'>Access</span>
        <span className='access-top-right'>
          <span className={`access-state ${unlockedTooLong ? 'alert' : aptLocked ? 'muted' : 'unlocked'}`}>{stateWord}</span>
          <Icon icon={collapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'} aria-hidden='true' className='access-chevron' />
        </span>
      </div>

      {alertRow}
      {!collapsed && body}
    </div>
  );
}
