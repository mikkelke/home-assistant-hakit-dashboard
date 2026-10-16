import { mediaKindOf, type Radio } from './api';
import { radioLabel } from './view';

/** A DR live channel. `stream` is the segment of its HLS address that names it (`/hls/live/<id>/<stream>/`) and `name` is what
 * the DR Podcasts provider calls the channel in the Music Assistant library. */
interface DrChannel {
  stream: string;
  name: string;
}

const DR_CHANNELS: readonly DrChannel[] = [
  { stream: 'p1', name: 'DR P1' },
  { stream: 'p2', name: 'DR P2' },
  { stream: 'p3', name: 'DR P3' },
  { stream: 'p4kobenhavn', name: 'DR P4 København' },
  { stream: 'p5kobenhavn', name: 'DR P5 København' },
  { stream: 'p6', name: 'DR P6 Beat' },
  { stream: 'p8', name: 'DR P8 Jazz' },
];

export const NO_RADIOS: readonly Radio[] = [];

/** The DR channel whose live stream a content id carries, whatever host and numeric id DR serves it from. */
export function drChannelOf(contentId: string): DrChannel | null {
  const stream = /\/hls\/live\/\d+\/([a-z0-9]+)\//i.exec(contentId)?.[1].toLowerCase();
  return DR_CHANNELS.find(channel => channel.stream === stream) ?? null;
}

/** Whether what plays is a radio station, which a card can only name once it has the library's stations. */
export function playsRadio(contentId: string): boolean {
  return mediaKindOf(contentId) === 'radio' || drChannelOf(contentId) !== null;
}

/** The library station a content id plays: the station's own uri, or the library entry of the DR channel whose stream it is. */
export function stationOf(contentId: string, radios: readonly Radio[]): Radio | null {
  const own = radios.find(radio => radio.uri === contentId);
  if (own) return own;
  const channel = drChannelOf(contentId);
  if (!channel) return null;
  const name = channel.name.toLowerCase();
  return radios.find(radio => radioLabel(radio.name).toLowerCase() === name) ?? null;
}

const PLACEHOLDER_TITLES = new Set(['no desc']);
const URL_START = /^[a-z][a-z0-9+.-]*:\/\//i;
const MEDIA_FILE = /\.(?:m3u8?|pls|mp3|mp4|m4a|aac|flac|ogg|opus|wav|wma)$/i;
const FILE_EXTENSION = /\.[a-z0-9]{1,5}$/i;

/** The file name, without extension, of the stream address inside a content id. */
function streamName(contentId: string): string {
  const address = /https?:\/\/\S+/i.exec(contentId)?.[0] ?? '';
  const file = address.split(/[?#]/, 1)[0].split('/').pop() ?? '';
  try {
    return decodeURIComponent(file).replace(FILE_EXTENSION, '');
  } catch {
    return file.replace(FILE_EXTENSION, '');
  }
}

/** A title that says nothing about what plays: a placeholder, an address, a file name, or the name of the stream file the
 * content id points at, which is what Music Assistant falls back to for an address it knows nothing else about. */
export function isStreamNoise(title: string, contentId: string): boolean {
  const text = title.trim().toLowerCase();
  if (text === '') return false;
  if (PLACEHOLDER_TITLES.has(text) || URL_START.test(text) || MEDIA_FILE.test(text)) return true;
  return text === streamName(contentId).toLowerCase();
}

export interface PlayingFacts {
  state: string;
  title: string;
  artist: string;
  contentId: string;
  hasPicture: boolean;
}

export interface Face {
  /** The library entry of the station that plays, for its logo. */
  radio: Radio | null;
  /** The station's name: the library's, or the DR channel's own while the library does not hold it. */
  stationName: string | null;
  /** Nothing is known about what plays, so the card names the speaker instead. */
  quiet: boolean;
}

/** What a card says about its player: the station that plays, or that there is nothing to say. A real title, an artist or a
 * picture is never replaced. */
export function faceOf(facts: PlayingFacts, radios: readonly Radio[]): Face {
  const radio = stationOf(facts.contentId, radios);
  const stationName = radio ? radioLabel(radio.name) : (drChannelOf(facts.contentId)?.name ?? null);
  const active = facts.state === 'playing' || facts.state === 'paused' || facts.state === 'buffering';
  const titleSaysNothing = facts.title.trim() === '' ? !active : isStreamNoise(facts.title, facts.contentId);
  return { radio, stationName, quiet: stationName === null && !facts.artist && !facts.hasPicture && titleSaysNothing };
}
