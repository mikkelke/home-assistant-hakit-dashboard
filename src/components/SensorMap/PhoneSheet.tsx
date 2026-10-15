import type { MapDoc } from '../../sensorMap/mapDoc';
import { normalizeMac } from '../../sensorMap/registry';
import { Sheet } from './Sheet';
import type { PhoneStatus } from './usePhones';

export function PhoneSheet({ status, doc, onClose }: { status: PhoneStatus; doc: MapDoc; onClose: () => void }) {
  const nameOf = (mac: string) => {
    const hit = Object.values(doc.devices).find(device => device.ha.scanner_source && normalizeMac(device.ha.scanner_source) === mac);
    return hit?.name ?? mac;
  };
  const rows = [...status.scanners].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
  return (
    <Sheet title={status.phone.name} subtitle='scanners that hear the phone' onClose={onClose}>
      <table className='sm-table'>
        <thead>
          <tr>
            <th>Scanner</th>
            <th>RSSI</th>
            <th>Distance</th>
            <th>Adverts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.scanner}>
              <td>{nameOf(row.scanner)}</td>
              <td>{row.rssi ?? '-'}</td>
              <td>{row.dist === null ? '-' : `${row.dist.toFixed(1)} m`}</td>
              <td>{row.freshness}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4}>No scanner reports this phone.</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className='sm-muted'>
        Distances come from signal strength and can be far off, especially through walls. They are listed, not used.
      </p>
    </Sheet>
  );
}
