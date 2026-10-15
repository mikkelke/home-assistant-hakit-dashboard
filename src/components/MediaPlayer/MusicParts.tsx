import { useState, type ReactNode } from 'react';
import { Icon } from '@iconify/react';
import { maImageUrl, type Episode, type Playlist, type Podcast, type ResumeItem, type Track } from '../../music/api';
import { episodeMark, formatReleased, formatRunTime, formatTrackLength } from '../../music/view';

/** Artwork from Music Assistant; `fallback` stands in while there is none and when it will not load. */
export function Art({ imageId, className, fallback }: { imageId: string | null; className?: string; fallback: ReactNode }) {
  const [brokenId, setBrokenId] = useState<string | null>(null);
  if (!imageId || brokenId === imageId) return <>{fallback}</>;
  return (
    <img src={maImageUrl(imageId)} alt='' loading='lazy' decoding='async' className={className} onError={() => setBrokenId(imageId)} />
  );
}

function Spinner() {
  return <Icon icon='mdi:loading' className='sonos-spin' aria-hidden='true' />;
}

/** The one line a loading or failed Music Assistant request leaves in the sheet. */
export function MusicNote({ kind }: { kind: 'loading' | 'unavailable' }) {
  if (kind === 'loading') {
    return (
      <div className='sonos-note' role='status' aria-label='Loading'>
        <Spinner />
      </div>
    );
  }
  return (
    <div className='sonos-note sonos-note--down' role='status'>
      <Icon icon='mdi:cloud-off-outline' aria-hidden='true' />
      Music Assistant unavailable
    </div>
  );
}

const podcastCover = (
  <span className='sonos-row-cover sonos-row-cover--empty'>
    <Icon icon='mdi:podcast' aria-hidden='true' />
  </span>
);

export function PodcastRow({ podcast, onOpen }: { podcast: Podcast; onOpen: () => void }) {
  return (
    <button type='button' className='sonos-row' onClick={onOpen}>
      <Art imageId={podcast.imageId} className='sonos-row-cover' fallback={podcastCover} />
      <span className='sonos-row-title'>{podcast.name}</span>
      <Icon icon='mdi:chevron-right' className='sonos-row-chev' aria-hidden='true' />
    </button>
  );
}

const playlistCover = (
  <span className='sonos-row-cover sonos-row-cover--empty'>
    <Icon icon='mdi:playlist-music' aria-hidden='true' />
  </span>
);

export function PlaylistRow({ playlist, onOpen }: { playlist: Playlist; onOpen: () => void }) {
  return (
    <button type='button' className='sonos-row' onClick={onOpen}>
      <Art imageId={playlist.imageId} className='sonos-row-cover' fallback={playlistCover} />
      <span className='sonos-row-title'>{playlist.name}</span>
      <Icon icon='mdi:chevron-right' className='sonos-row-chev' aria-hidden='true' />
    </button>
  );
}

/** Starts the whole playlist; it does not wait for the track list, which Music Assistant may still be reading. */
export function PlayAllButton({ starting, onPlay }: { starting: boolean; onPlay: () => void }) {
  return (
    <button type='button' className='sonos-playall' onClick={onPlay} aria-label='Play all'>
      {starting ? <Spinner /> : <Icon icon='mdi:play' aria-hidden='true' />}
      Play all
    </button>
  );
}

const trackCover = (
  <span className='sonos-row-cover sonos-row-cover--empty'>
    <Icon icon='mdi:music-note' aria-hidden='true' />
  </span>
);

/** A track of a playlist; a tap starts the playlist at this track. */
export function TrackRow({ track, starting, onPlay }: { track: Track; starting: boolean; onPlay: () => void }) {
  return (
    <button type='button' className={`sonos-row ${track.available ? '' : 'is-unavailable'}`} onClick={onPlay} disabled={!track.available}>
      <span className='sonos-row-art'>
        <Art imageId={track.imageId} className='sonos-row-cover' fallback={trackCover} />
        {starting && (
          <span className='sonos-row-badge'>
            <Spinner />
          </span>
        )}
      </span>
      <span className='sonos-row-text'>
        <span className='sonos-row-title'>{track.name}</span>
        {track.artists && <span className='sonos-row-sub'>{track.artists}</span>}
      </span>
      {track.durationS !== null && <span className='sonos-row-time'>{formatTrackLength(track.durationS)}</span>}
    </button>
  );
}

/** An episode the viewer has started: the show's cover with a resume badge. */
export function ResumeRow({ item, starting, onPlay }: { item: ResumeItem; starting: boolean; onPlay: () => void }) {
  return (
    <button type='button' className='sonos-row' onClick={onPlay}>
      <span className='sonos-row-art'>
        <Art imageId={item.imageId} className='sonos-row-cover' fallback={podcastCover} />
        <span className='sonos-row-badge'>{starting ? <Spinner /> : <Icon icon='mdi:play' aria-hidden='true' />}</span>
      </span>
      <span className='sonos-row-title'>{item.name}</span>
    </button>
  );
}

export function EpisodeRow({ episode, starting, onPlay }: { episode: Episode; starting: boolean; onPlay: () => void }) {
  const mark = episodeMark(episode);
  const sub = [formatReleased(episode.releasedAt), episode.durationS === null ? '' : formatRunTime(episode.durationS)]
    .filter(Boolean)
    .join(' · ');
  return (
    <button type='button' className={`sonos-row ${mark?.kind === 'played' ? 'is-played' : ''}`} onClick={onPlay}>
      <span className={`sonos-row-cover sonos-row-cover--empty ${mark?.kind === 'resume' ? 'is-resume' : ''}`}>
        {starting ? <Spinner /> : <Icon icon='mdi:play' aria-hidden='true' />}
      </span>
      <span className='sonos-row-text'>
        <span className='sonos-row-title'>{episode.name}</span>
        {sub && <span className='sonos-row-sub'>{sub}</span>}
        {mark?.kind === 'resume' && mark.fraction !== null && (
          <span className='sonos-row-bar' aria-hidden='true'>
            <span style={{ width: `${Math.round(mark.fraction * 100)}%` }} />
          </span>
        )}
      </span>
      {mark?.kind === 'played' && <Icon icon='mdi:check-circle' className='sonos-row-done' aria-hidden='true' />}
    </button>
  );
}
