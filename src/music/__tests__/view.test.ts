import { describe, expect, it } from 'vitest';
import type { Episode, Podcast, Radio } from '../api';
import { episodeMark, favoritesFirst, formatReleased, formatRunTime, formatTrackLength, podcastsByName, radioLabel } from '../view';

const radio = (name: string, favorite: boolean): Radio => ({ uri: `library://radio/${name}`, name, favorite, imageId: null });

const episode = (patch: Partial<Episode>): Episode => ({
  uri: 'u',
  name: 'n',
  releasedAt: '',
  position: null,
  durationS: 7200,
  resumeMs: 0,
  fullyPlayed: false,
  imageId: null,
  ...patch,
});

describe('a station label', () => {
  it('drops the codec tag a radio directory adds', () => {
    expect(radioLabel('DR P3 (AAC)')).toBe('DR P3');
    expect(radioLabel('Kanal 4 København (aac)')).toBe('Kanal 4 København');
    expect(radioLabel('Lokalradio (MP3)')).toBe('Lokalradio');
    expect(radioLabel('Kanal 7 (128k)')).toBe('Kanal 7');
    expect(radioLabel('Kanal 7 (HLS)')).toBe('Kanal 7');
  });

  it('keeps any other parenthesis, and a name that is only a tag', () => {
    expect(radioLabel('Radio (Live)')).toBe('Radio (Live)');
    expect(radioLabel('Kanal (AAC) Jazz')).toBe('Kanal (AAC) Jazz');
    expect(radioLabel('Kanal 1')).toBe('Kanal 1');
  });
});

describe('favorites first', () => {
  it('moves favorites ahead and keeps the order within each group', () => {
    const list = [radio('a', false), radio('b', true), radio('c', false), radio('d', true)];
    expect(favoritesFirst(list).map(r => r.name)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('leaves its input alone', () => {
    const list = [radio('a', false), radio('b', true)];
    favoritesFirst(list);
    expect(list.map(r => r.name)).toEqual(['a', 'b']);
  });
});

describe('podcasts by name', () => {
  it('follow Danish alphabetical order, where æ, ø and å come after z', () => {
    const named = (name: string): Podcast => ({ uri: name, itemId: name, provider: 'library', name, imageId: null });
    const sorted = podcastsByName(['Østkysten', 'Zebra', 'Ærlig talt', 'Aftenstund'].map(named));
    expect(sorted.map(p => p.name)).toEqual(['Aftenstund', 'Zebra', 'Ærlig talt', 'Østkysten']);
  });
});

describe('a release date', () => {
  it('reads on the house calendar whatever the device zone is', () => {
    expect(formatReleased('2026-10-02T16:00:00+00:00')).toBe('2 Oct 2026');
    expect(formatReleased('2026-10-02T23:30:00+00:00')).toBe('3 Oct 2026');
    expect(formatReleased('2026-01-02T23:30:00+00:00')).toBe('3 Jan 2026');
  });

  it('is empty when there is none or it cannot be read', () => {
    expect(formatReleased('')).toBe('');
    expect(formatReleased('yesterday')).toBe('');
  });
});

describe('a run time', () => {
  it('is minutes under an hour, otherwise hours and the minutes left', () => {
    expect(formatRunTime(2700)).toBe('45 min');
    expect(formatRunTime(7200)).toBe('2 h');
    expect(formatRunTime(5400)).toBe('1 h 30 min');
    expect(formatRunTime(3600)).toBe('1 h');
  });

  it('is never less than a minute', () => {
    expect(formatRunTime(20)).toBe('1 min');
  });
});

describe('a track length', () => {
  it('is minutes and two-digit seconds, with hours only past the hour', () => {
    expect(formatTrackLength(225)).toBe('3:45');
    expect(formatTrackLength(61)).toBe('1:01');
    expect(formatTrackLength(3600)).toBe('1:00:00');
    expect(formatTrackLength(3723)).toBe('1:02:03');
  });

  it('rounds to the nearest second and never goes below zero', () => {
    expect(formatTrackLength(59.6)).toBe('1:00');
    expect(formatTrackLength(9)).toBe('0:09');
    expect(formatTrackLength(-5)).toBe('0:00');
  });
});

describe('the mark of an episode', () => {
  it('is none for an episode nobody started', () => {
    expect(episodeMark(episode({}))).toBeNull();
  });

  it('is played once it is fully played, whatever position it kept', () => {
    expect(episodeMark(episode({ fullyPlayed: true }))).toEqual({ kind: 'played' });
    expect(episodeMark(episode({ fullyPlayed: true, resumeMs: 9000 }))).toEqual({ kind: 'played' });
  });

  it('is how far in an unfinished episode is', () => {
    expect(episodeMark(episode({ resumeMs: 1_800_000 }))).toEqual({ kind: 'resume', fraction: 0.25 });
  });

  it('has no fraction without a length, and never passes the whole', () => {
    expect(episodeMark(episode({ resumeMs: 9000, durationS: null }))).toEqual({ kind: 'resume', fraction: null });
    expect(episodeMark(episode({ resumeMs: 9_000_000, durationS: 7200 }))).toEqual({ kind: 'resume', fraction: 1 });
  });
});
