import { describe, expect, it, vi } from 'vitest';
import { archiveConnection } from '../../../utils/__tests__/archiveConnectionStub';

const store = vi.hoisted(() => ({ state: { connection: undefined as unknown } }));
vi.mock('@hakit/core', () => ({ useHass: { getState: () => store.state } }));

const { clipLabel, fetchDoorbellIndex, ringClips } = await import('../doorbellArchive');

const PREFIX = '/media/local/abb_doorbell';
const clip = (name: string) => ({ filename: name, url: `${PREFIX}/${name}` });
const C1 = 'abb_ringclip_20261015_104740_100000002.mp4';
const C2 = 'abb_ringclip_20261015_104758_100000002.mp4';
const C3 = 'abb_ringclip_20261015_104815_100000002.mp4';

describe('ringClips', () => {
  it('lists the entry clips in the order the bridge wrote them', () => {
    const clips = [clip(C1), clip(C2), clip(C3)];
    expect(ringClips({ clips, clip_filename: C3, clip_url: `${PREFIX}/${C3}` })).toEqual(clips);
  });

  it('falls back to the single clip of an entry written before the bridge kept them all', () => {
    expect(ringClips({ clip_filename: C1, clip_url: `${PREFIX}/${C1}` })).toEqual([clip(C1)]);
    expect(ringClips({ clip_url: `${PREFIX}/${C1}` })).toEqual([{ filename: '', url: `${PREFIX}/${C1}` }]);
  });

  it('has no clip for an entry without one', () => {
    expect(ringClips({})).toEqual([]);
    expect(ringClips({ clip_filename: '', clip_url: '' })).toEqual([]);
    expect(ringClips({ clips: [] })).toEqual([]);
  });

  it('prefers clips over the single clip when both are there', () => {
    expect(ringClips({ clips: [clip(C1), clip(C2)], clip_url: `${PREFIX}/${C2}` })).toEqual([clip(C1), clip(C2)]);
  });

  it('degrades a hand-edited clips list to the single clip, or to the clips that can be played', () => {
    const single = { clip_filename: C2, clip_url: `${PREFIX}/${C2}` };
    expect(ringClips({ ...single, clips: 'nope' as never })).toEqual([clip(C2)]);
    expect(ringClips({ ...single, clips: [{ filename: C1, url: '' }, null as never, { filename: C3 } as never] })).toEqual([clip(C2)]);
    expect(
      ringClips({ ...single, clips: [{ filename: C1, url: `${PREFIX}/${C1}` }, null as never, { url: `${PREFIX}/x.mp4` } as never] })
    ).toEqual([clip(C1), { filename: '', url: `${PREFIX}/x.mp4` }]);
  });
});

describe('clipLabel', () => {
  it('counts the ring and gives the clock time from the filename', () => {
    expect(clipLabel(1, clip(C1))).toBe('Ring 1 · 10:47:40');
    expect(clipLabel(2, clip(C2))).toBe('Ring 2 · 10:47:58');
    expect(clipLabel(3, clip(C3))).toBe('Ring 3 · 10:48:15');
  });

  it('reads the clock as written, whatever zone the device is in', () => {
    expect(clipLabel(1, clip('abb_ringclip_20261025_000059_100000002.mp4'))).toBe('Ring 1 · 00:00:59');
    expect(clipLabel(1, clip('abb_ringclip_20261025_235959_100000002.mp4'))).toBe('Ring 1 · 23:59:59');
  });

  it('reads the fallback recorder names too, and the name in the url when the filename is missing', () => {
    expect(clipLabel(2, clip('abb_clip_20260813_130612_front.mp4'))).toBe('Ring 2 · 13:06:12');
    expect(clipLabel(2, { filename: '', url: `${PREFIX}/${C2}` })).toBe('Ring 2 · 10:47:58');
  });

  it('gives just the number when the filename carries no clock time', () => {
    for (const name of [
      'clip.mp4',
      'abb_ringclip_back.mp4',
      'abb_ringclip_20261015_256199_100000002.mp4',
      'abb_ringclip_20261015_1047_x.mp4',
      '',
    ]) {
      expect(clipLabel(2, { filename: name, url: '' })).toBe('Ring 2');
    }
  });
});

describe('fetchDoorbellIndex', () => {
  it('hands every entry on with the clips the bridge wrote, newest first', async () => {
    const old = {
      ts: 1_791_000_000,
      datetime: '2026-10-03T06:40:00+02:00',
      door: 'front door',
      clip_filename: C1,
      clip_url: `${PREFIX}/${C1}`,
    };
    const visit = {
      ts: 1_791_895_872,
      datetime: '2026-10-13T14:51:12+02:00',
      door: 'front door',
      clip_filename: C3,
      clip_url: `${PREFIX}/${C3}`,
      clips: [clip(C1), clip(C2), clip(C3)],
    };
    store.state.connection = archiveConnection({ doorbell_archive_index: { images: [old, visit] } }).connection;
    const entries = await fetchDoorbellIndex();
    expect(entries.map(entry => entry.datetime)).toEqual([visit.datetime, old.datetime]);
    expect(entries.map(ringClips)).toEqual([[clip(C1), clip(C2), clip(C3)], [clip(C1)]]);
  });
});
