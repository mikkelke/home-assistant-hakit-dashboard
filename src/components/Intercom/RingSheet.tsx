import { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import type { HouseEpisode } from '../../home/houseEvents';
import { DoorbellMedia, DoorbellViewer } from './DoorbellGallery';
import { fetchDoorbellIndex, formatRingTime, type DoorbellImage } from './doorbellArchive';
import { matchRingEntry } from './ringMatch';
import './RingSheet.css';

/** Who rang, for one doorbell episode of the house feed: the archive's snapshot and clip of that ring, else a
 * plain "no photo" rather than the nearest other ring. */
export default function RingSheet({ episode, onClose }: { episode: HouseEpisode; onClose: () => void }) {
  const [entries, setEntries] = useState<DoorbellImage[] | 'failed' | null>(null);
  useEffect(() => {
    let live = true;
    fetchDoorbellIndex()
      .then(images => {
        if (live) setEntries(images);
      })
      .catch(() => {
        if (live) setEntries('failed');
      });
    return () => {
      live = false;
    };
  }, []);

  const first = episode.rows[0];
  const ring = Array.isArray(entries) ? matchRingEntry(entries, episode.startMs, first.cause ?? first.text) : null;
  const when = formatRingTime(ring ?? { datetime: new Date(episode.startMs).toISOString(), ts: '' });
  return (
    <DoorbellViewer door={ring?.door} eventType={ring?.event_type} when={when} historyKey='ring-photo' onClose={onClose}>
      {entries == null ? null : ring && (ring.url || ring.clip_url) ? (
        <DoorbellMedia image={ring} autoPlay={false} />
      ) : (
        <p className='ring-none'>
          <Icon icon={entries === 'failed' ? 'mdi:cloud-off-outline' : 'mdi:image-off-outline'} aria-hidden='true' />
          {entries === 'failed' ? 'Could not load the ring photos' : 'No photo for this ring'}
        </p>
      )}
    </DoorbellViewer>
  );
}
