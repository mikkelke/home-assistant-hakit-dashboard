import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import type { HassEntities, CallServiceFunction } from '../../types';
import { attrNum, attrStr } from '../../types';
import { AppleTVRemote } from '../Remote';
import { useLocalStorageBoolean, useTouchScrollSlopGuard } from '../../hooks';
import './TVCard.css';

// TV card — same collapsed-by-default iOS shell as HeatCard/TonightCard/CoverCard. The bedroom
// TV lift is gone entirely (the lift now follows the Shelly power usage on its own); the living
// room lift is a genuine positional choice (Living room / Wall / Kitchen) and stays.

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

const getFiniteNumber = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const hasMeaningfulMediaContext = (entity: HassEntities[string] | null | undefined): boolean => {
  if (!entity) return false;

  const state = entity.state;
  if (state === 'playing' || state === 'paused') return true;
  if (state !== 'on' && state !== 'idle') return false;

  const attrs = entity.attributes ?? {};
  const mediaTitle = attrStr(attrs.media_title).trim().toLowerCase();
  const appName = attrStr(attrs.app_name).trim();
  const source = attrStr(attrs.source).trim();
  const genericTitles = new Set(['', 'tv on', 'tv off', 'hdmi 1', 'hdmi 2', 'hdmi 3', 'hdmi 4', 'hdmi', 'tv']);

  return Boolean((mediaTitle && !genericTitles.has(mediaTitle)) || appName || source);
};

