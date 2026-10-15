import type { SuggestItem } from '../../sensorMap/mapDoc';
import type { Ghost } from './MarkLayers';
import { Sheet } from './Sheet';

interface GhostSheetProps {
  ghost: Ghost;
  item: SuggestItem;
  onAccept: (item: SuggestItem) => void;
  onReject: (id: string) => void;
  onClose: () => void;
}

export function GhostSheet({ ghost, item, onAccept, onReject, onClose }: GhostSheetProps) {
  return (
    <Sheet
      title={ghost.device.name}
      subtitle={item.kind === 'new_device' ? 'suggested new device' : 'suggested placement'}
      onClose={onClose}
    >
      <p>{item.reason}</p>
      <p className='sm-muted'>
        At x {ghost.at[0].toFixed(2)}, y {ghost.at[1].toFixed(2)}.
      </p>
      {ghost.stale && <p className='sm-warn'>Made against an older layout.</p>}
      <div className='sm-row'>
        <button type='button' className='sm-chip on' onClick={() => onAccept(item)}>
          Accept
        </button>
        <button type='button' className='sm-chip' onClick={() => onReject(item.id)}>
          Reject
        </button>
      </div>
    </Sheet>
  );
}
