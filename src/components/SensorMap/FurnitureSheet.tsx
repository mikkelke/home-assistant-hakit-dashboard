import type { Furniture } from '../../sensorMap/mapDoc';
import { Sheet } from './Sheet';

interface FurnitureSheetProps {
  furniture: Furniture;
  collapsed: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export function FurnitureSheet({ furniture, collapsed, onToggle, onClose }: FurnitureSheetProps) {
  const [x0, y0, x1, y1] = furniture.box;
  const width = Math.round((x1 - x0) * 100);
  const depth = Math.round((y1 - y0) * 100);
  return (
    <Sheet title={furniture.name} subtitle='furniture' collapsed={collapsed} onToggle={onToggle} onClose={onClose}>
      <dl className='sm-entities'>
        <div className='sm-entity-row'>
          <dt>size</dt>
          <dd>
            {width} × {depth} cm
          </dd>
        </div>
      </dl>
    </Sheet>
  );
}
