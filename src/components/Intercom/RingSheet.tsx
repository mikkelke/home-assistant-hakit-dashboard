import { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HouseEpisode } from '../../home/houseEvents';
import { DoorbellMedia, DoorbellViewer } from './DoorbellGallery';
import { fetchDoorbellIndex, formatRingTime, type DoorbellImage } from './doorbellArchive';
import { matchRingEntry, ringEntryMayArrive } from './ringMatch';
import './RingSheet.css';

/** How often the sheet reads the index again while the ring's entry may still be on its way. */
const REREAD_MS = 5_000;

interface IndexRead {
  entries: DoorbellImage[] | 'failed';
  /** No entry for this ring yet, and one may still come: the sheet reads again. */
  waiting: boolean;
}

/** Who rang, for one doorbell episode of the house feed: the archive's snapshot and clip of that ring, else a
 * plain "no photo" rather than the nearest other ring. A fresh ring waits for its entry first. */
export default function RingSheet({ episode, onClose }: { episode: HouseEpisode; onClose: () => void }) {
  const first = episode.rows[0];
  const cause = first.cause ?? first.text;
  const [read, setRead] = useState<IndexRead | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const openedMs = Date.now();
    const load = () => {
      fetchDoorbellIndex()
        .then(
          (images): IndexRead['entries'] => images,
          () => 'failed' as const
        )
        .then(entries => {
          if (!live) return;
          const found = Array.isArray(entries) && matchRingEntry(entries, episode.startMs, cause) != null;
          const waiting = !found && ringEntryMayArrive(episode.startMs, openedMs, Date.now());
          setRead({ entries, waiting });
          if (waiting) timer = setTimeout(load, REREAD_MS);
        });
    };
    load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [episode.startMs, cause]);

  const entries = read?.entries ?? null;
  const ring = Array.isArray(entries) ? matchRingEntry(entries, episode.startMs, cause) : null;
  const when = formatRingTime(ring ?? { datetime: new Date(episode.startMs).toISOString(), ts: '' });
  return (
    <DoorbellViewer door={ring?.door} eventType={ring?.event_type} when={when} historyKey='ring-photo' onClose={onClose}>
      {read == null ? null : ring && (ring.url || ring.clip_url) ? (
        <DoorbellMedia image={ring} autoPlay={false} />
      ) : read.waiting ? (
        <p className='ring-none' role='status' aria-label='Waiting for the ring photo'>
          <Icon icon='mdi:timer-sand' aria-hidden='true' />
        </p>
      ) : (
        <p className='ring-none'>
          <Icon icon={entries === 'failed' ? 'mdi:cloud-off-outline' : 'mdi:image-off-outline'} aria-hidden='true' />
          {entries === 'failed' ? 'Could not load the ring photos' : 'No photo for this ring'}
        </p>
      )}
    </DoorbellViewer>
  );
}
