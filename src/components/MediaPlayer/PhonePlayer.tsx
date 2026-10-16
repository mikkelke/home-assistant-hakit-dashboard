import { useState } from 'react';
import { Icon } from '@iconify/react';
import type { CallServiceFunction, HassEntities } from '../../types';
import { faceOf, NO_RADIOS, playsRadio } from '../../music/nowPlaying';
import { useRadios } from '../../music/useLibrary';
import { Art } from './MusicParts';
import { SeekBar } from './SeekBar';
import { VolumeStrip } from './VolumeStrip';
import { useSeek } from './useSeek';
import './SonosPlayer.css';

/** What the viewer's phone is called wherever it is listed. */
export const PHONE_PLAYER_NAME = 'My phone';

/** A speaker the phone's queue can move to. */
export interface MoveTarget {
  entityId: string;
  name: string;
  /** Speakers in its group; more than one when it leads a group. */
  groupSize: number;
}

interface PhoneAttributes {
  media_title?: string;
  media_artist?: string;
  media_album_name?: string;
  media_content_id?: string;
  media_duration?: number;
  media_position?: number;
  media_position_updated_at?: string;
  entity_picture?: string;
  entity_picture_local?: string;
  volume_level?: number;
  is_volume_muted?: boolean;
}

interface PhonePlayerProps {
  entityId: string;
  entities: HassEntities;
  hassUrl: string | null;
  callService: CallServiceFunction | undefined;
  targets: readonly MoveTarget[];
  /** Reports a control the viewer used, for usage counts. */
  onUiTap?: (action: string, detail?: string) => void;
}

/** The player's artwork, when it is served from this page's origin or Home Assistant's. */
function artworkOf(attributes: PhoneAttributes, hassUrl: string | null): string | undefined {
  const picture = attributes.entity_picture_local || attributes.entity_picture;
  if (!picture) return undefined;
  const url = picture.startsWith('http') ? picture : `${hassUrl ?? ''}${picture}`;
  try {
    const origin = new URL(url, window.location.href).origin;
    const hassOrigin = hassUrl ? new URL(hassUrl, window.location.href).origin : null;
    return origin === window.location.origin || origin === hassOrigin ? url : undefined;
  } catch {
    return undefined;
  }
}

function quietWord(state: string): string {
  return state === 'playing' ? 'Playing' : state === 'paused' ? 'Paused' : 'Quiet';
}

/** The viewer's own phone as a Music Assistant player: what plays on it, its transport, and a way to move the queue to a
 * speaker. A phone has no speaker group and no source sheet. */