const hasAvailableSourceState = (entity: HassEntities[string] | null | undefined): boolean => {
  if (!entity) return false;
  return entity.state !== 'off' && entity.state !== 'unavailable' && entity.state !== 'unknown' && entity.state !== 'standby';
};

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
  const [showAppleRemote, setShowAppleRemote] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [seekerPreview, setSeekerPreview] = useState<{ entityId: string; position: number } | null>(null);
  const [liveClockMs, setLiveClockMs] = useState(0);
  // Track last committed volume to prevent UI flicker
  const lastCommittedVolumeRef = useRef<{ value: number; timestamp: number } | null>(null);
  const headerSlop = useTouchScrollSlopGuard();
  // Collapsed by default, same toggle-row pattern as HeatCard/TonightCard/CoverCard — bedroom and
  // living room collapse independently (keyed by entity id, not by room name).
  const [collapsed, setCollapsed] = useLocalStorageBoolean(`tvcard-collapsed-${entityId.replace(/\./g, '_')}`, true);

  // Check if Apple TV remote entity exists
  const hasAppleRemote = appleRemoteEntityId && entities?.[appleRemoteEntityId];

  // Get TV lift select entity — living room only now (the bedroom lift follows the Shelly power
  // usage automatically and no longer has dashboard controls).
  const tvLiftSelect = tvLiftSelectEntityId ? entities?.[tvLiftSelectEntityId] : null;
  const tvLiftPosition = attrStr(tvLiftSelect?.state);
  const rawTvLiftOptions = tvLiftSelect?.attributes?.options;
  const allTvLiftOptions: string[] = Array.isArray(rawTvLiftOptions) ? (rawTvLiftOptions as string[]) : [];
  // Determine domain based on entity ID prefix
  const tvLiftDomain =
    typeof tvLiftSelectEntityId === 'string' && tvLiftSelectEntityId.startsWith('input_select.') ? 'input_select' : 'select';
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

  const tvLiftOptions = isLivingRoomTv ? sortLivingRoomOptions(allTvLiftOptions) : allTvLiftOptions;

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
  const appleTvActive = Boolean(appleTvEntity && hasMeaningfulMediaContext(appleTvEntity));
  const appleTvAvailable = Boolean(appleTvEntity && hasAvailableSourceState(appleTvEntity));
  const chromecastEntity = chromecastEntityId ? entities?.[chromecastEntityId] : null;
  const chromecastAvailable = Boolean(chromecastEntity && hasAvailableSourceState(chromecastEntity));
  const wirelessUsbCEntity = wirelessUsbCEntityId ? entities?.[wirelessUsbCEntityId] : null;
  const wirelessUsbCAvailable = Boolean(wirelessUsbCEntity && hasAvailableSourceState(wirelessUsbCEntity));

  const genericTvTitles = ['tv on', 'tv off', 'hdmi 1', 'hdmi 2', 'hdmi 3', 'hdmi 4', 'hdmi', 'tv', ''];
  const mainTvHasNoMeaningfulMedia = !tvMediaTitle || genericTvTitles.includes(tvMediaTitle.toLowerCase().trim());

  let currentSource = '';
  if (activeChild === appleMediaPlayerEntityId && appleTvAvailable) currentSource = 'Apple TV';
  else if (activeChild === chromecastEntityId && chromecastAvailable) currentSource = 'Chromecast';
  else if (activeChild === wirelessUsbCEntityId && wirelessUsbCAvailable) currentSource = 'Wireless USB-C';
  else if (appleMediaPlayerEntityId && appleTvActive) {
    if (activeChild !== chromecastEntityId && activeChild !== wirelessUsbCEntityId) currentSource = 'Apple TV';
  }

  const currentSourceEntityId =
    currentSource === 'Apple TV'
      ? appleMediaPlayerEntityId || null
      : currentSource === 'Chromecast'
        ? chromecastEntityId || null
        : currentSource === 'Wireless USB-C'
          ? wirelessUsbCEntityId || null
          : null;
  const currentSourceEntity = currentSourceEntityId ? entities?.[currentSourceEntityId] : null;

  const useAppleTvForDisplay = appleTvEntity && appleTvActive && (currentSource === 'Apple TV' || mainTvHasNoMeaningfulMedia);
  const displayTv = useAppleTvForDisplay ? appleTvEntity : tv;
  const displayEntityId = useAppleTvForDisplay && appleMediaPlayerEntityId ? appleMediaPlayerEntityId : entityId;
  const displayAttrs = displayTv?.attributes ?? {};
  const displayMediaTitle = attrStr(displayAttrs.media_title);
  const displayMediaArtist = attrStr(displayAttrs.media_artist);
  const displayMediaPicture = displayAttrs.entity_picture;
  const displayMediaPictureLocal = displayAttrs.entity_picture_local;
  const displayState = displayTv?.state ?? state;
  const seekCandidates = [
    currentSourceEntityId && currentSourceEntity ? { entityId: currentSourceEntityId, entity: currentSourceEntity } : null,
    { entityId: displayEntityId, entity: displayTv },
    displayEntityId !== entityId ? { entityId, entity: tv } : null,
  ].filter((candidate): candidate is { entityId: string; entity: typeof tv } => {
    return Boolean(candidate?.entityId && candidate.entity);
  });
  const seekTarget = seekCandidates.find(candidate => {
    const attrs = candidate.entity?.attributes ?? {};
    const duration = getFiniteNumber(attrs.media_duration);
    const position = getFiniteNumber(attrs.media_position);
    return duration != null && duration > 0 && position != null && position >= 0;
  });
  const seekAttrs = seekTarget?.entity?.attributes ?? {};
  const mediaDuration = getFiniteNumber(seekAttrs.media_duration) ?? 0;
  const mediaPosition = getFiniteNumber(seekAttrs.media_position);
  const mediaPositionUpdatedAt = attrStr(seekAttrs.media_position_updated_at) || undefined;
  const seekState = seekTarget?.entity?.state ?? displayState;
  const showSeeker = mediaDuration > 0 && mediaPosition != null && mediaPosition >= 0;
  const seekerPreviewPosition = seekTarget?.entityId && seekerPreview?.entityId === seekTarget.entityId ? seekerPreview.position : null;

  const getCurrentPosition = () => {
    if (seekerPreviewPosition != null) return seekerPreviewPosition;
    if (mediaPosition == null) return 0;
    if (seekState === 'playing' && mediaPositionUpdatedAt) {
      try {
        const updatedAt = new Date(mediaPositionUpdatedAt).getTime() / 1000;
        const now = liveClockMs / 1000;
        const elapsed = Math.max(0, now - updatedAt);
        return Math.min(mediaPosition + elapsed, mediaDuration);
      } catch {
        return mediaPosition;
      }
    }
    return mediaPosition;
  };

  const currentPosition = showSeeker ? getCurrentPosition() : 0;

  const formatTime = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

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

  useEffect(() => {
    if (!showSeeker || seekState !== 'playing') return;
    const id = setInterval(() => setLiveClockMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [showSeeker, seekState]);

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

  const handleSeek = (positionSeconds: number) => {
    if (!callService || !seekTarget?.entityId || mediaDuration <= 0) return;
    const clamped = Math.max(0, Math.min(mediaDuration, positionSeconds));
    callService({
      domain: 'media_player',
      service: 'media_seek',
      target: { entity_id: seekTarget.entityId },
      serviceData: { seek_position: clamped },
    });
    setSeekerPreview(null);
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

  const isPlayingOrPaused = displayState === 'playing' || displayState === 'paused';
  // Collapsed header value: media title while something is playing/paused, else a plain On/Off —
  // the fuller Apple-TV-aware fallback chain is reserved for the hero below.
  const headerValue = isPlayingOrPaused ? displayMediaTitle || (displayState === 'playing' ? 'Playing' : 'Paused') : isOn ? 'On' : 'Off';
  const headerValueTone = displayState === 'playing' ? 'tint' : 'muted';

  const heroTitle = isOn ? displayMediaTitle || (useAppleTvForDisplay ? 'Apple TV' : 'On') : 'Off';
  const heroSub = isOn ? displayMediaArtist || currentSource : '';

  const liftOptionIcon = (option: string): string => {
    if (option === 'Wall') return 'mdi:wall';
    if (option === 'Kitchen') return 'mdi:chef-hat';
    if (option === 'Living room') return 'mdi:sofa-single';
    return 'mdi:television-classic';
  };

  return (
    <div className='tv-card'>
      <div className='tv-header'>
        <div
          className='tv-header-toggle'
          onClick={() => {
            if (headerSlop.consumeBlockClick()) return;
            setCollapsed(v => !v);
          }}
          onTouchStart={headerSlop.onTouchStart}
          onTouchMove={headerSlop.onTouchMove}
          onTouchEnd={headerSlop.onTouchEnd}
          onTouchCancel={headerSlop.onTouchCancel}
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
          <span className='tv-glyph'>
            <Icon icon='mdi:television' aria-hidden='true' />
          </span>
          <span className='tv-title'>TV</span>
          <span className={`tv-word ${headerValueTone}`}>{headerValue}</span>
        </div>

        <div className='tv-header-actions'>
          {isPlayingOrPaused && (
            <button
              type='button'
              className={`tv-header-action ${displayState === 'playing' ? 'tint' : ''}`}
              onClick={e => {
                e.stopPropagation();
                handlePlayPause();
              }}
              aria-label={displayState === 'playing' ? 'Pause' : 'Play'}
            >
              <Icon icon={displayState === 'playing' ? 'mdi:pause' : 'mdi:play'} aria-hidden='true' />
            </button>
          )}
          <button
            type='button'
            className={`tv-header-action ${isOn ? 'tint' : ''}`}
            onClick={e => {
              e.stopPropagation();
              handlePowerToggle();
            }}
            aria-label={isOn ? 'Turn off' : 'Turn on'}
          >
            <Icon icon={isOn ? 'mdi:power' : 'mdi:power-off'} aria-hidden='true' />
          </button>
          <Icon icon={collapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'} aria-hidden='true' className='tv-chevron' />
        </div>
      </div>

      {!collapsed && (
        <div className='tv-content'>
          <div className='tv-hero'>
            <div className='tv-hero-art'>
              {showImage ? (
                <img src={safeImage || ''} alt='' onError={() => setImageError(true)} className='tv-hero-artwork' />
              ) : (
                <Icon icon='mdi:television' className='tv-hero-glyph' aria-hidden='true' />
              )}
            </div>
            <div className='tv-hero-text'>
              <div className='tv-hero-title'>{heroTitle}</div>
              {heroSub && <div className='tv-hero-sub'>{heroSub}</div>}
            </div>
          </div>

          {showSeeker && mediaDuration > 0 && (
            <div className='tv-seeker'>
              <span className='tv-seeker-time' aria-hidden='true'>
                {formatTime(currentPosition)}
              </span>
              <input
                type='range'
                className='tv-seeker-input'
                min={0}
                max={mediaDuration}
                step={1}
                value={seekerPreviewPosition ?? currentPosition}
                onChange={e => {
                  if (!seekTarget?.entityId) return;
                  setSeekerPreview({ entityId: seekTarget.entityId, position: Number(e.target.value) });
                }}
                onMouseUp={() => handleSeek(seekerPreviewPosition ?? currentPosition)}
                onTouchEnd={() => handleSeek(seekerPreviewPosition ?? currentPosition)}
                onBlur={() => {
                  if (seekerPreviewPosition != null) handleSeek(seekerPreviewPosition);
                }}
                disabled={!callService || !seekTarget?.entityId}
                aria-label='Seek position'
              />
              <span className='tv-seeker-time' aria-hidden='true'>
                {formatTime(mediaDuration)}
              </span>
            </div>
          )}

          {isPlayingOrPaused && (
            <div className='tv-volume-row'>
              <button type='button' className='tv-volume-mute' onClick={handleMuteToggle} aria-label={isMuted ? 'Unmute' : 'Mute'}>
                <Icon icon={isMuted ? 'mdi:volume-off' : volume > 50 ? 'mdi:volume-high' : 'mdi:volume-medium'} aria-hidden='true' />
              </button>
              <div className='tv-volume-stepper'>
                <button type='button' className='tv-volume-btn' onClick={() => handleVolumeStep(-5)} aria-label='Volume down'>
                  <Icon icon='mdi:minus' aria-hidden='true' />
                </button>
                <span className='tv-volume-value'>{volumeUi}%</span>
                <button type='button' className='tv-volume-btn' onClick={() => handleVolumeStep(5)} aria-label='Volume up'>
                  <Icon icon='mdi:plus' aria-hidden='true' />
                </button>
              </div>
            </div>
          )}

          {isOn && highLevelSources.length > 0 && (
            <>
              <button
                type='button'
                className={`tv-source-toggle ${showSourcePicker ? 'open' : ''}`}
                onClick={() => setShowSourcePicker(v => !v)}
                aria-expanded={showSourcePicker}
              >
                <span className='tv-source-toggle-icon'>
                  <Icon icon={currentSource ? getSourceIcon(currentSource) : 'mdi:source-branch'} aria-hidden='true' />
                </span>
                <span className='tv-source-toggle-label'>{currentSource || 'Select source'}</span>
                <Icon icon={showSourcePicker ? 'mdi:chevron-up' : 'mdi:chevron-down'} aria-hidden='true' />
              </button>

              {showSourcePicker && (
                <div className='tv-source-panel'>
                  {highLevelSources.map(source => (
                    <button
                      key={source.name}
                      type='button'
                      className={`tv-source-row ${source.name === currentSource ? 'active' : ''}`}
                      onClick={() => handleSelectSource(source.name)}
                    >
                      <Icon icon={getSourceIcon(source.name)} aria-hidden='true' />
                      <span>{source.name}</span>
                      {source.name === currentSource && <Icon icon='mdi:check' className='tv-source-check' aria-hidden='true' />}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {isLivingRoomTv && showTvLift && tvLiftSelectEntityId && callService && tvLiftOptions.length > 0 && (
            <div className='tv-lift-row'>
              {tvLiftOptions.map(option => (
                <button
                  key={option}
                  type='button'
                  className={`tv-lift-btn ${tvLiftPosition === option ? 'active' : ''}`}
                  onClick={() =>
                    callService({
                      domain: tvLiftDomain,
                      service: 'select_option',
                      target: { entity_id: tvLiftSelectEntityId },
                      serviceData: { option },
                    })
                  }
                >
                  <Icon icon={liftOptionIcon(option)} aria-hidden='true' />
                  <span>{option}</span>
                </button>
              ))}
            </div>
          )}

          {hasAppleRemote && (
            <div className='tv-footer'>
              <button type='button' className='tv-footer-action' onClick={() => setShowAppleRemote(true)}>
                Remote
              </button>
            </div>
          )}
        </div>
      )}

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
