import { useState, useMemo, useEffect, useCallback, useRef, lazy } from 'react';
import { Icon } from '@iconify/react';
import { useHass } from '@hakit/core';
import type { HassEntities, CallServiceFunction } from '../../types';
import { IntercomCard } from '../Intercom';
import { PHONE_PLAYER_NAME, PhonePlayer, SonosPlayer, TVCard, type MoveTarget } from '../MediaPlayer';
import { getWeatherConditionIcon } from '../Weather/weatherIcons';
import { LazyBoundary } from '../Lazy/LazyBoundary';
import { TRANSIT_LAST_UPDATED_SENSOR, TRANSIT_REFRESH_BUTTON, WEATHER_ENTITY } from '../../config/entities';
import { QUICK_ACCESS_OPEN_EVENT, TRANSIT_LINES, getTransitSeverity, isTransitAlert, type TransitStatus } from '../../config/transit';
import { formatTravelTime, getTransitLineDisplayStatus, minsFromNow, TRANSIT_UPCOMING_MIN_MINS } from '../../utils/transitDisplay';
import { SONOS_SPEAKERS } from '../../config/speakers';
import { useModalBackButton, useSwipeToClose, useViewer } from '../../hooks';
import { availablePhonePlayer, isPhonePlayer } from '../../home/household';
import { useTrackedEntities } from '../../hooks/useTrackedEntities';
import { onIdle } from '../../utils/idle';
import type { OpenNow } from '../../utils/navigation';
import { trackUiTap } from '../../utils/trackUiTap';
import { RequestSheet, RequestTile, useRequestAccess } from '../Request';
import './QuickAccess.css';

interface QuickAccessProps {
  hassUrl: string | null;
  callService: CallServiceFunction | undefined;
  /** Opens the #now timeline. */
  onOpenNow: OpenNow;
}

type ModalType = 'intercom' | 'media' | 'weather' | 'transit' | null;
type MediaTab = 'audio' | 'tv';

interface TransitLine {
  name: string;
  icon: string;
  station: string;
  destination: string;
  statusEntityId: string;
  sensorEntityId: string;
  enabledEntityId: string;
}

interface Departure {
  time: string;
  line: string;
  scheduled_time: string;
  delay_min: number;
  cancelled: boolean;
  problematic: boolean;
  category?: string;
  travel_min?: number;
  arrival_time?: string;
}

interface TransitStationGroup {
  station: string;
  maxSeverity: number;
  lines: Array<
    TransitLine & {
      status: TransitStatus;
      displayStatus: TransitStatus;
      departures: Departure[];
      lastChecked: string;
      enabled: boolean;
    }
  >;
}

/** Parse data_as_of (ISO or "HH:MM") and return minutes ago from now. */
function minsSince(dataAsOf: string, now: Date): number | null {
  if (!dataAsOf.trim()) return null;
  let then: Date;
  if (/^\d{4}-\d{2}-\d{2}T/.test(dataAsOf)) {
    then = new Date(dataAsOf);
    if (Number.isNaN(then.getTime())) return null;
  } else {
    const m = dataAsOf.trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    then = new Date(now);
    then.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (then > now) then.setDate(then.getDate() - 1);
  }
  return Math.floor((now.getTime() - then.getTime()) / 60_000);
}

function formatMinsAgo(mins: number): string {
  if (mins <= 0) return 'just now';
  if (mins === 1) return '1 min ago';
  return `${mins} min ago`;
}

function getTransitStatusColor(status: TransitStatus): string {
  switch (status) {
    case 'OK':
      return '#22c55e';
    case 'Delayed':
      return '#fbbf24';
    case 'Disrupted':
      return '#f97316';
    default:
      return '#71717a';
  }
}

function getTransitStatusIcon(status: TransitStatus): string {
  switch (status) {
    case 'OK':
      return 'mdi:check-circle';
    case 'Delayed':
      return 'mdi:clock-alert';
    case 'Disrupted':
      return 'mdi:alert-circle';
    default:
      return 'mdi:help-circle';
  }
}

interface PlayingSpeaker {
  entityId: string;
  name: string;
  groupSize: number;
}

interface TvEntry {
  entityId: string;
  name: string;
}

// Alphabetical by name, which is the order the TV tab lists them in.
const TV_ENTITIES: TvEntry[] = [
  { entityId: 'media_player.bedroom_tv', name: 'Bedroom TV' },
  { entityId: 'media_player.living_room_tv', name: 'Living Room TV' },
];

function hasVisibleTvState(entity: HassEntities[string] | undefined): boolean {
  if (!entity) return false;
  return entity.state === 'on' || entity.state === 'playing' || entity.state === 'paused' || entity.state === 'idle';
}

interface SpeakerInfo {
  entityId: string;
  name: string;
  state: string;
  isPlaying: boolean;
  groupSize: number;
}

const QuickWeatherCard = lazy(() => import('../Weather/QuickWeatherCard').then(module => ({ default: module.QuickWeatherCard })));
const warmQuickWeatherCard = () => void import('../Weather/QuickWeatherCard');

/** The weather card reads the roof station's wind and temperature, which change every minute; its own
 * subscription keeps them out of the dashboard's and drops them when the modal closes. */
function WeatherModalBody({ entityId }: { entityId: string }) {
  const entities = useTrackedEntities();
  return <QuickWeatherCard entityId={entityId} entities={entities} />;
}

