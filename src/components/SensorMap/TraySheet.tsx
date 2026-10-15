import type { Candidate } from '../../sensorMap/registry';
import { Sheet } from './Sheet';

interface TraySheetProps {
  name: string;
  model: string;
  candidate: Candidate | null;
  onIgnore: (deviceIds: string[]) => void;
  onCancel: () => void;
}

export function TraySheet({ name, model, candidate, onIgnore, onCancel }: TraySheetProps) {
  return (
    <Sheet title={name} subtitle='not on the plan' onClose={onCancel}>
      <p className='sm-muted'>{model}</p>
      <p>Tap the plan where it is.</p>
      <div className='sm-row'>
        {candidate && (
          <button type='button' className='sm-chip' onClick={() => onIgnore(candidate.device_ids)}>
            Ignore this device
          </button>
        )}
        <button type='button' className='sm-chip' onClick={onCancel}>
          Cancel
        </button>
      </div>
      {candidate && (
        <p className='sm-muted'>
          From Home Assistant: {candidate.platform}
          {candidate.area_id ? `, area ${candidate.area_id}` : ''}.
        </p>
      )}
    </Sheet>
  );
}
