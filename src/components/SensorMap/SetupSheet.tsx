import { normalizeBssid, samePhoneAddress, type MapDoc, type SuggestItem } from '../../sensorMap/mapDoc';
import { Sheet } from './Sheet';
import { SuggestionCard } from './SuggestionCard';

export type SetupItem = Extract<SuggestItem, { kind: 'wifi' | 'phone' }>;

interface SetupSuggestionProps {
  item: SetupItem;
  doc: MapDoc;
  tag?: string;
  onAccept: (item: SuggestItem) => void;
  onReject: (id: string) => void;
}

/** One suggested setup: the phone Bluetooth tracks, or the phone whose Wi-Fi a capture reads and the access point
 * each BSSID belongs to. */
export function SetupSuggestion({ item, doc, tag, onAccept, onReject }: SetupSuggestionProps) {
  return (
    <SuggestionCard
      tag={tag}
      reason={item.reason}
      detail={
        item.kind === 'phone' ? (
          <>
            Phone {item.phone.name}: Bluetooth tracks it as {item.phone.bermuda_address}
            {item.phone.person ? `, person ${item.phone.person}` : ''}.{' '}
            {doc.phones.some(known => samePhoneAddress(known.bermuda_address, item.phone.bermuda_address))
              ? 'It replaces the phone already listed with that address.'
              : 'It is added to the tracked phones.'}
          </>
        ) : item.source ? (
          <>
            Phone {item.source.name}: tells {item.source.notify} to update its sensors, then reads {item.source.signal}, {item.source.bssid}{' '}
            and {item.source.frequency}.
          </>
        ) : undefined
      }
      onAccept={() => onAccept(item)}
      onDiscard={() => onReject(item.id)}
    >
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
    </SuggestionCard>
  );
}

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
        <SetupSuggestion key={item.id} item={item} doc={doc} onAccept={onAccept} onReject={onReject} />
      ))}
    </Sheet>
  );
}
