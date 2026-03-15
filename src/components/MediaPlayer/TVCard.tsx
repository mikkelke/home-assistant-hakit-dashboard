import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { attrNum, attrStr } from '../../types';
import { AppleTVRemote } from '../Remote';
import './TVCard.css';
import '../Cover/CoverCard.css';

interface TVCardProps {
  entityId: string;
  entities: HassEntities;
  hassUrl: string | null;
  callService: CallServiceFunction | undefined;
  showTvLift?: boolean;
  tvLiftSelectEntityId?: string; // For living room: select.living_room_tv_lift_position
  appleRemoteEntityId?: string; // For Apple TV remote popup, e.g., "remote.bedroom_apple_tv"
  appleMediaPlayerEntityId?: string; // For volume control via Apple TV media_player
  chromecastEntityId?: string; // For Chromecast, e.g., "media_player.living_room_cast"
  wirelessUsbCEntityId?: string; // For Wireless USB-C, e.g., "media_player.bedroom_sony_tv"
}

export function TVCard({
  entityId,
  entities,
  hassUrl: _hassUrl,
  callService,
  showTvLift = false,
  tvLiftSelectEntityId,
  appleRemoteEntityId,
  appleMediaPlayerEntityId,
  chromecastEntityId,
  wirelessUsbCEntityId,
}: TVCardProps) {
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [volumeUi, setVolumeUi] = useState(0);
  const [showTvLiftControls, setShowTvLiftControls] = useState(false);
  const [showAppleRemote, setShowAppleRemote] = useState(false);
  const [imageError, setImageError] = useState(false);
  // Track last committed volume to prevent UI flicker
  const lastCommittedVolumeRef = useRef<{ value: number; timestamp: number } | null>(null);

  // Check if Apple TV remote entity exists
  const hasAppleRemote = appleRemoteEntityId && entities?.[appleRemoteEntityId];

  // Get TV lift select entity (for living room or bedroom)
  const tvLiftSelect = tvLiftSelectEntityId ? entities?.[tvLiftSelectEntityId] : null;
  const tvLiftPosition = attrStr(tvLiftSelect?.state);
  const rawTvLiftOptions = tvLiftSelect?.attributes?.options;
  const allTvLiftOptions: string[] = Array.isArray(rawTvLiftOptions) ? (rawTvLiftOptions as string[]) : [];
  // Determine domain based on entity ID prefix
  const tvLiftDomain = typeof tvLiftSelectEntityId === 'string' && tvLiftSelectEntityId.startsWith('input_select.') ? 'input_select' : 'select';
  // Filter out "Temporary" and "unknown" (case-insensitive) for bedroom TV
  const isBedroomTv = entityId === 'media_player.bedroom_tv' || tvLiftSelectEntityId === 'input_select.bedroom_tv_lift_position';
  const isLivingRoomTv = entityId === 'media_player.living_room_tv' || tvLiftSelectEntityId === 'select.living_room_tv_lift_position';

  // Sort living room TV lift options: Living room, Wall, Kitchen
  const livingRoomOrder = ['Living room', 'Wall', 'Kitchen'];
  const sortLivingRoomOptions = (options: string[]): string[] => {
    const sorted: string[] = [];
    const remaining = [...options];

    // Add options in the desired order
    livingRoomOrder.forEach(orderedOption => {
      const found = remaining.find(opt => opt === orderedOption);
      if (found) {
        sorted.push(found);
        remaining.splice(remaining.indexOf(found), 1);
      }
    });

    // Add any remaining options that weren't in the order list
    return [...sorted, ...remaining];
  };

  const tvLiftOptions = isBedroomTv
    ? allTvLiftOptions.filter(option => {
        const optionLower = option.toLowerCase().trim();
        return optionLower !== 'temporary' && optionLower !== 'unknown';
      })
    : isLivingRoomTv
      ? sortLivingRoomOptions(allTvLiftOptions)
      : allTvLiftOptions;

  const tv = entities?.[entityId];
  const state = tv?.state;
  const attributes = tv?.attributes ?? {};
  const tvMediaTitle = attrStr(attributes.media_title);
  const volume = Math.round(attrNum(attributes.volume_level, 0) * 100);
  const isMuted = attributes.is_volume_muted;
  const activeChild = attrStr(attributes.active_child);
  const isOn = state === 'on' || state === 'playing' || state === 'paused' || state === 'idle';

  const highLevelSources: Array<{ name: string; entityId: string | null }> = [];
  if (appleMediaPlayerEntityId) highLevelSources.push({ name: 'Apple TV', entityId: appleMediaPlayerEntityId });
  if (chromecastEntityId) highLevelSources.push({ name: 'Chromecast', entityId: chromecastEntityId });
  if (wirelessUsbCEntityId) highLevelSources.push({ name: 'Wireless USB-C', entityId: wirelessUsbCEntityId });

  const appleTvEntity = appleMediaPlayerEntityId ? entities?.[appleMediaPlayerEntityId] : null;
  const appleTvActive =
    appleTvEntity && appleTvEntity.state !== 'off' && appleTvEntity.state !== 'unavailable' && appleTvEntity.state !== 'unknown';

  const genericTvTitles = ['tv on', 'tv off', 'hdmi 1', 'hdmi 2', 'hdmi 3', 'hdmi 4', 'hdmi', 'tv', ''];
  const mainTvHasNoMeaningfulMedia = !tvMediaTitle || genericTvTitles.includes(tvMediaTitle.toLowerCase().trim());

  let currentSource = '';
  if (activeChild === appleMediaPlayerEntityId) currentSource = 'Apple TV';
  else if (activeChild === chromecastEntityId) currentSource = 'Chromecast';
  else if (activeChild === wirelessUsbCEntityId) currentSource = 'Wireless USB-C';
  else if (appleMediaPlayerEntityId && appleTvActive) {
    if (activeChild !== chromecastEntityId && activeChild !== wirelessUsbCEntityId) currentSource = 'Apple TV';
  }

  const useAppleTvForDisplay =
    appleTvEntity && appleTvActive && (currentSource === 'Apple TV' || mainTvHasNoMeaningfulMedia || isBedroomTv);
  const displayTv = useAppleTvForDisplay ? appleTvEntity : tv;
  const displayAttrs = displayTv?.attributes ?? {};
  const displayMediaTitle = attrStr(displayAttrs.media_title);
  const displayMediaArtist = attrStr(displayAttrs.media_artist);
  const displayMediaPicture = displayAttrs.entity_picture;
  const displayMediaPictureLocal = displayAttrs.entity_picture_local;
  const displayState = displayTv?.state ?? state;

  const pickImage = () => {
    const candidate = displayMediaPictureLocal || displayMediaPicture;
    const url = typeof candidate === 'string' ? candidate : '';
    if (url) return url.startsWith('http') ? url : `${_hassUrl}${url}`;
    return null;
  };
  const imageUrl = tv ? pickImage() : null;

  useEffect(() => {
    const id = setTimeout(() => setImageError(false), 0);
    return () => clearTimeout(id);
  }, [imageUrl]);

  const isSameOrigin = (url: string | null | undefined) => {
    if (!url || typeof window === 'undefined') return false;
    try {
      const u = new URL(url, window.location.href);
      return u.origin === window.location.origin;
    } catch {
      return false;
    }
  };

  const safeImage = imageUrl && isSameOrigin(imageUrl) ? imageUrl : undefined;
  const showImage = safeImage && !imageError;

  useEffect(() => {
    const lastCommitted = lastCommittedVolumeRef.current;
    const timeSinceCommit = lastCommitted ? Date.now() - lastCommitted.timestamp : Infinity;

    // Only sync from entity if:
    // 1. No recent commit (more than 500ms ago), OR
    // 2. Entity value matches what we committed (update confirmed), OR
    // 3. Entity value is different from what we committed (external change)
    const shouldSync =
      !lastCommitted ||
      timeSinceCommit > 500 ||
      volume === lastCommitted.value ||
      (lastCommitted && Math.abs(volume - lastCommitted.value) > 2);

    let id: ReturnType<typeof setTimeout> | undefined;
    if (shouldSync) {
      id = setTimeout(() => {
        setVolumeUi(volume);
        if (timeSinceCommit > 500 || volume === lastCommitted?.value) {
          lastCommittedVolumeRef.current = null;
        }
      }, 0);
    }
    return () => {
      if (id) clearTimeout(id);
    };
  }, [volume]);

  if (!tv) return null;

  const getSourceIcon = (sourceName: string) => {
    if (sourceName === 'Apple TV') return 'mdi:apple';
    if (sourceName === 'Chromecast') return 'mdi:cast';
    if (sourceName === 'Wireless USB-C') return 'mdi:usb';
    return 'mdi:television';
  };

  const handlePlayPause = () => {
    if (!callService) return;
    // When showing Apple TV as current source, control the Apple TV entity
    const targetId = currentSource === 'Apple TV' && appleMediaPlayerEntityId ? appleMediaPlayerEntityId : entityId;
    if (displayState === 'playing') {
      callService({
        domain: 'media_player',
        service: 'media_pause',
        target: { entity_id: targetId },
      });
    } else if (displayState === 'paused') {
      callService({
        domain: 'media_player',
        service: 'media_play',
        target: { entity_id: targetId },
      });
    }
  };

  const handlePowerToggle = () => {
    if (!callService) return;
    if (isOn) {
      callService({
        domain: 'media_player',
        service: 'turn_off',
        target: { entity_id: entityId },
      });
    } else {
      callService({
        domain: 'media_player',
        service: 'turn_on',
        target: { entity_id: entityId },
      });

      // If turning on bedroom TV, also turn on bedroom Apple TV
      if (entityId === 'media_player.bedroom_tv') {
        const bedroomAppleTvId = 'media_player.bedroom_apple_tv';
        if (entities?.[bedroomAppleTvId]) {
          callService({
            domain: 'media_player',
            service: 'turn_on',
            target: { entity_id: bedroomAppleTvId },
          });
        }
      }
    }
  };

  const handleVolumeChange = (newVolume: number) => {
    if (!callService) return;
    // Track the committed value to prevent UI flicker
    lastCommittedVolumeRef.current = { value: newVolume, timestamp: Date.now() };
    callService({
      domain: 'media_player',
      service: 'volume_set',
      target: { entity_id: entityId },
      serviceData: { volume_level: newVolume / 100 },
    });
  };

  const handleMuteToggle = () => {
    if (!callService) return;
    callService({
      domain: 'media_player',
      service: 'volume_mute',
      target: { entity_id: entityId },
      serviceData: { is_volume_muted: !isMuted },
    });
  };

  const clampVolume = (v: number) => Math.max(0, Math.min(100, v));

  const handleVolumeStep = (delta: number) => {
    const next = clampVolume(volumeUi + delta);
    setVolumeUi(next);
    handleVolumeChange(next);
  };

  const handleSelectSource = (sourceName: string) => {
    if (!callService) return;

    // Find the entity ID for the selected high-level source
    const selectedSource = highLevelSources.find(s => s.name === sourceName);
    if (selectedSource && selectedSource.entityId) {
      // Turn on the corresponding media player entity to switch to that source
      callService({
        domain: 'media_player',
        service: 'turn_on',
        target: { entity_id: selectedSource.entityId },
      });
    }
    setShowSourcePicker(false);
  };

  // Helper functions for bedroom TV lift controls
  const turnOnBedroomTvs = () => {
    if (!callService || entityId !== 'media_player.bedroom_tv') return;
    const bedroomTvId = 'media_player.bedroom_tv';
    const bedroomAppleTvId = 'media_player.bedroom_apple_tv';

    if (entities?.[bedroomTvId]) {
      callService({
        domain: 'media_player',
        service: 'turn_on',
        target: { entity_id: bedroomTvId },
      });
    }
    if (entities?.[bedroomAppleTvId]) {
      callService({
        domain: 'media_player',
        service: 'turn_on',
        target: { entity_id: bedroomAppleTvId },
      });
    }
  };

  const turnOffBedroomTvs = () => {
    if (!callService || entityId !== 'media_player.bedroom_tv') return;
    const bedroomTvId = 'media_player.bedroom_tv';
    const bedroomAppleTvId = 'media_player.bedroom_apple_tv';

    if (entities?.[bedroomTvId]) {
      callService({
        domain: 'media_player',
        service: 'turn_off',
        target: { entity_id: bedroomTvId },
      });
    }
    if (entities?.[bedroomAppleTvId]) {
      callService({
        domain: 'media_player',
        service: 'turn_off',
        target: { entity_id: bedroomAppleTvId },
      });
    }
  };

  return (
    <div className='tv-card'>
      {/* TV Status Row */}
      <div className='tv-status-row'>
        <div className='tv-icon-container'>
          {showImage ? (
            <img src={safeImage || ''} alt='' onError={() => setImageError(true)} className='tv-artwork' />
          ) : (
            <Icon icon='mdi:television' className='tv-icon' />
          )}
        </div>
        <div className='tv-info'>
          <span className='tv-title'>{displayMediaTitle || (useAppleTvForDisplay ? 'Apple TV' : isOn ? 'TV On' : 'TV Off')}</span>
          {displayMediaArtist && <span className='tv-source'>{displayMediaArtist}</span>}
        </div>
        {hasAppleRemote && (
          <button className='tv-remote-btn' onClick={() => setShowAppleRemote(true)} title='Apple TV Remote'>
            <Icon icon='mdi:remote' />
          </button>
        )}
        {(displayState === 'playing' || displayState === 'paused') && (
          <button
            className={`tv-play-pause-btn ${displayState === 'playing' ? 'playing' : 'paused'}`}
            onClick={handlePlayPause}
            title={displayState === 'playing' ? 'Pause' : 'Play'}
          >
            <Icon icon={displayState === 'playing' ? 'mdi:pause' : 'mdi:play'} />
          </button>
        )}
        <button className={`tv-power-btn ${isOn ? 'on' : 'off'}`} onClick={handlePowerToggle}>
          <Icon icon={isOn ? 'mdi:power' : 'mdi:power-off'} />
        </button>
      </div>

      {/* Volume Row - Show when playing/paused */}
      {(displayState === 'playing' || displayState === 'paused') && (
        <div className='tv-volume-row'>
          <button className='tv-btn-icon' onClick={handleMuteToggle}>
            <Icon icon={isMuted ? 'mdi:volume-off' : volume > 50 ? 'mdi:volume-high' : 'mdi:volume-medium'} />
          </button>
          <div className='tv-volume-buttons'>
            <button className='tv-btn-sm' onClick={() => handleVolumeStep(-5)} title='Volume down'>
              <Icon icon='mdi:minus' />
            </button>
            <span className='tv-volume-value'>{volumeUi}%</span>
            <button className='tv-btn-sm' onClick={() => handleVolumeStep(5)} title='Volume up'>
              <Icon icon='mdi:plus' />
            </button>
          </div>
        </div>
      )}

      {/* Source Picker - High-level sources only */}
      {isOn && highLevelSources.length > 0 && (
        <>
          <button
            className={`tv-source-toggle ${showSourcePicker ? 'open' : ''} ${currentSource ? 'active' : ''}`}
            onClick={() => setShowSourcePicker(!showSourcePicker)}
          >
            <Icon icon={currentSource ? getSourceIcon(currentSource) : 'mdi:input-hdmi'} />
            <span className='tv-source-toggle-label'>{currentSource || 'Select source'}</span>
            <Icon icon={showSourcePicker ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
          </button>

          {showSourcePicker && (
            <div className='tv-source-panel'>
              <span className='source-section-label'>Inputs</span>
              {highLevelSources.map(source => (
                <button
                  key={source.name}
                  className={`tv-source-item ${source.name === currentSource ? 'active' : ''}`}
                  onClick={() => handleSelectSource(source.name)}
                >
                  <Icon icon={getSourceIcon(source.name)} />
                  <span>{source.name}</span>
                  {source.name === currentSource && <Icon icon='mdi:check' className='check' />}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* TV Lift Controls */}
      {showTvLift && callService && (
        <>
          <div className='tv-lift-section'>
            <div className='tv-lift-header'>
              <div className='tv-lift-title'>
                <Icon icon='mdi:television-classic' />
                <span>TV Lift</span>
              </div>
              {tvLiftSelectEntityId ? (
                // Select-based lift (Living Room or Bedroom)
                <div className={`tv-lift-position-buttons ${isBedroomTv ? 'bedroom-buttons' : ''}`}>
                  {tvLiftOptions.map(option => (
                    <button
                      key={option}
                      className={
                        isBedroomTv
                          ? `cover-quick-btn ${tvLiftPosition === option ? 'active' : ''}`
                          : `tv-lift-position-btn ${tvLiftPosition === option ? 'active' : ''}`
                      }
                      onClick={() =>
                        callService({
                          domain: tvLiftDomain,
                          service: 'select_option',
                          target: { entity_id: tvLiftSelectEntityId },
                          serviceData: { option },
                        })
                      }
                    >
                      {option === 'Wall' && <Icon icon='mdi:wall' />}
                      {option === 'Kitchen' && <Icon icon='mdi:chef-hat' />}
                      {option === 'Living room' && <Icon icon='mdi:sofa-single' />}
                      {option === 'Down' && <Icon icon='mdi:arrow-down-bold' />}
                      {option === 'Up' && <Icon icon='mdi:arrow-up-bold' />}
                      {option === 'Temporary' && <Icon icon='mdi:gesture-tap-button' />}
                      {!isBedroomTv && <span>{option}</span>}
                    </button>
                  ))}
                </div>
              ) : (
                // Bedroom: Script-based lift
                <>
                  <div className='tv-lift-quick'>
                    <button
                      className='tv-lift-quick-btn'
                      onClick={() => {
                        callService({
                          domain: 'script',
                          service: 'bedroom_tv_lift_move_up',
                        });
                        turnOffBedroomTvs();
                      }}
                    >
                      <Icon icon='mdi:arrow-up-bold' />
                      <span>Up</span>
                    </button>
                    <button
                      className='tv-lift-quick-btn'
                      onClick={() => {
                        callService({
                          domain: 'script',
                          service: 'bedroom_tv_lift_position_down',
                        });
                        turnOnBedroomTvs();
                      }}
                    >
                      <Icon icon='mdi:arrow-down-bold' />
                      <span>Down</span>
                    </button>
                  </div>
                  <button
                    className='tv-lift-toggle'
                    onClick={() => setShowTvLiftControls(prev => !prev)}
                    aria-expanded={showTvLiftControls}
                  >
                    <Icon icon={showTvLiftControls ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
                  </button>
                </>
              )}
            </div>

            {/* Bedroom: Expanded controls */}
            {!tvLiftSelectEntityId && showTvLiftControls && (
              <div className='tv-lift-body'>
                <div className='tv-lift-row'>
                  <button
                    className='tv-lift-btn'
                    onClick={() =>
                      callService({
                        domain: 'script',
                        service: 'bedroom_tv_lift_move_up',
                      })
                    }
                  >
                    <Icon icon='mdi:arrow-up-bold' />
                    <span className='primary'>Up</span>
                    <span className='secondary'>TV Lift</span>
                  </button>
                  <button
                    className='tv-lift-btn'
                    onClick={() =>
                      callService({
                        domain: 'script',
                        service: 'bedroom_tv_lift_stop',
                      })
                    }
                  >
                    <Icon icon='mdi:stop' />
                    <span className='primary'>Stop</span>
                    <span className='secondary'>TV Lift</span>
                  </button>
                  <button
                    className='tv-lift-btn'
                    onClick={() =>
                      callService({
                        domain: 'script',
                        service: 'bedroom_tv_lift_position_down',
                      })
                    }
                  >
                    <Icon icon='mdi:arrow-down-bold' />
                    <span className='primary'>Down</span>
                    <span className='secondary'>TV Lift</span>
                  </button>
                </div>

                <div className='tv-lift-row'>
                  <button
                    className='tv-lift-btn'
                    onClick={() =>
                      callService({
                        domain: 'script',
                        service: 'bedroom_tv_lift_position_up',
                      })
                    }
                  >
                    <Icon icon='mdi:arrow-top-right' />
                    <span className='primary'>Set Up</span>
                    <span className='secondary'>Position</span>
                  </button>
                  <button
                    className='tv-lift-btn'
                    onClick={() =>
                      callService({
                        domain: 'script',
                        service: 'bedroom_tv_lift_position_down',
                      })
                    }
                  >
                    <Icon icon='mdi:arrow-bottom-left' />
                    <span className='primary'>Set Down</span>
                    <span className='secondary'>Position</span>
                  </button>
                  <button
                    className='tv-lift-btn'
                    onClick={() =>
                      callService({
                        domain: 'script',
                        service: 'bedroom_tv_lift_position_temporary',
                      })
                    }
                  >
                    <Icon icon='mdi:gesture-tap-button' />
                    <span className='primary'>Temp Pos.</span>
                    <span className='secondary'>Quick Set</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Apple TV Remote Modal */}
      {showAppleRemote && hasAppleRemote && callService && (
        <AppleTVRemote
          remoteEntityId={appleRemoteEntityId!}
          mediaPlayerEntityId={appleMediaPlayerEntityId}
          callService={callService}
          onClose={() => setShowAppleRemote(false)}
        />
      )}
    </div>
  );
}
