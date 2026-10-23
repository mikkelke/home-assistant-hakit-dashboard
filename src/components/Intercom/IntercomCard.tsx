import { lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { APARTMENT_DOOR_OPEN_ENTITY, resolveHallwayDoorSensorId } from '../../config/entities';
import { useLocalStorageBoolean, useTouchScrollSlopGuard } from '../../hooks';
import { useApartmentLock } from '../../hooks/useApartmentLock';
import { LazyBoundary } from '../Lazy/LazyBoundary';
import { fetchDoorbellIndex, formatRingTime, type DoorbellImage } from './doorbellArchive';
import './IntercomCard.css';

const DoorbellGallery = lazy(() => import('./DoorbellGallery').then(module => ({ default: module.DoorbellGallery })));

// "Access" card - the apartment lock, the two building doors, and the auto-open ritual, in the
// Climate-card grammar (see AC/TonightCard). Two homes, one component: the Hallway room detail
// gets the collapsible card (showHeader), the QuickAccess "Apartment access" modal renders the
// same body headerless. House rule: actions are icons, words are states.

interface IntercomCardProps {
  entities: HassEntities;
  callService: CallServiceFunction | undefined;
  showHeader?: boolean; // Show the collapse header (hallway room detail); the modal renders headerless
  onUiTap?: (action: string, detail?: string) => void; // Reports a control the viewer used, for usage counts
}

/** How long the apartment may sit unlocked before the card says so out loud. */
const UNLOCKED_ALERT_MINUTES = 10;
/** How long a fired door shows its green check instead of its own icon. */
const FIRED_FLASH_MS = 2000;
/** When to re-read the ring archive after a ring ends. The bridge archives at EPISODE-CLOSE,
 * a measured ring+75 s across every episode 2026-08-28..30; the later two catch an episode
 * that re-rings extended past that, and cost one 14 kB fetch each. */
const RING_ARCHIVE_SETTLE_MS = [30_000, 90_000, 180_000];

const DOORBELL_FRONT = 'binary_sensor.intercomproxy_doorbell_front_door';
const DOORBELL_BACK = 'binary_sensor.intercomproxy_doorbell_back_door';

// Front street door open command (trial): ABB Welcome integration button, not the ESP lock
// below. ABB's front route is the "fast" unlock - a standalone SIP MESSAGE, harmless to an
// in-progress ring - while the back door stays on its ESP lock, because ABB's back route places
// its own SIP call and would kill the ring recording. Either way lock STATE keeps reading the
// ESP entities (frontLock/backLock below): ABB reports nothing, and the ESP alone sees the door
// controller's bus acknowledgement that the door actually opened. A companion AppDaemon watchdog
// falls back to the ESP unlock if the door hasn't opened ~2.5s after this press.
const FRONT_DOOR_ABB_BUTTON = 'button.abb_welcome_gateway_outdoor_station_2_1';

export function IntercomCard({ entities, callService, showHeader = false, onUiTap }: IntercomCardProps) {
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

  // "Who rang" archive: the AbbWelcomeBridge keeps one snapshot per ring episode in HA's
  // private media folder (doorbellArchive.ts). The archive only exists after the first
  // ring, so until then the Doorbell row stays hidden; a failed read leaves it as it was.
  const [rings, setRings] = useState<DoorbellImage[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const ringsMounted = useRef(true);
  useEffect(() => {
    ringsMounted.current = true;
    return () => {
      ringsMounted.current = false;
    };
  }, []);
  // A failed refresh keeps the list we already have: blanking a populated Doorbell row
  // because one fetch hiccuped is worse than showing the previous ring a minute longer.
  const refreshRings = useCallback(() => {
    fetchDoorbellIndex()
      .then(images => {
        if (ringsMounted.current) setRings(images);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshRings();
  }, [refreshRings]);

  // index.json is a static file - nothing pushes when a ring lands. Fetched once per mount,
  // the always-on tablet would keep showing yesterday's rings forever (user 2026-08-30:
  // "someone just rang but i do not see it in the overview"). So refetch after every ring,
  // on a ladder: the bridge writes the entry at EPISODE-CLOSE, ~75 s after the ring, and
  // later still when re-rings extend the episode. The ring sensors are the same signal the
  // ring row already renders from, so a ring the card reacts to is a ring the archive
  // re-reads for. Opening the gallery refetches too - a deliberate look is never stale.
  const ringingFront = entities?.[DOORBELL_FRONT]?.state === 'on';
  const ringingBack = entities?.[DOORBELL_BACK]?.state === 'on';
  const ringWasActive = useRef(false);
  useEffect(() => {
    if (ringingFront || ringingBack) {
      ringWasActive.current = true;
      return;
    }
    if (!ringWasActive.current) return;
    ringWasActive.current = false;
    const timers = RING_ARCHIVE_SETTLE_MS.map(ms => setTimeout(refreshRings, ms));
    return () => timers.forEach(clearTimeout);
  }, [ringingFront, ringingBack, refreshRings]);

  const autoOpenId = 'input_boolean.auto_open_intercom';
  const frontLockId = 'lock.intercomproxy_front_door';
  const backLockId = 'lock.intercomproxy_back_door';
  const aptDoorSensorId = resolveHallwayDoorSensorId(entities) ?? APARTMENT_DOOR_OPEN_ENTITY;

  const autoOpen = entities?.[autoOpenId];
  const autoOpenEnabled = autoOpen?.state === 'on';

  const frontLock = entities?.[frontLockId];
  const backLock = entities?.[backLockId];
  const aptLock = useApartmentLock(entities, !!callService);
  const aptDoorSensor = entities?.[aptDoorSensorId];

  const aptLocked = aptLock.state === 'locked';
  const aptDoorOpen = aptDoorSensor?.state === 'on';

  // Show only if we have any relevant entity
  if (!autoOpen && !frontLock && !backLock && !aptLock.present) return null;

  // Unlocked for longer than the grace window -> the one red row this card is allowed.
  // Use the same lock truth and its duration as the icon and toggle.
  const unlockedSinceMs = aptLock.state === 'unlocked' && aptLock.since ? Date.parse(aptLock.since) : NaN;
  const unlockedMinutes = Number.isFinite(unlockedSinceMs) ? Math.floor((now - unlockedSinceMs) / 60_000) : 0;
  const unlockedTooLong = Number.isFinite(unlockedSinceMs) && unlockedMinutes >= UNLOCKED_ALERT_MINUTES;

  const stateWord = `${aptLock.label} · ${aptDoorOpen ? 'Open' : 'Closed'}`;
  // Calm is the default, so it doesn't need saying: the closed padlock in the quick row IS
  // "locked". The word only appears when something is off-normal, freeing the header space
  // the doors now use.
  const showStateWord = !aptLocked || aptDoorOpen;

  // A ring is the one moment this card gets loud on its own: the proxy exposes a doorbell
  // sensor per door (read above, where the archive refresh watches the same edge), so the
  // row can name the door that actually rang.
  const ringing = ringingFront
    ? { id: frontLockId, lock: frontLock, name: 'front' }
    : ringingBack
      ? { id: backLockId, lock: backLock, name: 'back' }
      : null;

  const toggleAutoOpen = () => {
    if (!callService || !autoOpen) return;
    onUiTap?.('auto_open', autoOpenEnabled ? 'off' : 'on');
    callService({
      domain: 'input_boolean',
      service: autoOpenEnabled ? 'turn_off' : 'turn_on',
      target: { entity_id: autoOpenId },
    });
  };

  const pulseUnlock = (entityId: string, lockEntity?: { state: string; attributes?: Record<string, unknown> }) => {
    if (!callService) return;
    if (entityId === frontLockId) {
      // Front street door: ABB button press, not a lock service - see FRONT_DOOR_ABB_BUTTON above.
      callService({
        domain: 'button',
        service: 'press',
        target: { entity_id: FRONT_DOOR_ABB_BUTTON },
      });
      return;
    }
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

  const handleAptLockToggle = async () => {
    const service = await aptLock.send();
    if (service) onUiTap?.('lock', service);
  };

  // The alert row is loud on purpose: it sits under the header whether or not the card is
  // expanded (a collapsed card must not be able to hide an unlocked door).
  const commandError = aptLock.error ? (
    <div className='access-alert' role='alert'>
      {aptLock.error}
    </div>
  ) : null;

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
          onUiTap?.('let_in', ringing.name);
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
      {aptLock.present && (frontLock || backLock) && <span className='access-quick-div' aria-hidden='true' />}
      {aptLock.present && (
        <button
          type='button'
          className={`access-quick-btn is-lock ${aptLock.state === 'unlocked' ? 'is-unlocked' : ''}`}
          onClick={handleAptLockToggle}
          disabled={aptLock.disabled}
          aria-busy={aptLock.pending}
          aria-label={aptLock.actionLabel}
          title={aptLock.actionLabel}
        >
          <Icon icon={aptLock.pending ? 'mdi:lock-clock' : aptLock.icon} aria-hidden='true' />
        </button>
      )}
    </span>
  );

  const body = (
    <>
      <div className='access-rows'>
        {aptLock.present && (
          <div className='access-row'>
            <span className='access-row-name'>Apartment</span>
            <span className={`access-pill ${aptLock.state === 'unlocked' ? 'bad' : aptLocked ? '' : 'warn'}`}>{aptLock.label}</span>
            <span className={`access-pill ${aptDoorOpen ? 'warn' : ''}`}>{aptDoorOpen ? 'Open' : 'Closed'}</span>
            {aptLock.degraded && <span className='access-pill warn'>Limited status</span>}
            <button
              type='button'
              className='access-ibtn access-ibtn--sm'
              onClick={handleAptLockToggle}
              disabled={aptLock.disabled}
              aria-busy={aptLock.pending}
              aria-label={aptLock.actionLabel}
              title={aptLock.actionLabel}
            >
              <Icon icon={aptLock.command ? (aptLocked ? 'mdi:lock-open-outline' : 'mdi:lock-outline') : aptLock.icon} aria-hidden='true' />
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
                    onClick={() => {
                      pulseUnlock(frontLockId, frontLock);
                      onUiTap?.('front');
                    }}
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
                    onClick={() => {
                      pulseUnlock(backLockId, backLock);
                      onUiTap?.('back');
                    }}
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
                refreshRings();
                setGalleryOpen(true);
                onUiTap?.('doorbell');
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

  const gallery =
    galleryOpen && rings.length > 0 ? (
      <LazyBoundary fallback={null} error={null}>
        <DoorbellGallery images={rings} onClose={() => setGalleryOpen(false)} />
      </LazyBoundary>
    ) : null;

  if (!showHeader) {
    return (
      <div className='access-card is-embedded'>
        {ringRow}
        {alertRow}
        {commandError}
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
      {commandError}
      {!collapsed && body}
      {gallery}
    </div>
  );
}
