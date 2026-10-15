import { CAPTURE_WINDOW_S } from '../../sensorMap/fingerprint';
import type { Phone, Point } from '../../sensorMap/mapDoc';
import type { WifiReady } from '../../sensorMap/wifi';
import { NumberField, TextField } from './fields';
import { Sheet } from './Sheet';

/** The survey point a capture is for. */
export interface SurveyTarget {
  n: number;
  label: string;
  skipped: boolean;
  onSkip: () => void;
  onRestore: () => void;
}

interface CaptureSheetProps {
  at: Point;
  hCm: number;
  note: string;
  address: string;
  phones: readonly Phone[];
  /** A tracked phone or a Wi-Fi source exists, so there is something to capture. */
  canStart: boolean;
  wifi: WifiReady;
  survey: SurveyTarget | null;
  onChange: (patch: { at?: Point; hCm?: number; note?: string; address?: string }) => void;
  onSave: () => void;
  onCancel: () => void;
}

const H_CHIPS = [30, 100, 150];

const WIFI_NOTE: Record<WifiReady, string> = {
  ready: "Wi-Fi is read from the phone's Companion app during the window.",
  none: 'No Wi-Fi source is set up, so this capture holds Bluetooth only.',
  missing: 'The Wi-Fi sensors are not enabled in the Companion app, so this capture will have no Wi-Fi.',
  offline: 'The Wi-Fi sensors report no value right now, so this capture may have no Wi-Fi.',
};

/** Where the phone is being held, before the stationary window starts. */
export function CaptureSheet({ at, hCm, note, address, phones, canStart, wifi, survey, onChange, onSave, onCancel }: CaptureSheetProps) {
  return (
    <Sheet
      title={survey ? `Point ${survey.n}: ${survey.label}` : 'Capture a fingerprint'}
      subtitle={`a ${CAPTURE_WINDOW_S} second window with the phone held still`}
      onClose={onCancel}
    >
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
      <TextField label='Note' value={note} placeholder='Note (optional)' onChange={value => onChange({ note: value ?? '' })} />
      <div className='sm-row wrap'>
        <button type='button' className='sm-chip on' disabled={!canStart} onClick={onSave}>
          Save and start
        </button>
        <button type='button' className='sm-chip' onClick={onCancel}>
          Cancel
        </button>
        {survey &&
          (survey.skipped ? (
            <button type='button' className='sm-chip' onClick={survey.onRestore}>
              Restore this point
            </button>
          ) : (
            <button type='button' className='sm-chip' onClick={survey.onSkip}>
              Skip this point
            </button>
          ))}
      </div>
      <p className='sm-muted'>
        Keep the screen on for {CAPTURE_WINDOW_S} s and hold the phone still.
        {survey ? ' Tap the plan to move the spot.' : ''} Moving, panning or tapping the map during the window cancels it. Only samples that
        arrive inside the window are kept.
      </p>
      {canStart ? (
        <p className={wifi === 'ready' ? 'sm-muted' : 'sm-warn'}>{WIFI_NOTE[wifi]}</p>
      ) : (
        <p className='sm-warn'>No tracked phone and no Wi-Fi source are set up, so there is nothing to capture.</p>
      )}
    </Sheet>
  );
}
