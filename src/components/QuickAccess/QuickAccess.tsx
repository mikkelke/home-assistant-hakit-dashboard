import { useState, useMemo, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { IntercomCard } from '../Intercom';
import { SonosPlayer, TVCard } from '../MediaPlayer';
import { QuickWeatherCard, getWeatherConditionIcon } from '../Weather';
import { TRANSIT_LAST_UPDATED_SENSOR, TRANSIT_REFRESH_BUTTON } from '../../config/entities';
import { QUICK_ACCESS_OPEN_EVENT, TRANSIT_LINES, getTransitSeverity, isTransitAlert, type TransitStatus } from '../../config/transit';
import { getTransitLineDisplayStatus, minsFromNow, TRANSIT_UPCOMING_MIN_MINS } from '../../utils/transitDisplay';
import { isMediaPlayerOutOfSync, resolvePreferredMediaPlayer } from '../../utils/mediaPlayer';
import { SONOS_SPEAKERS } from '../../config/speakers';
import { useModalBackButton, useSwipeToClose } from '../../hooks';
import './QuickAccess.css';

interface QuickAccessProps {
  entities: HassEntities;
  hassUrl: string | null;
  callService: CallServiceFunction | undefined;
}

type ModalType = 'intercom' | 'media' | 'weather' | 'transit' | null;

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

interface PlayingTV {
  entityId: string;
  name: string;
}

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

export function QuickAccess({ entities, hassUrl, callService }: QuickAccessProps) {
  const [openModal, setOpenModal] = useState<ModalType>(null);
  const [selectedSpeakerForQuickStart, setSelectedSpeakerForQuickStart] = useState<string | null>(null);
  const [showSpeakerSelector, setShowSpeakerSelector] = useState(false);
  const [expandedLine, setExpandedLine] = useState<string | null>(null);
  const [isTransitRefreshing, setIsTransitRefreshing] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const ms = openModal === 'transit' ? 15_000 : 60_000;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [openModal]);

  const resetModalState = useCallback(() => {
    setSelectedSpeakerForQuickStart(null);
    setShowSpeakerSelector(false);
    setExpandedLine(null);
  }, []);

  const openQuickAccess = useCallback(
    (type: Exclude<ModalType, null>) => {
      resetModalState();
      setOpenModal(type);
    },
    [resetModalState]
  );

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

  const toggleLineExpand = (statusEntityId: string) => setExpandedLine(prev => (prev === statusEntityId ? null : statusEntityId));

  const handleTransitToggle = (enabledEntityId: string) => {
    callService?.({ domain: 'input_boolean', service: 'toggle', target: { entity_id: enabledEntityId } });
  };

  const handleTransitRefresh = async () => {
    if (!callService || isTransitRefreshing) return;
    setIsTransitRefreshing(true);
    try {
      await callService({ domain: 'input_button', service: 'press', target: { entity_id: TRANSIT_REFRESH_BUTTON } });
    } finally {
      setTimeout(() => setIsTransitRefreshing(false), 2000);
    }
  };

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
      const { entityId: actualEntityId, entity } = resolvePreferredMediaPlayer(entities, speaker.id);
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
      const groupMembers: string[] = Array.isArray(rawGroup) ? (rawGroup as string[]) : [actualEntityId];
      // Ensure groupMembers is not empty - if it is, treat as solo speaker
      const actualGroupMembers = groupMembers.length > 0 ? groupMembers : [actualEntityId];
      const groupKey = [...actualGroupMembers].sort().join(','); // Create unique key for group

      // Skip if we've already processed this group
      if (seenGroups.has(groupKey)) return;

      // Check if this speaker is the coordinator/master (first in group_members)
      // Solo speakers (groupSize === 1) are always coordinators of their own group
      const isSolo = actualGroupMembers.length === 1;
      const isCoordinator = actualGroupMembers[0] === actualEntityId;

      // Only add coordinators/masters - never add non-coordinator group members
      // Solo speakers are always coordinators, so they get added
      if (isSolo || isCoordinator) {
        seenGroups.add(groupKey);
        // Mark all group members as seen to avoid processing them again
        actualGroupMembers.forEach(memberId => seenSpeakerIds.add(memberId));

        playing.push({
          entityId: actualEntityId,
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

  // Find all active/playing TVs
  const playingTVs = useMemo<PlayingTV[]>(() => {
    const tvs: PlayingTV[] = [];
    const tvEntities = [
      { entityId: 'media_player.bedroom_tv', name: 'Bedroom TV' },
      { entityId: 'media_player.living_room_tv', name: 'Living Room TV' },
    ];

    tvEntities.forEach(tv => {
      const entity = entities?.[tv.entityId];
      if (!entity) return;

      const isActive = hasVisibleTvState(entity);

      if (isActive) {
        tvs.push({
          entityId: tv.entityId,
          name: tv.name,
        });
      }
    });

    return tvs.sort((a, b) => a.name.localeCompare(b.name));
  }, [entities]);

  // Get all speakers with their states, sorted alphabetically
  const allSpeakers = useMemo<SpeakerInfo[]>(() => {
    const speakers = SONOS_SPEAKERS.map(speaker => {
      const { entityId: actualEntityId, entity } = resolvePreferredMediaPlayer(entities, speaker.id);

      if (!entity) {
        return {
          entityId: actualEntityId,
          name: speaker.name,
          state: 'unavailable',
          isPlaying: false,
          groupSize: 1,
        };
      }

      const rawGroupAll = entity.attributes?.group_members;
      const groupMembers: string[] = Array.isArray(rawGroupAll) ? (rawGroupAll as string[]) : [actualEntityId];
      const actualGroupMembers = groupMembers.length > 0 ? groupMembers : [actualEntityId];
      const isPlaying = entity.state === 'playing';
      const isCoordinator = actualGroupMembers[0] === actualEntityId;

      // Only show coordinator speakers to avoid duplicates
      if (!isCoordinator && actualGroupMembers.length > 1) {
        return null;
      }

      return {
        entityId: actualEntityId,
        name: speaker.name,
        state: entity.state || 'unavailable',
        isPlaying,
        groupSize: actualGroupMembers.length,
      };
    }).filter((s): s is SpeakerInfo => s !== null);

    // Sort alphabetically by name
    return speakers.sort((a, b) => a.name.localeCompare(b.name));
  }, [entities]);

  const outOfSyncSpeakerNames = useMemo(
    () =>
      SONOS_SPEAKERS.filter(speaker => isMediaPlayerOutOfSync(entities, speaker.id))
        .map(speaker => speaker.name)
        .sort((a, b) => a.localeCompare(b)),
    [entities]
  );

  const weatherEntityId = useMemo(() => {
    const found = Object.keys(entities || {}).find(k => k.startsWith('weather.'));
    return found || null;
  }, [entities]);

  const weatherConditionIcon = useMemo(() => {
    if (!weatherEntityId || !entities?.[weatherEntityId]) return 'mdi:weather-partly-cloudy';
    const condition = entities[weatherEntityId]?.state;
    return getWeatherConditionIcon(typeof condition === 'string' ? condition : undefined);
  }, [weatherEntityId, entities]);

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

  // Use standardized swipe-to-close hook
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestCloseQuickAccess);

  return (
    <>
      <div className='quick-access'>
        <button className='qa-button' onClick={() => openQuickAccess('intercom')} title='Access'>
          <Icon icon='mdi:door' />
        </button>
        <button className='qa-button' onClick={() => openQuickAccess('media')} title='Media controls'>
          <Icon icon='mdi:cast-audio' />
          {hasPlayingMedia && <span className='qa-badge'>{playingSpeakers.length + playingTVs.length}</span>}
        </button>
        <button className='qa-button' onClick={() => openQuickAccess('transit')} title='Transit'>
          <Icon icon='mdi:train' />
          {hasTransitAlert && <span className='qa-badge qa-badge--alert' />}
        </button>
        <button
          className='qa-button'
          onClick={() => openQuickAccess('weather')}
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
                {openModal === 'media' && outOfSyncSpeakerNames.length > 0 && (
                  <div
                    className='qa-media-sync-indicator'
                    title={`Music Assistant and Sonos disagree for: ${outOfSyncSpeakerNames.join(', ')}`}
                    aria-label='Music Assistant and Sonos are out of sync'
                  >
                    <Icon icon='mdi:information-outline' />
                  </div>
                )}
                {openModal === 'media' && !selectedSpeakerForQuickStart && !showSpeakerSelector && (
                  <button className='qa-add-speaker-icon-btn' onClick={() => setShowSpeakerSelector(true)} title='Start music on a speaker'>
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
              {openModal === 'intercom' && <IntercomCard entities={entities} callService={callService} />}
              {openModal === 'media' && (
                <div className='qa-media-content'>
                  {selectedSpeakerForQuickStart ? (
                    <div className='qa-media-section'>
                      <button className='qa-back-button' onClick={() => setSelectedSpeakerForQuickStart(null)}>
                        <Icon icon='mdi:arrow-left' />
                        <span>Back</span>
                      </button>
                      <SonosPlayer
                        entityId={selectedSpeakerForQuickStart}
                        entities={entities}
                        hassUrl={hassUrl}
                        callService={callService}
                      />
                    </div>
                  ) : showSpeakerSelector || !hasPlayingMedia ? (
                    // Show speaker list when "add speaker" button is clicked OR when nothing is playing
                    <div className='qa-media-section'>
                      <div className='qa-speaker-list'>
                        {allSpeakers.map(speaker => (
                          <button
                            key={speaker.entityId}
                            className='qa-speaker-line'
                            onClick={() => speaker.state !== 'unavailable' && setSelectedSpeakerForQuickStart(speaker.entityId)}
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
                    // Show playing speakers and TVs when something is playing
                    <div className='qa-media-section'>
                      <div className='qa-media-list'>
                        {playingSpeakers.map(speaker => (
                          <div key={speaker.entityId} className='qa-media-item'>
                            <div className='qa-media-identity'>
                              <div className='qa-media-label'>
                                <Icon icon='mdi:speaker' />
                                <span className='qa-media-label-text'>{speaker.name}</span>
                              </div>
                              {speaker.groupSize > 1 && (
                                <span className='qa-media-badge qa-media-badge--group'>{speaker.groupSize} speakers</span>
                              )}
                            </div>
                            <SonosPlayer entityId={speaker.entityId} entities={entities} hassUrl={hassUrl} callService={callService} />
                          </div>
                        ))}
                        {playingTVs.map(tv => {
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
                                  showTvLift={true}
                                  tvLiftSelectEntityId='input_select.bedroom_tv_lift_position'
                                  appleRemoteEntityId='remote.bedroom_apple_tv'
                                  appleMediaPlayerEntityId='media_player.bedroom_apple_tv'
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
                                  wirelessUsbCEntityId='media_player.bedroom_sony_tv'
                                />
                              )}
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
                                  onClick={() => toggleLineExpand(line.statusEntityId)}
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
                                        handleTransitToggle(line.enabledEntityId);
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
                                                  </span>
                                                  <span className='info-transit-dep-time'>
                                                    {d.cancelled ? (
                                                      <s>{d.scheduled_time}</s>
                                                    ) : (
                                                      <>
                                                        {d.time}
                                                        {d.delay_min > 0 && <span className='info-transit-dep-delay'>+{d.delay_min}m</span>}
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
                  <QuickWeatherCard entityId={weatherEntityId} entities={entities} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
