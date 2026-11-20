import { useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import { HOUR_MS, numeric } from '../../home/eventDetail';
import { fetchEventHistory, type HistoryPoint } from '../../home/eventHistory';
import { EventChart } from './EventChart';
import './EventDetailSheet.css';

/** A plant's soil moisture a day either side of `atMs`, never past now, with `atMs` marked. */
export function PlantSoilChart({ entity, atMs, name }: { entity: string; atMs: number; name: string }) {
  const connection = useHass(s => s.connection);
  const [nowMs] = useState(() => Date.now());
  const startMs = atMs - 24 * HOUR_MS;
  const endMs = Math.min(nowMs, atMs + 24 * HOUR_MS);
  const [points, setPoints] = useState<HistoryPoint[] | 'loading' | 'failed'>('loading');
  useEffect(() => {
    if (!connection) return;
    let live = true;
    fetchEventHistory(connection, [entity], startMs, endMs).then(
      history => live && setPoints(history[entity] ?? []),
      () => live && setPoints('failed')
    );
    return () => {
      live = false;
    };
  }, [connection, entity, startMs, endMs]);
  if (points === 'loading') return <p className='evd-empty'>Loading…</p>;
  if (points === 'failed') return <p className='evd-empty'>Home Assistant did not answer. Close and open it again.</p>;
  return <EventChart points={numeric(points)} startMs={startMs} endMs={endMs} eventMs={atMs} unit='%' label={`${name} soil moisture`} />;
}
