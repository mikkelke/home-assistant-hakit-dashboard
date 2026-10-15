import type { Fingerprint, MapDoc } from '../../sensorMap/mapDoc';
import { Sheet } from './Sheet';

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

interface FingerprintSheetProps {
  item: Fingerprint;
  doc: MapDoc;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function FingerprintSheet({ item, doc, onDelete, onClose }: FingerprintSheetProps) {
  const rows = Object.entries(item.scanners)
    .map(([mac, scanner]) => ({
      mac,
      name: scanner.device_key ? (doc.devices[scanner.device_key]?.name ?? scanner.device_key) : mac,
      samples: scanner.samples,
      rssi: median(scanner.rssi),
      dist: median(scanner.dist.filter((value): value is number => value !== null)),
    }))
    .sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
  const zone = doc.plan.zones.find(candidate => candidate.zone_id === item.zone_id);
  return (
    <Sheet
      title='Fingerprint'
      subtitle={
        <>
          {item.at.slice(0, 16).replace('T', ' ')} UTC{item.weak ? ', weak' : ''}
        </>
      }
      onClose={onClose}
    >
      <p className='sm-muted'>
        {item.phone} at x {item.pos.x.toFixed(2)}, y {item.pos.y.toFixed(2)}, h {item.pos.h.toFixed(2)} m. Zone:{' '}
        {zone ? zone.name : 'none (outside every zone or on a boundary)'}. Window {item.window_s} s, {item.polls} polls. Bermuda area:{' '}
        {item.bermuda_area ?? 'none'}.
      </p>
      {item.layout_version < doc.layout_version && (
        <p className='sm-warn'>
          Taken with an older scanner layout ({item.layout_version}, now {doc.layout_version}).
        </p>
      )}
      {item.weak && <p className='sm-warn'>Fewer than three scanners heard the phone during the window.</p>}
      <table className='sm-table'>
        <thead>
          <tr>
            <th>Scanner</th>
            <th>Samples</th>
            <th>RSSI</th>
            <th>Distance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.mac}>
              <td>{row.name}</td>
              <td>{row.samples}</td>
              <td>{row.rssi ?? '-'}</td>
              <td>{row.dist === null ? '-' : `${row.dist.toFixed(1)} m`}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4}>No scanner delivered a fresh sample.</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className='sm-row'>
        <button type='button' className='sm-chip' onClick={() => onDelete(item.id)}>
          Delete this fingerprint
        </button>
      </div>
    </Sheet>
  );
}
