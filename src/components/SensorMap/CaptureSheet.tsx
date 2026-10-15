import type { Point } from '../../sensorMap/mapDoc';
import type { Phone } from '../../sensorMap/mapDoc';
import { NumberField, TextField } from './fields';
import { Sheet } from './Sheet';

interface CaptureSheetProps {
  at: Point;
  hCm: number;
  note: string;
  address: string;
  phones: readonly Phone[];
  onChange: (patch: { at?: Point; hCm?: number; note?: string; address?: string }) => void;
  onSave: () => void;
  onCancel: () => void;
}

const H_CHIPS = [30, 100, 150];

/** Where the phone is being held, before the stationary window starts. */
export function CaptureSheet({ at, hCm, note, address, phones, onChange, onSave, onCancel }: CaptureSheetProps) {
  return (
    <Sheet title='Capture a fingerprint' subtitle='a 10 second window with the phone held still' onClose={onCancel}>
      <div className='sm-row'>
        <NumberField label='x' unit='m' value={at[0]} onCommit={value => value !== null && onChange({ at: [value, at[1]] })} />
        <NumberField label='y' unit='m' value={at[1]} onCommit={value => value !== null && onChange({ at: [at[0], value] })} />
        <NumberField label='height' unit='cm' value={hCm} onCommit={value => value !== null && onChange({ hCm: value })} />
      </div>
      <div className='sm-row wrap'>
        {H_CHIPS.map(chip => (
          <button key={chip} type='button' className={`sm-chip small${hCm === chip ? ' on' : ''}`} onClick={() => onChange({ hCm: chip })}>
            {chip}
          </button>
        ))}
        {phones.length > 1 && (
          <label className='sm-field'>
            <span className='sm-field-label'>phone</span>
            <select className='sm-input' value={address} onChange={event => onChange({ address: event.target.value })}>
              {phones.map(phone => (
                <option key={phone.bermuda_address} value={phone.bermuda_address}>
                  {phone.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <TextField label='Note' value={note} placeholder='Note (optional)' onCommit={value => onChange({ note: value ?? '' })} />
      <div className='sm-row'>
        <button type='button' className='sm-chip on' onClick={onSave}>
          Save and start
        </button>
        <button type='button' className='sm-chip' onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className='sm-muted'>
        Moving, panning or tapping the map during the window cancels it. Only samples that arrive inside the window are kept.
      </p>
    </Sheet>
  );
}
