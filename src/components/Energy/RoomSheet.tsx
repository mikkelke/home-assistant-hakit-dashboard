import { useState } from 'react';
import type { DeviceUsage, Period } from '../../energy';
import { krValue } from '../../energy/planView';
import type { RoomUsage } from '../../energy/roomsView';
import { ApplianceSheet } from '../Appliance';
import { DeviceDialog } from './DeviceDialog';

interface RoomSheetProps {
  room: RoomUsage;
  period: Period;
  anchorStartMs: number;
  rangeEndMs: number;
  powerByStatId: Readonly<Record<string, number>>;
  onClose: () => void;
}

/** One room's devices for the period, child meters under the meter that contains them; a device
 * opens its exact cost. */
export function RoomSheet({ room, period, anchorStartMs, rangeEndMs, powerByStatId, onClose }: RoomSheetProps) {
  const [device, setDevice] = useState<DeviceUsage | null>(null);

  const row = (item: DeviceUsage, child: boolean) => {
    const watts = powerByStatId[item.statId];
    return (
      <button
        key={item.statId}
        type='button'
        className={`ev-drow ${child ? 'ev-drow--child' : ''}`}
        disabled={item.kWh <= 0}
        onClick={() => setDevice(item)}
      >
        <span className='ev-rmain'>
          <span className='ev-rname'>{item.name}</span>
          {watts != null && watts >= 1 && (
            <span className='ev-rsub'>
              <span className='plan-chip plan-chip--tiny plan-chip--ghost'>{Math.round(watts).toLocaleString('da-DK')} W</span>
            </span>
          )}
        </span>
        <span className='ev-rnum'>
          <b>{krValue(item.kWh, 2)} kWh</b>
          <small>{item.costKr != null ? `≈ ${krValue(item.costKr)} kr` : '—'}</small>
        </span>
      </button>
    );
  };

  return (
    <>
      <ApplianceSheet
        accentClassName='appliance-accent-washer'
        glyphIcon={room.icon}
        title={room.name}
        historyKey='energy-room'
        onClose={onClose}
      >
        <div className='plan-sheet'>
          <div className='plan-chips'>
            <span className='plan-chip plan-chip--sky'>{krValue(room.kWh, 1)} kWh</span>
            {room.costKr != null && <span className='plan-chip plan-chip--ghost'>≈ {krValue(room.costKr)} kr</span>}
            {room.watts != null && (
              <span className='plan-chip plan-chip--ghost'>{Math.round(room.watts).toLocaleString('da-DK')} W now</span>
            )}
          </div>
          <div className='ev-list'>
            {room.devices.map(item => [row(item, false), ...(item.children ?? []).map(child => row(child, true))])}
            {room.devices.length === 0 && <p className='plan-note'>No use recorded yet</p>}
          </div>
        </div>
      </ApplianceSheet>
      {device && (
        <DeviceDialog
          device={device}
          period={period}
          anchorStartMs={anchorStartMs}
          rangeEndMs={rangeEndMs}
          onClose={() => setDevice(null)}
        />
      )}
    </>
  );
}
