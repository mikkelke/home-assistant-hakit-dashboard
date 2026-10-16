import { describe, expect, it } from 'vitest';
import type { Radio } from '../api';
import { drChannelOf, faceOf, isStreamNoise, playsRadio, stationOf, type PlayingFacts } from '../nowPlaying';

/** The DR stations of the library, named and numbered as the DR Podcasts provider lists them. */
const library: Radio[] = [
  [11, 'DR P1'],
  [12, 'DR P2'],
  [13, 'DR P3'],
  [14, 'DR P4 København'],
  [15, 'DR P5 København'],
  [16, 'DR P6 Beat'],
  [17, 'DR P8 Jazz'],
].map(([id, name]) => ({ uri: `library://radio/${id}`, name: String(name), favorite: false, imageId: `dr${id}proxy` }));

const hls = (stream: string, file = 'playlist-320000.m3u8') => `https://drliveradio2.akamaized.net/hls/live/2118698/${stream}/${file}`;
const asRadio = (url: string) => `builtin://radio/${url}`;

describe('the DR channel of a stream', () => {
  it.each([
    ['p1', 'DR P1'],
    ['p2', 'DR P2'],
    ['p3', 'DR P3'],
    ['p4kobenhavn', 'DR P4 København'],
    ['p5kobenhavn', 'DR P5 København'],
    ['p6', 'DR P6 Beat'],
    ['p8', 'DR P8 Jazz'],
  ])('is named by the %s segment of its address', (stream, name) => {
    expect(drChannelOf(asRadio(hls(stream)))?.name).toBe(name);
    expect(drChannelOf(hls(stream, 'masterab.m3u8'))?.name).toBe(name);
  });

  it('does not depend on the host, the numeric id or the query DR serves it with', () => {
    expect(drChannelOf(asRadio('https://drliveradio.akamaized.net/hls/live/2022411/p3/playlist-320000.m3u8'))?.name).toBe('DR P3');
    expect(
      drChannelOf('hls-radio://https://drliveradio1.akamaized.net/hls/live/2097651/p4kobenhavn/masterab.m3u8?dw=600&portalid=DRSonos')?.name
    ).toBe('DR P4 København');
  });

  it('is nothing for any other address, or a stream name that is not one of the channels', () => {
    expect(drChannelOf('')).toBeNull();
    expect(drChannelOf('library://radio/13')).toBeNull();
    expect(drChannelOf(asRadio('https://streams.radiomast.io/ref-128k-aaclc-stereo'))).toBeNull();
    expect(drChannelOf(hls('p3dvrtest'))).toBeNull();
    expect(drChannelOf(hls('p4kbh'))).toBeNull();
    expect(drChannelOf('https://example.com/hls/live/p3/playlist.m3u8')).toBeNull();
  });
});

describe('what counts as a radio', () => {
  it('is a radio item of Music Assistant, or a DR stream address', () => {
    expect(playsRadio('library://radio/13')).toBe(true);
    expect(playsRadio(asRadio('https://streams.radiomast.io/ref-128k-aaclc-stereo'))).toBe(true);
    expect(playsRadio(hls('p3'))).toBe(true);
  });

  it('is not a track, an episode or nothing', () => {
    expect(playsRadio('spotify--a1B2c3D4://track/abc')).toBe(false);
    expect(playsRadio('dr_podcasts://podcast_episode/https://drpodcast.nu/feed.xml https://drpodcast.nu/episode/1')).toBe(false);
    expect(playsRadio('')).toBe(false);
  });
});

describe('the library station of a content id', () => {
  it('is the station whose own uri it is', () => {
    expect(stationOf('library://radio/13', library)?.name).toBe('DR P3');
  });

  it.each([
    ['p1', 'library://radio/11'],
    ['p2', 'library://radio/12'],
    ['p3', 'library://radio/13'],
    ['p4kobenhavn', 'library://radio/14'],
    ['p5kobenhavn', 'library://radio/15'],
    ['p6', 'library://radio/16'],
    ['p8', 'library://radio/17'],
  ])('is the library entry of the DR channel whose stream %s is', (stream, uri) => {
    expect(stationOf(asRadio(hls(stream)), library)?.uri).toBe(uri);
  });

  it('reads past the codec tag a radio directory adds to the name', () => {
    const tagged: Radio[] = [{ uri: 'library://radio/5', name: 'DR P3 (AAC)', favorite: true, imageId: null }];
    expect(stationOf(asRadio(hls('p3')), tagged)?.uri).toBe('library://radio/5');
  });

  it("prefers the station's own uri to a DR stream it also carries", () => {
    const own: Radio = { uri: 'library://radio/40', name: 'Morgenradio', favorite: false, imageId: null };
    expect(stationOf('library://radio/40', [...library, own])).toBe(own);
  });

  it('is nothing when the library does not hold the channel, or the address is no station', () => {
    expect(stationOf(asRadio(hls('p3')), [])).toBeNull();
    expect(stationOf(asRadio(hls('p3')), library.slice(3))).toBeNull();
    expect(stationOf(asRadio('https://streams.radiomast.io/ref-128k-aaclc-stereo'), library)).toBeNull();
    expect(stationOf('', library)).toBeNull();
  });
});

