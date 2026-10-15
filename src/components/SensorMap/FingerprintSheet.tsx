import { shortBssid } from '../../sensorMap/coverage';
import type { Fingerprint, MapDoc } from '../../sensorMap/mapDoc';
import { Sheet } from './Sheet';
import { bandText, missText, wifiLine } from './wifiText';

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
  /** Captures the same survey point again; given only for a capture that was made for one. */
  onRetake?: (item: Fingerprint) => void;
  onClose: () => void;
}

export function FingerprintSheet({ item, doc, onDelete, onRetake, onClose }: FingerprintSheetProps) {
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
  const hasBle = item.bermuda_address !== '';
  const { wifi } = item;
  const apKey = wifi.bssid ? doc.wifi.aps[wifi.bssid] : undefined;
  const apName = apKey ? (doc.devices[apKey]?.name ?? null) : null;
  const missing = (['bssid', 'freq'] as const).flatMap(field =>
    wifi.miss[field] ? [`${field === 'freq' ? 'frequency' : 'BSSID'}: ${missText(field, wifi.miss[field])}`] : []
  );
  return (
    <Sheet
      title='Fingerprint'
      subtitle={
        <>
          {item.at.slice(0, 16).replace('T', ' ')} UTC{hasBle && item.weak ? ', weak' : ''}
        </>
      }
      onClose={onClose}
    >
      <p className='sm-muted'>
        {item.phone} at x {item.pos.x.toFixed(2)}, y {item.pos.y.toFixed(2)}, h {item.pos.h.toFixed(2)} m. Zone:{' '}
        {zone ? zone.name : 'none (outside every zone or on a boundary)'}. Window {item.window_s} s
        {hasBle ? `, ${item.polls} polls. Bermuda area: ${item.bermuda_area ?? 'none'}.` : '.'}
        {item.survey_id ? ` Survey point ${item.survey_id}.` : ''}
      </p>
      {item.layout_version < doc.layout_version && (
        <p className='sm-warn'>
          Taken with an older scanner layout ({item.layout_version}, now {doc.layout_version}).
        </p>
      )}
      <h3 className='sm-h'>Wi-Fi</h3>
      <p className={wifi.dbm === null ? 'sm-warn' : undefined}>
        {wifiLine(wifi, apName)}
        {wifi.dbm !== null && wifi.readings.length > 1 ? ` (median of ${wifi.readings.length} readings)` : ''}
      </p>
      {wifi.bssid && (
        <p className='sm-muted'>
          BSSID {wifi.bssid} ({shortBssid(wifi.bssid)}){wifi.freq_mhz !== null ? `, ${wifi.freq_mhz} MHz, ${bandText(wifi.band)}` : ''}
          {apKey && !apName ? '. Its access point is not on the map yet.' : ''}
          {!apKey ? '. The BSSID table does not list it.' : ''}
        </p>
      )}
      {wifi.dbm !== null && missing.length > 0 && <p className='sm-muted'>{missing.join('. ')}.</p>}
      {hasBle ? (
        <>
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
        </>
      ) : (
        <p className='sm-muted'>No phone was tracked by Bluetooth for this capture.</p>
      )}
      <div className='sm-row'>
        {onRetake && (
          <button type='button' className='sm-chip on' onClick={() => onRetake(item)}>
            Capture this point again
          </button>
        )}
        <button type='button' className='sm-chip' onClick={() => onDelete(item.id)}>
          Delete this fingerprint
        </button>
      </div>
    </Sheet>
  );
}
