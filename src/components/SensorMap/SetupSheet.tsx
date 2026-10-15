import { normalizeBssid, type MapDoc, type SuggestItem } from '../../sensorMap/mapDoc';
import { DiscardSuggestion } from './DiscardSuggestion';
import { Sheet } from './Sheet';

type WifiItem = Extract<SuggestItem, { kind: 'wifi' }>;

interface WifiSetupSheetProps {
  items: readonly WifiItem[];
  doc: MapDoc;
  onAccept: (item: SuggestItem) => void;
  onReject: (id: string) => void;
  onClose: () => void;
}

/** The suggested Wi-Fi setup: which phone's sensors a capture reads, and which access point each BSSID belongs to. */
export function WifiSetupSheet({ items, doc, onAccept, onReject, onClose }: WifiSetupSheetProps) {
  const known = Object.keys(doc.wifi.aps).length;
  return (
    <Sheet title='Wi-Fi setup' subtitle={`${items.length} suggested`} onClose={onClose}>
      <p className='sm-muted'>
        Now: {doc.wifi.source ? `phone ${doc.wifi.source.name}` : 'no phone'}, {known} {known === 1 ? 'BSSID' : 'BSSIDs'} known.
      </p>
      {items.length === 0 && <p className='sm-muted'>Nothing is waiting.</p>}
      {items.map(item => (
        <div key={item.id} className='sm-suggest sm-wifi-item'>
          <p>{item.reason}</p>
          {item.source && (
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
          {item.aps && (
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
