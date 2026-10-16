import { useCallback, useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import {
  fetchEpisodes,
  fetchInProgress,
  fetchPlaylistTracks,
  fetchPodcasts,
  fetchRadios,
  fetchSpotifyPlaylists,
  type BridgeConnection,
  type Episode,
  type Playlist,
  type Podcast,
  type Radio,
  type ResumeItem,
  type Track,
} from './api';

export type Loaded<T> = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; data: T };

export interface Library {
  radios: Radio[];
  podcasts: Podcast[];
  resume: ResumeItem[];
}

async function loadLibrary(connection: BridgeConnection): Promise<Library> {
  const [radios, podcasts, resume] = await Promise.all([fetchRadios(connection), fetchPodcasts(connection), fetchInProgress(connection)]);
  return { radios, podcasts, resume };
}

interface Slot<T> {
  key: string;
  connection: object;
  data: T | null;
  failed: boolean;
}

/** Fetches whenever `active` turns on, `key` changes or the connection is replaced. The last answer for the same `key`
 * stays on screen while a new fetch is in flight and when it fails. `load` must keep its identity between renders. */
function useLoaded<T>(active: boolean, key: string, load: (connection: BridgeConnection) => Promise<T>): Loaded<T> {
  const connection = useHass(s => s.connection);
  const [slot, setSlot] = useState<Slot<T> | null>(null);

  useEffect(() => {
    if (!active || !connection) return;
    let cancelled = false;
    load(connection).then(
      data => {
        if (!cancelled) setSlot({ key, connection, data, failed: false });
      },
      () => {
        if (cancelled) return;
        setSlot(current => {
          const kept = current && current.key === key && current.connection === connection ? current.data : null;
          return { key, connection, data: kept, failed: true };
        });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [active, connection, key, load]);

  if (!slot || slot.key !== key || slot.connection !== connection) return { status: 'loading' };
  if (slot.data !== null) return { status: 'ready', data: slot.data };
  return slot.failed ? { status: 'failed' } : { status: 'loading' };
}

/** The viewer's radios, podcasts and unfinished episodes, fetched each time `active` turns on. */
export function useLibrary(active: boolean): Loaded<Library> {
  return useLoaded(active, 'library', loadLibrary);
}

/** The viewer's radio stations alone, for a card that has to name the station it plays, fetched each time `active` turns on. */
export function useRadios(active: boolean): Loaded<Radio[]> {
  return useLoaded(active, 'radios', fetchRadios);
}

/** The viewer's Spotify playlists, those played through Music Assistant first, fetched each time `active` turns on. Kept apart
 * from the library so a refusal of playlists leaves the stations and podcasts alone. */
export function usePlaylists(active: boolean): Loaded<Playlist[]> {
  return useLoaded(active, 'playlists', fetchSpotifyPlaylists);
}

/** The episodes of `podcast`, newest first, fetched each time `active` turns on. */
export function useEpisodes(active: boolean, podcast: Podcast | null): Loaded<Episode[]> {
  const itemId = podcast?.itemId ?? '';
  const provider = podcast?.provider ?? '';
  const load = useCallback((connection: BridgeConnection) => fetchEpisodes(connection, { itemId, provider }), [itemId, provider]);
  return useLoaded(active && podcast !== null, `episodes:${provider}:${itemId}`, load);
}

/** The tracks of `playlist`, in playlist order, fetched each time `active` turns on. */
export function usePlaylistTracks(active: boolean, playlist: Playlist | null): Loaded<Track[]> {
  const itemId = playlist?.itemId ?? '';
  const provider = playlist?.provider ?? '';
  const load = useCallback((connection: BridgeConnection) => fetchPlaylistTracks(connection, { itemId, provider }), [itemId, provider]);
  return useLoaded(active && playlist !== null, `tracks:${provider}:${itemId}`, load);
}
