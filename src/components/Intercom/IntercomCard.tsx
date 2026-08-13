import { useEffect, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { APARTMENT_DOOR_OPEN_ENTITY, APARTMENT_ENTRY_SECURE_ENTITY, resolveHallwayDoorSensorId } from '../../config/entities';
import { useLocalStorageBoolean, useTouchScrollSlopGuard } from '../../hooks';
import { fetchDoorbellIndex, formatRingTime, type DoorbellImage } from './doorbellArchive';
import { DoorbellGallery } from './DoorbellGallery';
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
/** How long a fired door shows its green check instead of its own icon. */
const FIRED_FLASH_MS = 2000;

const DOORBELL_FRONT = 'binary_sensor.intercomproxy_doorbell_front_door';
const DOORBELL_BACK = 'binary_sensor.intercomproxy_doorbell_back_door';

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
  // Which door just fired - shows a green check for FIRED_FLASH_MS so a tap answers itself
  // without a toast (user 2026-07-31: the doors must work from the collapsed row).
  const [fired, setFired] = useState<string | null>(null);
  const firedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (firedTimer.current) clearTimeout(firedTimer.current);
    },
    []
  );
  const flashFired = (id: string) => {
    setFired(id);
    if (firedTimer.current) clearTimeout(firedTimer.current);
    firedTimer.current = setTimeout(() => setFired(null), FIRED_FLASH_MS);
  };

  // "Who rang" archive: the AbbWelcomeBridge keeps one snapshot per ring episode under
  // /local/abb_doorbell/ (fetched once per mount, like the Rober2 maps index). The archive
  // only exists after the first ring - a 404 or any fetch failure just means the Doorbell
  // row stays hidden, so both resolve to [] without a word in the console.
  const [rings, setRings] = useState<DoorbellImage[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchDoorbellIndex()
      .then(images => {
        if (!cancelled) setRings(images);
      })
      .catch(() => {
        if (!cancelled) setRings([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
  // Calm is the default, so it doesn't need saying: the closed padlock in the quick row IS
  // "locked". The word only appears when something is off-normal, freeing the header space
  // the doors now use.
  const showStateWord = !aptLocked || aptDoorOpen;

  // A ring is the one moment this card gets loud on its own: the proxy exposes a doorbell
  // sensor per door, so the row can name the door that actually rang.
  const ringingFront = entities?.[DOORBELL_FRONT]?.state === 'on';
  const ringingBack = entities?.[DOORBELL_BACK]?.state === 'on';
  const ringing = ringingFront
    ? { id: frontLockId, lock: frontLock, name: 'front' }
    : ringingBack
      ? { id: backLockId, lock: backLock, name: 'back' }
      : null;

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

  const ringRow = ringing?.lock ? (
    <div className='access-ring'>
      <Icon icon='mdi:bell-ring' aria-hidden='true' />
      <span>Someone at the {ringing.name} door</span>
      <button
        type='button'
        className='access-ring-btn'
        onClick={e => {
          e.stopPropagation();
          pulseUnlock(ringing.id, ringing.lock);
          flashFired(ringing.id);
        }}
      >
        Let them in
      </button>
    </div>
  ) : null;

  // Quick doors: the whole point of the collapsed row. All three are a single tap - tap/hold
  // must not be mixed (user 2026-07-31) - and the row stops its own clicks from collapsing
  // the card. The lock's icon carries the lock state; the building doors carry F/B tags.
  const quickDoor = (id: string, lock: typeof frontLock, letter: string, label: string) => (
    <button
      type='button'
      className={`access-quick-btn ${fired === id ? 'is-done' : ''}`}
      onClick={() => {
        pulseUnlock(id, lock);
        flashFired(id);
      }}
      aria-label={label}
      title={label}
    >
      <Icon icon={fired === id ? 'mdi:check' : 'mdi:door-open'} aria-hidden='true' />
      {fired !== id && <span className='access-quick-tag'>{letter}</span>}
    </button>
  );

  const quickDoors = (
    <span className='access-quick' onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} role='presentation'>
      {frontLock && quickDoor(frontLockId, frontLock, 'F', 'Open the front building door')}
      {backLock && quickDoor(backLockId, backLock, 'B', 'Open the back building door')}
      {aptLock && (frontLock || backLock) && <span className='access-quick-div' aria-hidden='true' />}
      {aptLock && (
        <button
          type='button'
          className={`access-quick-btn is-lock ${aptLocked ? '' : 'is-unlocked'} ${fired === aptLockId ? 'is-done' : ''}`}
          onClick={() => {
            handleAptLockToggle();
            flashFired(aptLockId);
          }}
          aria-label={aptLocked ? 'Unlock the apartment' : 'Lock the apartment'}
          title={aptLocked ? 'Unlock the apartment' : 'Lock the apartment'}
        >
          <Icon icon={fired === aptLockId ? 'mdi:check' : aptLocked ? 'mdi:lock' : 'mdi:lock-open-variant'} aria-hidden='true' />
        </button>
      )}
    </span>
  );

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

        {rings.length > 0 && (
          // The ring history row: words are states (when the doorbell last rang), the action
          // is an icon (ghost disc opening the "who rang" gallery). Sits with the Building
          // row because that is whose doors ring; renders only once the archive has at least
          // one snapshot, so a quiet house shows nothing.
          <div className='access-row'>
            <span className='access-row-name'>Doorbell</span>
            <span className='access-doorbell-last'>Last ring {formatRingTime(rings[0])}</span>
            <button
              type='button'
              className='access-doorbell-btn'
              onClick={e => {
                e.stopPropagation();
                setGalleryOpen(true);
              }}
              aria-label='Who rang — see the ring snapshots'
              title='Who rang'
            >
              <Icon icon='mdi:history' aria-hidden='true' />
            </button>
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

  const gallery = galleryOpen && rings.length > 0 ? <DoorbellGallery images={rings} onClose={() => setGalleryOpen(false)} /> : null;

  if (!showHeader) {
    return (
      <div className='access-card is-embedded'>
        {ringRow}
        {alertRow}
        {body}
        {gallery}
      </div>
    );
  }

  return (
    <div className={`access-card ${unlockedTooLong ? 'is-alert' : ''} ${ringing ? 'is-ringing' : ''}`}>
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
          {showStateWord && (
            <span className={`access-state ${unlockedTooLong ? 'alert' : aptLocked ? 'muted' : 'unlocked'}`}>{stateWord}</span>
          )}
          {quickDoors}
          <Icon icon={collapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'} aria-hidden='true' className='access-chevron' />
        </span>
      </div>

      {ringRow}
      {alertRow}
      {!collapsed && body}
      {gallery}
    </div>
  );
}
