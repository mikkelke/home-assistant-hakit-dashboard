import { useEffect, useState } from 'react';
import type { CallServiceFunction } from '../../types';
import type { SeekBarProps } from './SeekBar';
import { isSeekHeld, type SeekLive, type SentSeek } from './sentSeek';

/** Music Assistant skips ahead when a seek lands on the very end of a track. */
const SEEK_END_MARGIN_S = 3;

/** What a media player reports about the item it plays and how far into it the player is. */
interface SeekAttributes {
  media_content_id?: string;
  media_duration?: number;
  media_position?: number;
  media_position_updated_at?: string;
}

interface SeekOptions {
  entityId: string;
  state: string;
  attributes: SeekAttributes;
  /** False for what has no length to seek in, such as radio and line-in. */
  seekable: boolean;
  /** Whether the bar is on screen. Its clock re-renders the caller every second, so it only runs then. */
  onScreen: boolean;
  callService: CallServiceFunction | undefined;
}

interface Seek {
  /** The player's state. Music Assistant stops the old stream before it starts the new one for a seek, so while a sent seek is
   *  held a stopped player is shown in the state it had when the seek was sent. */
  shownState: string;
  /** The seek bar's props, or null when there is nothing to seek in. */
  bar: SeekBarProps | null;
}

/** The sent seek while it is still held, judged by the clock now. */
function heldNow(pendingSeek: SentSeek | null, live: SeekLive): SentSeek | null {
  return pendingSeek && isSeekHeld(pendingSeek, live, Date.now()) ? pendingSeek : null;
}

/** Where a player is now: the position it reported, moved on by the time a playing player has run since it reported it. */
function positionNow(position: number, duration: number, playing: boolean, positionUpdatedAt: string | undefined): number {
  if (playing && positionUpdatedAt) {
    try {
      const updatedAt = new Date(positionUpdatedAt).getTime() / 1000;
      const now = Date.now() / 1000;
      const elapsed = now - updatedAt;
      return Math.min(position + elapsed, duration);
    } catch {
      return position;
    }
  }
  return position;
}

/** The seek bar of one media player: the position being dragged, the seek this card sent (shown as sent until the player has
 *  settled on it, see sentSeek.ts) and the clock that moves the bar while the player plays. */
export function useSeek({ entityId, state, attributes, seekable, onScreen, callService }: SeekOptions): Seek {
  const [dragged, setDragged] = useState<number | null>(null);
  const [pendingSeek, setPendingSeek] = useState<SentSeek | null>(null);
  const [, setTick] = useState(0);

  const duration = typeof attributes.media_duration === 'number' ? attributes.media_duration : undefined;
  const position = typeof attributes.media_position === 'number' ? attributes.media_position : undefined;
  const positionUpdatedAt = attributes.media_position_updated_at;
  const item = `${entityId}|${attributes.media_content_id || ''}`;
  const heldSeek = heldNow(pendingSeek, { item, anchor: positionUpdatedAt, position });
  if (pendingSeek && !heldSeek) setPendingSeek(null);
  const shownState = heldSeek && state === 'idle' ? heldSeek.state : state;

  const showSeeker = seekable && duration !== undefined && duration > 0 && position !== undefined && position >= 0;

  useEffect(() => {
    if (!onScreen || !showSeeker || state !== 'playing') return;
    const id = setInterval(() => {
      if (!document.hidden) setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [onScreen, showSeeker, state]);

  if (!showSeeker) return { shownState, bar: null };

  // The dragged position is the seek: a release without a drag, or a second release event for the same drag, has nothing to send.
  const release = () => {
    if (!callService || dragged == null) return;
    const target = Math.max(0, Math.min(duration - SEEK_END_MARGIN_S, dragged));
    callService({
      domain: 'media_player',
      service: 'media_seek',
      target: { entity_id: entityId },
      serviceData: { seek_position: target },
    });
    setPendingSeek({ value: target, state: shownState, item, anchor: positionUpdatedAt, at: Date.now() });
    setDragged(null);
  };

  return {
    shownState,
    bar: {
      position: dragged ?? heldSeek?.value ?? positionNow(position, duration, state === 'playing', positionUpdatedAt),
      duration,
      onDrag: setDragged,
      onRelease: release,
    },
  };
}