export function PhonePlayer({ entityId, entities, hassUrl, callService, targets, onUiTap }: PhonePlayerProps) {
  const [moveOpen, setMoveOpen] = useState(false);
  const [brokenArt, setBrokenArt] = useState<string | null>(null);
  const [pendingVolume, setPendingVolume] = useState<{ value: number; base: number } | null>(null);
  const player = entities[entityId];
  const state = player?.state ?? 'unavailable';
  const attributes = (player?.attributes ?? {}) as PhoneAttributes;
  const contentId = attributes.media_content_id || '';
  const unavailable = state === 'unavailable';
  const radios = useRadios(!unavailable && playsRadio(contentId));
  const picture = artworkOf(attributes, hassUrl);
  const nowPlaying = faceOf(
    { state, title: attributes.media_title || '', artist: attributes.media_artist || '', contentId, hasPicture: Boolean(picture) },
    radios.status === 'ready' ? radios.data : NO_RADIOS
  );

  const { shownState, bar: seekBar } = useSeek({
    entityId,
    state,
    attributes,
    seekable: !playsRadio(contentId),
    onScreen: true,
    callService,
  });
  const isPlaying = shownState === 'playing';
  const quiet = unavailable || nowPlaying.quiet;
  const title = nowPlaying.stationName || (quiet ? PHONE_PLAYER_NAME : attributes.media_title) || PHONE_PLAYER_NAME;
  const subtitle = unavailable
    ? 'Unavailable'
    : quiet
      ? quietWord(shownState)
      : attributes.media_artist || attributes.media_album_name || '';
  const controllable = !unavailable && (contentId !== '' || isPlaying || state === 'paused');

  const volume = Math.round((attributes.volume_level ?? 0) * 100);
  if (pendingVolume && pendingVolume.base !== volume) setPendingVolume(null);
  const shownVolume = pendingVolume && pendingVolume.base === volume ? pendingVolume.value : volume;
  const canMute = typeof attributes.is_volume_muted === 'boolean';

  const call = (domain: string, service: string, serviceData?: Record<string, unknown>) =>
    callService?.({ domain, service, target: { entity_id: entityId }, serviceData });

  const moveTo = (target: MoveTarget) => {
    if (!callService) return;
    onUiTap?.('move_to_speaker', target.entityId);
    callService({
      domain: 'music_assistant',
      service: 'transfer_queue',
      target: { entity_id: target.entityId },
      serviceData: { source_player: entityId, auto_play: true },
    });
    setMoveOpen(false);
  };

  return (
    <div className='sonos-card is-embedded'>
      <div className='sonos-now'>
        <div className='sonos-art'>
          {picture && brokenArt !== picture ? (
            <img src={picture} alt='' onError={() => setBrokenArt(picture)} />
          ) : (
            <Art
              imageId={nowPlaying.radio?.imageId ?? null}
              fallback={
                <div className='sonos-art-placeholder'>
                  <Icon icon={quiet ? 'mdi:cellphone' : 'mdi:music'} aria-hidden='true' />
                </div>
              }
            />
          )}
        </div>
        <div className='sonos-track'>
          <div className='sonos-track-title'>{title}</div>
          {subtitle && subtitle !== title && <div className='sonos-track-sub'>{subtitle}</div>}
        </div>
      </div>

      {controllable && (
        <div className='sonos-transport'>
          <button
            type='button'
            className='sonos-tbtn'
            onClick={() => {
              onUiTap?.('skip', 'prev');
              call('media_player', 'media_previous_track');
            }}
            aria-label='Previous track'
          >
            <Icon icon='mdi:skip-previous' aria-hidden='true' />
          </button>
          <button
            type='button'
            className='sonos-tbtn sonos-tbtn--main'
            onClick={() => {
              onUiTap?.('play_pause', entityId);
              call('media_player', isPlaying ? 'media_pause' : 'media_play');
            }}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            <Icon icon={isPlaying ? 'mdi:pause' : 'mdi:play'} aria-hidden='true' />
          </button>
          <button
            type='button'
            className='sonos-tbtn'
            onClick={() => {
              onUiTap?.('skip', 'next');
              call('media_player', 'media_next_track');
            }}
            aria-label='Next track'
          >
            <Icon icon='mdi:skip-next' aria-hidden='true' />
          </button>
        </div>
      )}

      {seekBar && <SeekBar {...seekBar} />}

      {typeof attributes.volume_level === 'number' && (
        <div className='sonos-volume'>
          {canMute ? (
            <button
              type='button'
              className='sonos-mute'
              onClick={() => {
                onUiTap?.('mute', entityId);
                call('media_player', 'volume_mute', { is_volume_muted: !attributes.is_volume_muted });
              }}
              aria-label={attributes.is_volume_muted ? 'Unmute' : 'Mute'}
            >
              <Icon icon={attributes.is_volume_muted ? 'mdi:volume-off' : 'mdi:volume-medium'} aria-hidden='true' />
            </button>
          ) : (
            <span className='sonos-mute'>
              <Icon icon='mdi:volume-medium' aria-hidden='true' />
            </span>
          )}
          <VolumeStrip
            value={shownVolume}
            muted={Boolean(attributes.is_volume_muted)}
            label='Volume'
            onCommit={next => {
              setPendingVolume({ value: next, base: volume });
              onUiTap?.('volume', entityId);
              call('media_player', 'volume_set', { volume_level: next / 100 });
            }}
          />
        </div>
      )}

      {controllable && targets.length > 0 && (
        <div className='sonos-doors'>
          <button
            type='button'
            className={`sonos-ibtn ${moveOpen ? 'is-open' : ''}`}
            onClick={() => setMoveOpen(open => !open)}
            aria-label='Move to speaker'
            aria-expanded={moveOpen}
            title='Move to speaker'
          >
            <Icon icon='mdi:cast-audio' aria-hidden='true' />
          </button>
        </div>
      )}

      {controllable && moveOpen && (
        <div className='sonos-rows sonos-move'>
          {targets.map(target => (
            <button key={target.entityId} type='button' className='sonos-row' onClick={() => moveTo(target)}>
              <span className='sonos-row-cover sonos-row-cover--empty'>
                <Icon icon='mdi:speaker' aria-hidden='true' />
              </span>
              <span className='sonos-row-text'>
                <span className='sonos-row-title'>{target.name}</span>
                {target.groupSize > 1 && <span className='sonos-row-sub'>{target.groupSize} speakers</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
