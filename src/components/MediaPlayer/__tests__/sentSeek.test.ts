import { describe, expect, it } from 'vitest';
import { SEEK_GIVE_UP_MS, SEEK_SETTLE_MS, isSeekHeld, type SeekLive, type SentSeek } from '../sentSeek';

const sent: SentSeek = { value: 41, state: 'playing', item: 'media_player.bedroom|spotify://track/a', anchor: 'before', at: 1_000_000 };

const live = (patch: Partial<SeekLive> = {}): SeekLive => ({ item: sent.item, anchor: 'after', position: 41, ...patch });
const held = (ms: number, patch: Partial<SeekLive> = {}) => isSeekHeld(sent, live(patch), sent.at + ms);

describe('a sent seek', () => {
  it('is held until the settle time even when the player already reports the position', () => {
    expect(held(0, { anchor: 'before', position: 143 })).toBe(true);
    expect(held(300)).toBe(true);
    expect(held(SEEK_SETTLE_MS - 1)).toBe(true);
  });

  it('is let go at the settle time once the player reports the position under a new anchor', () => {
    expect(held(SEEK_SETTLE_MS)).toBe(false);
    expect(held(SEEK_SETTLE_MS + 4000)).toBe(false);
  });

  it('is held past the settle time while the player is still on the anchor the seek was sent on', () => {
    expect(held(SEEK_SETTLE_MS + 1000, { anchor: 'before' })).toBe(true);
  });

  it('is held while the player reports a position that is not the sought one', () => {
    expect(held(SEEK_SETTLE_MS + 1000, { position: 53 })).toBe(true);
    expect(held(SEEK_SETTLE_MS + 1000, { position: undefined })).toBe(true);
  });

  it('takes a position within two seconds of the sought one for it', () => {
    expect(held(SEEK_SETTLE_MS, { position: 39 })).toBe(false);
    expect(held(SEEK_SETTLE_MS, { position: 43 })).toBe(false);
    expect(held(SEEK_SETTLE_MS, { position: 38 })).toBe(true);
    expect(held(SEEK_SETTLE_MS, { position: 44 })).toBe(true);
  });

  it('is dropped at the give-up time whatever the player reports', () => {
    expect(held(SEEK_GIVE_UP_MS - 1, { anchor: 'before' })).toBe(true);
    expect(held(SEEK_GIVE_UP_MS, { anchor: 'before' })).toBe(false);
    expect(held(SEEK_GIVE_UP_MS, { position: 53 })).toBe(false);
  });

  it('is dropped when the player moves on to another item', () => {
    expect(held(300, { item: 'media_player.bedroom|spotify://track/b', position: 0 })).toBe(false);
    expect(held(300, { item: 'media_player.kitchen|spotify://track/a' })).toBe(false);
  });

  it('is held through what Music Assistant reports while it builds the stream for a backward seek', () => {
    const reports: Array<[ms: number, anchor: string, position: number]> = [
      [310, 'seek', 41],
      [430, 'shifted', 53],
      [1450, 'rebuilt', 41],
      [2550, 'playing', 41],
    ];
    expect(reports.map(([ms, anchor, position]) => held(ms, { anchor, position }))).toEqual([true, true, true, true]);
    expect(held(SEEK_SETTLE_MS, { anchor: 'playing', position: 41 })).toBe(false);
  });
});
