import { normalizeBssid, samePhoneAddress, type MapDoc, type SuggestItem } from '../../sensorMap/mapDoc';
import { DiscardSuggestion } from './DiscardSuggestion';
import { Sheet } from './Sheet';

type SetupItem = Extract<SuggestItem, { kind: 'wifi' | 'phone' }>;

interface SetupSheetProps {
  items: readonly SetupItem[];
  doc: MapDoc;
  onAccept: (item: SuggestItem) => void;
  onReject: (id: string) => void;
  onClose: () => void;
}

/** What a survey needs set up: which phone Bluetooth tracks, which phone's Wi-Fi sensors a capture reads, and which
 * access point each BSSID belongs to. The phone comes first: it is short, and the BSSID table under the Wi-Fi setup is not. */
export function SetupSheet({ items, doc, onAccept, onReject, onClose }: SetupSheetProps) {
  const bssids = Object.keys(doc.wifi.aps).length;
  const phones = doc.phones.length;
  const ordered = [...items.filter(item => item.kind === 'phone'), ...items.filter(item => item.kind === 'wifi')];
  return (
    <Sheet title='Survey setup' subtitle={`${items.length} suggested`} onClose={onClose}>
      <p className='sm-muted'>
        Now: {phones} tracked {phones === 1 ? 'phone' : 'phones'},{' '}
        {doc.wifi.source ? `Wi-Fi from ${doc.wifi.source.name}` : 'no Wi-Fi phone'}, {bssids} {bssids === 1 ? 'BSSID' : 'BSSIDs'} known.
      </p>
      {items.length === 0 && <p className='sm-muted'>Nothing is waiting.</p>}
      {ordered.map(item => (
        <div key={item.id} className='sm-suggest sm-wifi-item'>
          <p>{item.reason}</p>
          {item.kind === 'phone' && (
            <p className='sm-muted'>
              Phone {item.phone.name}: Bluetooth tracks it as {item.phone.bermuda_address}
              {item.phone.person ? `, person ${item.phone.person}` : ''}.{' '}
              {doc.phones.some(known => samePhoneAddress(known.bermuda_address, item.phone.bermuda_address))
                ? 'It replaces the phone already listed with that address.'
                : 'It is added to the tracked phones.'}
            </p>
          )}
          {item.kind === 'wifi' && item.source && (
            <p className='sm-muted'>
              Phone {item.source.name}: tells {item.source.notify} to update its sensors, then reads {item.source.signal},{' '}
              {item.source.bssid} and {item.source.frequency}.
            </p>
          )}
          <div className='sm-row wrap'>
            <button type='button' className='sm-chip on' onClick={() => onAccept(item)}>
              Accept
            </button>
            <DiscardSuggestion onDiscard={() => onReject(item.id)} />
          </div>
          {item.kind === 'wifi' && item.aps && (
            <table className='sm-table'>
              <thead>
                <tr>
                  <th>BSSID</th>
                  <th>Access point</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(item.aps).map(([bssid, key]) => (
                  <tr key={bssid}>
                    <td>{normalizeBssid(bssid) ?? bssid}</td>
                    <td>{doc.devices[key]?.name ?? 'not on the map yet'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </Sheet>
  );
}