// Front street door open command (trial): ABB Welcome integration button, not the ESP lock -
// see IntercomCard's pulseUnlock for the fast-vs-standard SIP-route reasoning. Back door and
// lock STATE display (frontLock/backLock below) are unaffected: only the front command changes.
const FRONT_DOOR_ABB_BUTTON = 'button.abb_welcome_gateway_outdoor_station_2_1';

// Usage counts (script.dashboard_ui_tap): the bar's own taps are `qa.<control>`; what is used inside the media and
// access modals goes through these, which the cards call as `onUiTap`.
const trackMedia = (action: string, detail?: string) => trackUiTap(`qa.media.${action}`, detail);
const trackAccess = (action: string, detail?: string) => trackUiTap(`qa.access.${action}`, detail);
const DOOR_UI: Record<string, string> = {
  'lock.intercomproxy_front_door': 'qa.doors.front',
  'lock.intercomproxy_back_door': 'qa.doors.back',
  'lock.yale_bt': 'qa.doors.lock',
};
const transitLabel = (line: { station: string; name: string }) => `${line.station} / ${line.name}`;

/** Its own subscription: the speakers and TVs it watches change often while something plays, and only the
 * bar and its modals need them. */
export function QuickAccess({ hassUrl, callService, onOpenNow }: QuickAccessProps) {
  const entities = useTrackedEntities();
  const viewer = useViewer();
  const [openModal, setOpenModal] = useState<ModalType>(null);
  // Frozen at media-modal open: joins/unjoins change coordinators and flicker `playing`,
  // which would otherwise unmount a SonosPlayer (and its open speaker picker) mid-operation.
  const [mediaPlayersSnapshot, setMediaPlayersSnapshot] = useState<PlayingSpeaker[] | null>(null);
  const [selectedSpeakerForQuickStart, setSelectedSpeakerForQuickStart] = useState<string | null>(null);
  const [showSpeakerSelector, setShowSpeakerSelector] = useState(false);
  const [mediaTab, setMediaTab] = useState<MediaTab>('audio');
  const [requestOpen, setRequestOpen] = useState(false);
  const { allowed: requestAllowed, drtv: requestDrtv } = useRequestAccess();
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const [isTransitRefreshing, setIsTransitRefreshing] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const ms = openModal === 'transit' ? 15_000 : 60_000;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [openModal]);

  // Find all playing Sonos speakers/groups
  const playingSpeakers = useMemo<PlayingSpeaker[]>(() => {
    const playing: PlayingSpeaker[] = [];
    const seenGroups = new Set<string>();
    const seenSpeakerIds = new Set<string>();

    // Check if living room TV is on and using Sonos
    const livingRoomTv = entities?.['media_player.living_room_tv'];
    const isLivingRoomTvOn =
      livingRoomTv &&
      (livingRoomTv.state === 'on' || livingRoomTv.state === 'playing' || livingRoomTv.state === 'paused' || livingRoomTv.state === 'idle');

    // Find all playing speakers - only add coordinators (masters) of groups
    SONOS_SPEAKERS.forEach(speaker => {
      const entity = entities?.[speaker.id];
      if (!entity) return;

      // Check if playing - Sonos can be 'playing', 'paused', 'idle', etc.
      const isPlaying = entity.state === 'playing';
      if (!isPlaying) return;

      // Hide living room Sonos when TV is using it
      const isLivingRoomSonos = speaker.id === 'media_player.living_room';
      const sonosSource = typeof entity.attributes?.source === 'string' ? entity.attributes.source : '';
      const isTvUsingSonos = isLivingRoomSonos && isLivingRoomTvOn && sonosSource.toLowerCase().includes('tv');
      if (isTvUsingSonos) return;

      const rawGroup = entity.attributes?.group_members;
      const groupMembers: string[] = Array.isArray(rawGroup) ? (rawGroup as string[]) : [speaker.id];
      // Ensure groupMembers is not empty - if it is, treat as solo speaker
      const actualGroupMembers = groupMembers.length > 0 ? groupMembers : [speaker.id];
      const groupKey = [...actualGroupMembers].sort().join(','); // Create unique key for group

      // Skip if we've already processed this group
      if (seenGroups.has(groupKey)) return;

      // Check if this speaker is the coordinator/master (first in group_members)
      // Solo speakers (groupSize === 1) are always coordinators of their own group
      const isSolo = actualGroupMembers.length === 1;
      const isCoordinator = actualGroupMembers[0] === speaker.id;

      // Only add coordinators/masters - never add non-coordinator group members
      // Solo speakers are always coordinators, so they get added
      if (isSolo || isCoordinator) {
        seenGroups.add(groupKey);
        // Mark all group members as seen to avoid processing them again
        actualGroupMembers.forEach(memberId => seenSpeakerIds.add(memberId));

        playing.push({
          entityId: speaker.id,
          name: speaker.name,
          groupSize: actualGroupMembers.length,
        });
      }
    });

    // Sort: groups first (by size, biggest first), then individual speakers alphabetically
    return playing.sort((a, b) => {
      const aIsGroup = a.groupSize > 1;
      const bIsGroup = b.groupSize > 1;

      // Groups come before individual speakers
      if (aIsGroup && !bIsGroup) return -1;
      if (!aIsGroup && bIsGroup) return 1;

      // If both are groups or both are individuals, sort by group size (biggest first), then alphabetically
      if (aIsGroup && bIsGroup) {
        if (b.groupSize !== a.groupSize) {
          return b.groupSize - a.groupSize; // Biggest group first
        }
      }

      return a.name.localeCompare(b.name); // Then alphabetically
    });
  }, [entities]);

  const allTVs = useMemo(() => TV_ENTITIES.filter(tv => entities?.[tv.entityId]), [entities]);
  const playingTVs = useMemo(() => allTVs.filter(tv => hasVisibleTvState(entities?.[tv.entityId])), [allTVs, entities]);

  const resetModalState = useCallback(() => {
    setSelectedSpeakerForQuickStart(null);
    setShowSpeakerSelector(false);
    setExpandedLine(null);
    setMediaPlayersSnapshot(null);
    setRequestOpen(false);
  }, []);

  const openQuickAccess = useCallback(
    (type: Exclude<ModalType, null>) => {
      resetModalState();
      if (type === 'media') {
        // Freeze the media player list for the modal's lifetime: group operations change
        // coordinators and flicker `playing`, which would unmount an open speaker picker.
        setMediaPlayersSnapshot(playingSpeakers);
        setMediaTab(playingSpeakers.length === 0 && playingTVs.length > 0 ? 'tv' : 'audio');
      }
      setOpenModal(type);
    },
    [resetModalState, playingSpeakers, playingTVs]
  );

  // Only the bar's buttons count as Quick Access taps: the home screen's chips open the same modals through the open event.
  const openFromBar = (type: 'media' | 'transit' | 'weather') => {
    openQuickAccess(type);
    trackUiTap(`qa.${type}`);
  };

  const handleClose = useCallback(() => {
    setOpenModal(null);
    resetModalState();
  }, [resetModalState]);

  const { requestClose: requestCloseQuickAccess } = useModalBackButton({
    isOpen: openModal !== null,
    onRequestClose: handleClose,
    historyKey: openModal ? `quick-access-${openModal}` : 'quick-access',
  });

  useEffect(() => {
    const handleOpenQuickAccess = (event: Event) => {
      const modal = (event as CustomEvent<{ modal?: ModalType }>).detail?.modal;
      if (modal === 'intercom' || modal === 'media' || modal === 'weather' || modal === 'transit') {
        openQuickAccess(modal);
      }
    };

    window.addEventListener(QUICK_ACCESS_OPEN_EVENT, handleOpenQuickAccess as EventListener);
    return () => window.removeEventListener(QUICK_ACCESS_OPEN_EVENT, handleOpenQuickAccess as EventListener);
  }, [openQuickAccess]);

  const toggleLineExpand = (line: TransitLine) => {
    if (expandedLine !== line.statusEntityId) trackUiTap('qa.transit.line', transitLabel(line));
    setExpandedLine(prev => (prev === line.statusEntityId ? null : line.statusEntityId));
  };

  const handleTransitToggle = (line: TransitLine & { enabled: boolean }) => {
    callService?.({ domain: 'input_boolean', service: 'toggle', target: { entity_id: line.enabledEntityId } });
    trackUiTap('qa.transit.route', `${transitLabel(line)} ${line.enabled ? 'off' : 'on'}`);
  };

  const handleTransitRefresh = async () => {
    if (!callService || isTransitRefreshing) return;
    setIsTransitRefreshing(true);
    trackUiTap('qa.transit.refresh');
    try {
      await callService({ domain: 'input_button', service: 'press', target: { entity_id: TRANSIT_REFRESH_BUTTON } });
    } finally {
      setTimeout(() => setIsTransitRefreshing(false), 2000);
    }
  };

  // Get all speakers with their states, sorted alphabetically
  const allSpeakers = useMemo<SpeakerInfo[]>(() => {
    const speakers = SONOS_SPEAKERS.map(speaker => {
      const entity = entities?.[speaker.id];

      if (!entity) {
        return {
          entityId: speaker.id,
          name: speaker.name,
          state: 'unavailable',
          isPlaying: false,
          groupSize: 1,
        };
      }

      const rawGroupAll = entity.attributes?.group_members;
      const groupMembers: string[] = Array.isArray(rawGroupAll) ? (rawGroupAll as string[]) : [speaker.id];
      const actualGroupMembers = groupMembers.length > 0 ? groupMembers : [speaker.id];
      const isPlaying = entity.state === 'playing';
      const isCoordinator = actualGroupMembers[0] === speaker.id;

      // Only show coordinator speakers to avoid duplicates
      if (!isCoordinator && actualGroupMembers.length > 1) {
        return null;
      }

      return {
        entityId: speaker.id,
        name: speaker.name,
        state: entity.state || 'unavailable',
        isPlaying,
        groupSize: actualGroupMembers.length,
      };
    }).filter((s): s is SpeakerInfo => s !== null);

    // Sort alphabetically by name
    return speakers.sort((a, b) => a.name.localeCompare(b.name));
  }, [entities]);

  const phoneId = availablePhonePlayer(viewer.name, id => entities?.[id]?.state);
  const phonePlaying = phoneId !== null && phoneId !== undefined && entities?.[phoneId]?.state === 'playing';
  const moveTargets = useMemo<MoveTarget[]>(
    () => allSpeakers.filter(s => s.state !== 'unavailable').map(s => ({ entityId: s.entityId, name: s.name, groupSize: s.groupSize })),
    [allSpeakers]
  );

  const weatherCondition = useHass(s => s.entities[WEATHER_ENTITY]?.state);
  const weatherEntityId = weatherCondition != null ? WEATHER_ENTITY : null;
  const weatherConditionIcon = getWeatherConditionIcon(weatherCondition);

  useEffect(() => onIdle(warmQuickWeatherCard, 4000, 6000), []);

  const transitStationGroups = useMemo<TransitStationGroup[]>(() => {
    const lineData = TRANSIT_LINES.map(line => {
      const sensor = entities?.[line.sensorEntityId];
      const departures = (sensor?.attributes?.departures ?? []) as Departure[];
      const status = (entities?.[line.statusEntityId]?.state ?? 'Unavailable') as TransitStatus;
      return {
        ...line,
        status,
        displayStatus: getTransitLineDisplayStatus(line, entities, now),
        departures,
        lastChecked: (sensor?.attributes?.data_as_of ?? sensor?.attributes?.last_checked ?? '') as string,
        enabled: entities?.[line.enabledEntityId]?.state !== 'off',
      };
    });

    const groupMap = new Map<string, typeof lineData>();
    for (const line of lineData) {
      const group = groupMap.get(line.station) ?? [];
      group.push(line);
      groupMap.set(line.station, group);
    }

    const groups: TransitStationGroup[] = [];
    for (const [station, lines] of groupMap) {
      const sorted = [...lines].sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        const bySeverity = getTransitSeverity(b.displayStatus) - getTransitSeverity(a.displayStatus);
        if (bySeverity !== 0) return bySeverity;
        return a.destination.localeCompare(b.destination, undefined, { sensitivity: 'base' });
      });
      const maxSeverity = lines.filter(l => l.enabled).reduce((max, l) => Math.max(max, getTransitSeverity(l.displayStatus)), 0);
      groups.push({ station, maxSeverity, lines: sorted });
    }

    groups.sort((a, b) => {
      const bySeverity = b.maxSeverity - a.maxSeverity;
      if (bySeverity !== 0) return bySeverity;
      return a.station.localeCompare(b.station, undefined, { sensitivity: 'base' });
    });
    return groups;
  }, [entities, now]);

  const hasTransitAlert = transitStationGroups.flatMap(g => g.lines).some(l => l.enabled && isTransitAlert(l.displayStatus));

  const hasPlayingSpeakers = playingSpeakers.length > 0;
  const hasPlayingTVs = playingTVs.length > 0;
  const hasPlayingMedia = hasPlayingSpeakers || hasPlayingTVs;

  // Inside the media modal, render from the open-time snapshot so cards (and any open
  // speaker picker inside them) survive regrouping; fall back to live when no snapshot.
  const displayedSpeakers = mediaPlayersSnapshot ?? playingSpeakers;
  const liveGroupSize = (id: string): number => {
    const gm = entities?.[id]?.attributes?.group_members;
    const n = Array.isArray(gm) ? gm.filter(m => typeof m === 'string' && m.length > 0).length : 0;
    return n > 0 ? n : 1;
  };

  const selectedIsPhone = selectedSpeakerForQuickStart !== null && isPhonePlayer(selectedSpeakerForQuickStart);
  const selectedName = selectedIsPhone
    ? PHONE_PLAYER_NAME
    : (SONOS_SPEAKERS.find(speaker => speaker.id === selectedSpeakerForQuickStart)?.name ?? '');
  const selectedGroupSize = selectedSpeakerForQuickStart !== null && !selectedIsPhone ? liveGroupSize(selectedSpeakerForQuickStart) : 1;

  // Use standardized swipe-to-close hook
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestCloseQuickAccess);

  // Doors popover: TAP the Access button for the three doors from any tab (user 2026-07-31 -
  // one interaction everywhere, no press-and-hold anywhere in this app). The full panel moved
  // one step back: the popover's last button opens it, since the doors are what you actually
  // came for. Doors are one tap each, same rule as the Access card's collapsed row.
  const [doorsOpen, setDoorsOpen] = useState(false);
  const [doorFired, setDoorFired] = useState<string | null>(null);
  const firedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (firedTimer.current) clearTimeout(firedTimer.current);
    },
    []
  );

  const frontLock = entities?.['lock.intercomproxy_front_door'];
  const backLock = entities?.['lock.intercomproxy_back_door'];
  const aptLock = entities?.['lock.yale_bt'];
  const aptLocked = aptLock?.state === 'locked';

  const fireDoor = useCallback(
    (entityId: string, lockEntity: typeof frontLock, lockToggle = false) => {
      if (!callService) return;
      if (!lockToggle && entityId === 'lock.intercomproxy_front_door') {
        // Front street door: ABB button press, not a lock service - see FRONT_DOOR_ABB_BUTTON above.
        callService({ domain: 'button', service: 'press', target: { entity_id: FRONT_DOOR_ABB_BUTTON } });
      } else {
        const supported = Number(lockEntity?.attributes?.supported_features ?? 0);
        const service = lockToggle ? (aptLocked ? 'unlock' : 'lock') : (supported & 1) !== 0 ? 'open' : 'unlock';
        callService({ domain: 'lock', service, target: { entity_id: entityId } });
      }
      trackUiTap(DOOR_UI[entityId], lockToggle ? (aptLocked ? 'unlock' : 'lock') : undefined);
      setDoorFired(entityId);
      if (firedTimer.current) clearTimeout(firedTimer.current);
      firedTimer.current = setTimeout(() => setDoorFired(null), 2000);
    },
    [callService, aptLocked]
  );

  const qaDoorBtn = (id: string, lock: typeof frontLock, letter: string, label: string) => (
    <button
      type='button'
      className={`qa-door ${doorFired === id ? 'is-done' : ''}`}
      onClick={() => fireDoor(id, lock)}
      aria-label={label}
      title={label}
    >
      <Icon icon={doorFired === id ? 'mdi:check' : 'mdi:door-open'} />
      {doorFired !== id && <span className='qa-door-tag'>{letter}</span>}
    </button>
  );

  return (
    <>
      {doorsOpen && <div className='qa-doors-scrim' onClick={() => setDoorsOpen(false)} />}
      <div className='quick-access'>
        {doorsOpen && (
          <div className='qa-doors' role='group' aria-label='Doors'>
            {frontLock && qaDoorBtn('lock.intercomproxy_front_door', frontLock, 'F', 'Open the front building door')}
            {backLock && qaDoorBtn('lock.intercomproxy_back_door', backLock, 'B', 'Open the back building door')}
            {aptLock && (frontLock || backLock) && <span className='qa-door-div' aria-hidden='true' />}
            {aptLock && (
              <button
                type='button'
                className={`qa-door is-lock ${aptLocked ? '' : 'is-unlocked'} ${doorFired === 'lock.yale_bt' ? 'is-done' : ''}`}
                onClick={() => fireDoor('lock.yale_bt', aptLock, true)}
                aria-label={aptLocked ? 'Unlock the apartment' : 'Lock the apartment'}
                title={aptLocked ? 'Unlock the apartment' : 'Lock the apartment'}
              >
                <Icon icon={doorFired === 'lock.yale_bt' ? 'mdi:check' : aptLocked ? 'mdi:lock' : 'mdi:lock-open-variant'} />
              </button>
            )}
            <span className='qa-door-div' aria-hidden='true' />
            <button
              type='button'
              className='qa-door is-more'
              onClick={() => {
                setDoorsOpen(false);
                openQuickAccess('intercom');
                trackUiTap('qa.access.panel');
              }}
              aria-label='Open the access panel'
              title='Access panel'
            >
              <Icon icon='mdi:dots-horizontal' />
            </button>
          </div>
        )}
        <button
          className={`qa-button ${doorsOpen ? 'is-active' : ''}`}
          onClick={() => {
            setDoorsOpen(v => !v);
            if (!doorsOpen) trackUiTap('qa.access');
          }}
          title='Access'
        >
          <Icon icon='mdi:door' />
        </button>
        <button className='qa-button' onClick={() => openFromBar('media')} title='Media controls'>
          <Icon icon='mdi:cast-audio' />
          {hasPlayingMedia && <span className='qa-badge'>{playingSpeakers.length + playingTVs.length}</span>}
        </button>
        <button className='qa-button' onClick={() => openFromBar('transit')} title='Transit'>
          <Icon icon='mdi:train' />
          {hasTransitAlert && <span className='qa-badge qa-badge--alert' />}
        </button>
        <button
          className='qa-button'
          onClick={() => {
            onOpenNow(null);
            trackUiTap('qa.timeline');
          }}
          title='Timeline'
          aria-label='Open the timeline'
        >
          <Icon icon='mdi:timeline-clock-outline' />
        </button>
        <button
          className='qa-button'
          onClick={() => openFromBar('weather')}
          disabled={!weatherEntityId}
          title={weatherEntityId ? 'Open weather' : 'No weather entity found'}
        >
          <Icon icon={weatherConditionIcon} />
        </button>
      </div>

      {openModal && (
        <div
          className='qa-overlay'
          onClick={e => {
            e.stopPropagation();
            requestCloseQuickAccess();
          }}
        >
          <div
            className={`qa-modal ${openModal}`}
            role='dialog'
            aria-modal='true'
            onClick={e => e.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div className='qa-modal-header'>
              <span className='qa-title'>
                {openModal === 'intercom' && 'Apartment access'}
                {openModal === 'media' && 'Media'}
                {openModal === 'transit' && 'Transit'}
                {openModal === 'weather' && 'Weather'}
              </span>
              <div className='qa-header-actions'>
                {openModal === 'transit' && (
                  <button
                    className={`info-refresh-btn ${isTransitRefreshing ? 'spinning' : ''}`}
                    onClick={handleTransitRefresh}
                    disabled={isTransitRefreshing}
                    title='Refresh transit data'
                    aria-label='Refresh transit data'
                  >
                    <Icon icon='mdi:refresh' />
                  </button>
                )}
                {openModal === 'media' && mediaTab === 'audio' && !selectedSpeakerForQuickStart && !showSpeakerSelector && (
                  <button
                    className='qa-add-speaker-icon-btn'
                    onClick={() => {
                      setShowSpeakerSelector(true);
                      trackMedia('add_speaker');
                    }}
                    title='Start music on a speaker'
                  >
                    <Icon icon='mdi:cast-audio' />
                    <Icon icon='mdi:plus' className='qa-plus-icon-small' />
                  </button>
                )}
                <button className='qa-close modal-close-button' onClick={requestCloseQuickAccess}>
                  <Icon icon='mdi:close' />
                </button>
              </div>
            </div>
            <div className={`qa-modal-body ${openModal ?? ''}`}>
              {openModal === 'intercom' && <IntercomCard entities={entities} callService={callService} onUiTap={trackAccess} />}
              {openModal === 'media' && (
                <div className='qa-media-content'>
                  <div className='qa-media-tabs' role='group' aria-label='Media type'>
                    <button
                      type='button'
                      className={`qa-media-tab ${mediaTab === 'audio' ? 'is-active' : ''}`}
                      aria-pressed={mediaTab === 'audio'}
                      aria-label={hasPlayingSpeakers ? 'Audio, playing' : 'Audio'}
                      onClick={() => {
                        if (mediaTab !== 'audio') trackMedia('tab', 'audio');
                        setMediaTab('audio');
                      }}
                    >
                      <span className='qa-media-tab-icon'>
                        <Icon icon='mdi:music-note' />
                        {hasPlayingSpeakers && <span className='qa-media-tab-dot' />}
                      </span>
                    </button>
                    <button
                      type='button'
                      className={`qa-media-tab ${mediaTab === 'tv' ? 'is-active' : ''}`}
                      aria-pressed={mediaTab === 'tv'}
                      aria-label={hasPlayingTVs ? 'TV, playing' : 'TV'}
                      onClick={() => {
                        if (mediaTab !== 'tv') trackMedia('tab', 'tv');
                        setMediaTab('tv');
                      }}
                    >
                      <span className='qa-media-tab-icon'>
                        <Icon icon='mdi:television' />
                        {hasPlayingTVs && <span className='qa-media-tab-dot' />}
                      </span>
                    </button>
                  </div>
                  {mediaTab === 'tv' ? (
                    <div className='qa-media-section'>
                      <div className='qa-media-list'>
                        {requestAllowed && (
                          <RequestTile
                            onOpen={() => {
                              setRequestOpen(true);
                              trackMedia('request');
                            }}
                          />
                        )}
                        {allTVs.map(tv => {
                          // Get TV-specific props based on entity ID
                          const isBedroom = tv.entityId === 'media_player.bedroom_tv';
                          const isLivingRoom = tv.entityId === 'media_player.living_room_tv';
                          return (
                            <div key={tv.entityId} className='qa-media-item'>
                              <div className='qa-media-identity'>
                                <div className='qa-media-label'>
                                  <Icon icon='mdi:television' />
                                  <span className='qa-media-label-text'>{tv.name}</span>
                                </div>
                              </div>
                              {isBedroom && (
                                <TVCard
                                  entityId={tv.entityId}
                                  entities={entities}
                                  hassUrl={hassUrl}
                                  callService={callService}
                                  appleRemoteEntityId='remote.bedroom_apple_tv'
                                  appleMediaPlayerEntityId='media_player.bedroom_apple_tv'
                                  onUiTap={trackMedia}
                                />
                              )}
                              {isLivingRoom && (
                                <TVCard
                                  entityId={tv.entityId}
                                  entities={entities}
                                  hassUrl={hassUrl}
                                  callService={callService}
                                  showTvLift={true}
                                  tvLiftSelectEntityId='select.living_room_tv_lift_position'
                                  appleRemoteEntityId='remote.living_room_apple_tv'
                                  appleMediaPlayerEntityId='media_player.living_room_apple_tv'
                                  chromecastEntityId='media_player.living_room_cast'
                                  wirelessUsbCSourceName='HDMI4'
                                  onUiTap={trackMedia}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : selectedSpeakerForQuickStart ? (
                    <div className='qa-media-section'>
                      <div className='qa-media-head'>
                        <button className='qa-back-button' onClick={() => setSelectedSpeakerForQuickStart(null)}>
                          <Icon icon='mdi:arrow-left' />
                          <span>Back</span>
                        </button>
                        <div className='qa-media-identity'>
                          <div className='qa-media-label'>
                            <Icon icon={selectedIsPhone ? 'mdi:cellphone' : 'mdi:speaker'} />
                            <span className='qa-media-label-text'>{selectedName}</span>
                          </div>
                          {selectedGroupSize > 1 && (
                            <span className='qa-media-badge qa-media-badge--group'>{selectedGroupSize} speakers</span>
                          )}
                        </div>
                      </div>
                      {selectedIsPhone ? (
                        <PhonePlayer
                          entityId={selectedSpeakerForQuickStart}
                          entities={entities}
                          hassUrl={hassUrl}
                          callService={callService}
                          targets={moveTargets}
                          onUiTap={trackMedia}
                        />
                      ) : (
                        <SonosPlayer
                          entityId={selectedSpeakerForQuickStart}
                          entities={entities}
                          hassUrl={hassUrl}
                          callService={callService}
                          embedded
                          onUiTap={trackMedia}
                        />
                      )}
                    </div>
                  ) : showSpeakerSelector || (displayedSpeakers.length === 0 && !phonePlaying) ? (
                    // Show speaker list when "add speaker" button is clicked OR when nothing is playing
                    <div className='qa-media-section'>
                      <div className='qa-speaker-list'>
                        {phoneId && (
                          <button
                            className='qa-speaker-line'
                            onClick={() => {
                              setSelectedSpeakerForQuickStart(phoneId);
                              trackMedia('play_room', phoneId);
                            }}
                          >
                            <Icon icon='mdi:cellphone' />
                            <span className='qa-speaker-name'>{PHONE_PLAYER_NAME}</span>
                            <Icon icon='mdi:chevron-right' className='qa-chevron' />
                          </button>
                        )}
                        {allSpeakers.map(speaker => (
                          <button
                            key={speaker.entityId}
                            className='qa-speaker-line'
                            onClick={() => {
                              if (speaker.state === 'unavailable') return;
                              setSelectedSpeakerForQuickStart(speaker.entityId);
                              trackMedia('play_room', speaker.entityId);
                            }}
                            disabled={speaker.state === 'unavailable'}
                          >
                            <Icon icon='mdi:speaker' />
                            <span className='qa-speaker-name'>{speaker.name}</span>
                            {speaker.groupSize > 1 && <span className='qa-media-group-badge'>{speaker.groupSize} speakers</span>}
                            {speaker.state !== 'unavailable' && <Icon icon='mdi:chevron-right' className='qa-chevron' />}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    // Show playing speakers
                    <div className='qa-media-section'>
                      <div className='qa-media-list'>
                        {phonePlaying && phoneId && (
                          <div className='qa-media-item'>
                            <div className='qa-media-identity'>
                              <div className='qa-media-label'>
                                <Icon icon='mdi:cellphone' />
                                <span className='qa-media-label-text'>{PHONE_PLAYER_NAME}</span>
                              </div>
                            </div>
                            <PhonePlayer
                              entityId={phoneId}
                              entities={entities}
                              hassUrl={hassUrl}
                              callService={callService}
                              targets={moveTargets}
                              onUiTap={trackMedia}
                            />
                          </div>
                        )}
                        {displayedSpeakers.map(speaker => {
                          const groupSize = liveGroupSize(speaker.entityId);
                          return (
                            <div key={speaker.entityId} className='qa-media-item'>
                              <div className='qa-media-identity'>
                                <div className='qa-media-label'>
                                  <Icon icon='mdi:speaker' />
                                  <span className='qa-media-label-text'>{speaker.name}</span>
                                </div>
                                {groupSize > 1 && <span className='qa-media-badge qa-media-badge--group'>{groupSize} speakers</span>}
                              </div>
                              <SonosPlayer
                                entityId={speaker.entityId}
                                entities={entities}
                                hassUrl={hassUrl}
                                callService={callService}
                                embedded
                                onUiTap={trackMedia}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {openModal === 'transit' &&
                (() => {
                  const lastUpdatedSensor = entities?.[TRANSIT_LAST_UPDATED_SENSOR];
                  const lastUpdatedIso = (lastUpdatedSensor?.state ?? '').trim();
                  const fallbackChecked = transitStationGroups.flatMap(g => g.lines).find(l => l.lastChecked)?.lastChecked ?? '';
                  const sourceTs = lastUpdatedIso || fallbackChecked;
                  const minsAgo = sourceTs ? minsSince(sourceTs, now) : null;
                  const updatedLabel = minsAgo !== null ? formatMinsAgo(minsAgo) : lastUpdatedIso || fallbackChecked ? '—' : '';

                  const intervalMin = lastUpdatedSensor?.attributes?.effective_interval_min;
                  let scheduleLabel = '';
                  if (typeof intervalMin === 'number' && intervalMin === 0) {
                    scheduleLabel = 'On demand';
                  } else if (typeof intervalMin === 'number' && intervalMin > 0 && sourceTs) {
                    const lastUpdateMs = new Date(sourceTs).getTime();
                    if (!Number.isNaN(lastUpdateMs)) {
                      const nextRefreshMs = lastUpdateMs + intervalMin * 60 * 1000;
                      const minsUntil = Math.ceil((nextRefreshMs - now.getTime()) / 60_000);
                      scheduleLabel = minsUntil <= 0 ? 'Refresh soon' : `Refresh in ${minsUntil} min`;
                    } else {
                      scheduleLabel = `Every ${intervalMin} min`;
                    }
                  } else if (typeof intervalMin === 'number' && intervalMin > 0) {
                    scheduleLabel = `Every ${intervalMin} min`;
                  }

                  const showUpdateInfo = (gi: number) => gi === 0 && (updatedLabel || scheduleLabel);

                  return (
                    <div className='info-transit-list'>
                      {transitStationGroups.map((group, gi) => (
                        <div key={group.station} className={`info-transit-station-group ${group.maxSeverity >= 2 ? 'has-alert' : ''}`}>
                          <div className='info-transit-station-header'>
                            <Icon icon='mdi:map-marker-outline' />
                            <span>{group.station}</span>
                            {group.maxSeverity >= 2 && <Icon icon='mdi:alert' className='info-transit-station-alert-icon' />}
                            {showUpdateInfo(gi) && (
                              <div className='info-transit-global-checked'>
                                {updatedLabel && <span>Updated {updatedLabel}</span>}
                                {scheduleLabel && <span className='info-transit-schedule'>{scheduleLabel}</span>}
                              </div>
                            )}
                          </div>
                          {group.lines.map(line => {
                            const isExpanded = expandedLine === line.statusEntityId;
                            return (
                              <div
                                key={line.statusEntityId}
                                className={`info-transit-row ${!line.enabled ? 'disabled' : isTransitAlert(line.displayStatus) ? 'disrupted' : ''}`}
                              >
                                <button
                                  className='info-transit-header info-transit-row-btn'
                                  onClick={() => toggleLineExpand(line)}
                                  aria-expanded={isExpanded}
                                >
                                  <Icon icon={line.icon} className='info-transit-line-icon' />
                                  <div className='info-transit-name-group'>
                                    <span className='info-transit-name'>{line.name}</span>
                                    <span className='info-transit-direction'>
                                      <Icon icon='mdi:arrow-right' />
                                      {line.destination}
                                    </span>
                                  </div>
                                  {line.enabled && (
                                    <span className='info-transit-status' style={{ color: getTransitStatusColor(line.displayStatus) }}>
                                      <Icon icon={getTransitStatusIcon(line.displayStatus)} />
                                      {line.displayStatus}
                                    </span>
                                  )}
                                  <Icon icon='mdi:chevron-right' className={`info-transit-chevron ${isExpanded ? 'expanded' : ''}`} />
                                </button>
                                {isExpanded && (
                                  <div className='info-transit-settings'>
                                    <span className='info-transit-settings-label'>Route enabled</span>
                                    <button
                                      className={`info-transit-toggle ${line.enabled ? 'on' : 'off'}`}
                                      onClick={e => {
                                        e.stopPropagation();
                                        handleTransitToggle(line);
                                      }}
                                      aria-label={line.enabled ? 'Disable route' : 'Enable route'}
                                      title={line.enabled ? 'Disable route' : 'Enable route'}
                                    />
                                  </div>
                                )}
                                {line.enabled &&
                                  (() => {
                                    const deps = line.departures
                                      .map(d => ({ ...d, mins: minsFromNow(d.time, now) }))
                                      .filter(d => d.mins >= TRANSIT_UPCOMING_MIN_MINS)
                                      .slice(0, 4);
                                    // The badge follows travel times (long-distance route only), so S-tog and Metro chips stay plain.
                                    const showCategory = deps.some(d => d.travel_min);
                                    const allDepartedOver2Min =
                                      line.departures.length > 0 && line.departures.every(d => minsFromNow(d.time, now) < -2);
                                    const noIssues = !isTransitAlert(line.displayStatus);
                                    const emptyMessage = allDepartedOver2Min && noIssues ? 'Please refresh data' : 'No data';
                                    return (
                                      <div className='info-transit-departures'>
                                        {deps.length > 0 ? (
                                          <div className='info-transit-dep-chips'>
                                            {deps.map(d => {
                                              const cls = [
                                                'info-transit-dep-chip',
                                                d.mins < 0 ? 'stale' : '',
                                                d.cancelled ? 'cancelled' : '',
                                                !d.cancelled && d.problematic ? 'problematic' : '',
                                              ]
                                                .filter(Boolean)
                                                .join(' ');
                                              return (
                                                <span key={`${d.line}-${d.time}`} className={cls}>
                                                  <span className='info-transit-dep-mins'>
                                                    {d.cancelled ? 'Cancelled' : d.mins <= 0 ? 'Now' : `${d.mins} min`}
                                                    {showCategory && d.category && (
                                                      <span className='info-transit-dep-cat'>{d.category}</span>
                                                    )}
                                                  </span>
                                                  <span className='info-transit-dep-time'>
                                                    {d.cancelled ? (
                                                      <s>{d.scheduled_time}</s>
                                                    ) : (
                                                      <>
                                                        {d.time}
                                                        {d.delay_min > 0 && <span className='info-transit-dep-delay'>+{d.delay_min}m</span>}
                                                        {d.travel_min ? (
                                                          <span className='info-transit-dep-travel'>
                                                            · {formatTravelTime(d.travel_min)}
                                                          </span>
                                                        ) : null}
                                                      </>
                                                    )}
                                                  </span>
                                                </span>
                                              );
                                            })}
                                          </div>
                                        ) : (
                                          <span className='info-transit-no-dep'>{emptyMessage}</span>
                                        )}
                                      </div>
                                    );
                                  })()}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              {openModal === 'weather' && weatherEntityId && (
                <div className='quick-weather-wrapper'>
                  <LazyBoundary
                    fallback={
                      <div className='timeline-loading'>
                        <Icon icon='mdi:loading' className='timeline-spinner' />
                        <span>Loading weather...</span>
                      </div>
                    }
                    error={
                      <div className='timeline-error'>
                        <Icon icon='mdi:alert-circle' />
                        <span>Could not load the weather</span>
                      </div>
                    }
                  >
                    <WeatherModalBody entityId={weatherEntityId} />
                  </LazyBoundary>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* A sibling of the media modal, not a child: React bubbles the sheet's touch events up the component
          tree, which would otherwise feed its swipes into the media modal's own swipe-to-close. */}
      {openModal === 'media' && requestAllowed && requestOpen && <RequestSheet drtv={requestDrtv} onClose={() => setRequestOpen(false)} />}
    </>
  );
}