describe('a title that says nothing', () => {
  const chime =
    'builtin://track/http://10.21.0.5:8123/media/local/sounds/temp/chime_tts/07354b4e57e42dc81603e1defffec7f9.mp3?authSig=eyJhbGciOi';

  it('is the name of the stream file Music Assistant named the item after', () => {
    expect(isStreamNoise('playlist-320000', asRadio(hls('p3')))).toBe(true);
    expect(isStreamNoise('playlist-96000', asRadio(hls('p3', 'playlist-96000.m3u8')))).toBe(true);
    expect(isStreamNoise('masterab', asRadio(`${hls('p3', 'masterab.m3u8')}?dw=600&portalid=DRSonos`))).toBe(true);
    expect(isStreamNoise('07354b4e57e42dc81603e1defffec7f9', chime)).toBe(true);
    expect(isStreamNoise('Min Sang', 'builtin://track/https://sounds.example/Min%20Sang.mp3')).toBe(true);
  });

  it('is a placeholder, an address or a file name whatever the content id is', () => {
    expect(isStreamNoise('no desc', 'library://radio/13')).toBe(true);
    expect(isStreamNoise('No Desc', '')).toBe(true);
    expect(isStreamNoise('https://example.com/live', '')).toBe(true);
    expect(isStreamNoise('stream.m3u8', '')).toBe(true);
    expect(isStreamNoise('Jingle.MP3', '')).toBe(true);
  });

  it('is not a title that tells what plays', () => {
    expect(isStreamNoise('Strong', 'spotify--a1B2c3D4://track/abc')).toBe(false);
    expect(isStreamNoise('The Brain Electric', asRadio('https://streams.radiomast.io/ref-128k-aaclc-stereo'))).toBe(false);
    expect(isStreamNoise('DR P3', 'library://radio/13')).toBe(false);
    expect(isStreamNoise('Playlist', 'library://playlist/1')).toBe(false);
    expect(
      isStreamNoise(
        'TopGunn vs. Emil Lange',
        'dr_podcasts://podcast_episode/https://drpodcast.nu/feed.xml https://drpodcast.nu/episode/16122639085'
      )
    ).toBe(false);
  });

  it('is never a title that merely equals the numeric id of a library item', () => {
    expect(isStreamNoise('13', 'library://track/13')).toBe(false);
  });

  it('is nothing for no title, and survives an address that cannot be decoded', () => {
    expect(isStreamNoise('', asRadio(hls('p3')))).toBe(false);
    expect(isStreamNoise('   ', asRadio(hls('p3')))).toBe(false);
    expect(isStreamNoise('Bad', 'builtin://track/https://sounds.example/%E0%A4%A.mp3')).toBe(false);
  });
});

describe('what a card says about its player', () => {
  const facts = (patch: Partial<PlayingFacts>): PlayingFacts => ({
    state: 'idle',
    title: '',
    artist: '',
    contentId: '',
    hasPicture: false,
    ...patch,
  });

  it('names the DR channel of a raw stream and carries its library entry', () => {
    const face = faceOf(facts({ contentId: asRadio(hls('p3')), title: 'playlist-320000' }), library);
    expect(face.stationName).toBe('DR P3');
    expect(face.radio?.imageId).toBe('dr13proxy');
    expect(face.quiet).toBe(false);
  });

  it('names the DR channel by itself while the library is out of reach', () => {
    const face = faceOf(facts({ contentId: asRadio(hls('p4kobenhavn')), title: 'no desc', state: 'playing' }), []);
    expect(face).toEqual({ radio: null, stationName: 'DR P4 København', quiet: false });
  });

  it("names a library station by the library's name", () => {
    const face = faceOf(facts({ contentId: 'library://radio/13', title: 'no desc', state: 'playing' }), library);
    expect(face.stationName).toBe('DR P3');
    expect(face.radio?.uri).toBe('library://radio/13');
  });

  it('has nothing to say about a stream it cannot name, or a station the library has not loaded yet', () => {
    expect(faceOf(facts({ contentId: asRadio('https://streams.example/live.aac'), title: 'live', state: 'playing' }), library).quiet).toBe(
      true
    );
    expect(faceOf(facts({ contentId: 'library://radio/13', title: 'no desc', state: 'playing' }), []).quiet).toBe(true);
  });

  it('has nothing to say about an idle player with nothing queued', () => {
    for (const state of ['idle', 'off', 'standby', 'unavailable']) {
      expect(faceOf(facts({ state }), library).quiet).toBe(true);
    }
  });

  it('leaves a player that plays without a title to the card, which knows its source', () => {
    expect(faceOf(facts({ state: 'playing' }), library).quiet).toBe(false);
    expect(faceOf(facts({ state: 'paused' }), library).quiet).toBe(false);
  });

  it('never replaces a real title, an artist or a picture', () => {
    expect(
      faceOf(facts({ contentId: 'spotify--a1B2c3D4://track/abc', title: 'Strong', artist: 'London Grammar', state: 'playing' }), library)
    ).toEqual({
      radio: null,
      stationName: null,
      quiet: false,
    });
    expect(faceOf(facts({ contentId: 'dr_podcasts://podcast_episode/x', title: 'En episode', state: 'idle' }), library).quiet).toBe(false);
    expect(
      faceOf(facts({ contentId: 'builtin://radio/https://x.example/a.aac', title: 'a', artist: 'Nogen', state: 'playing' }), library).quiet
    ).toBe(false);
    expect(
      faceOf(facts({ contentId: 'builtin://radio/https://x.example/a.aac', title: 'a', hasPicture: true, state: 'playing' }), library).quiet
    ).toBe(false);
  });
});
