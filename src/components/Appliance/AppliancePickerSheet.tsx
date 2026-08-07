import { Icon } from '@iconify/react';
import { ApplianceSheet } from './ApplianceSheet';

export interface AppliancePickerSheetProps {
  accentClassName: string;
  glyphIcon: string;
  historyKey: string;
  title: string;
  options: readonly string[];
  current: string;
  onPick: (option: string) => void;
  onClose: () => void;
  /** Row label override (e.g. dishwasher's Short picker shows "Short"/"Full length" for the raw
   * yes/no option values). `onPick` still receives the raw option value either way. */
  renderOption?: (option: string) => string;
}

/** One options list + current-value check, shared by the washer/dryer/dishwasher pickers
 * (programme, temperature, spin, dryness, time, Skåne+ lock note, short). */
export function AppliancePickerSheet({
  accentClassName,
  glyphIcon,
  historyKey,
  title,
  options,
  current,
  onPick,
  onClose,
  renderOption,
}: AppliancePickerSheetProps) {
  return (
    <ApplianceSheet accentClassName={accentClassName} glyphIcon={glyphIcon} title={title} historyKey={historyKey} onClose={onClose}>
      {options.map(opt => (
        <button key={opt} type='button' className='appliance-sheet-row' onClick={() => onPick(opt)}>
          <span>{renderOption ? renderOption(opt) : opt}</span>
          {opt === current && <Icon icon='mdi:check' className='appliance-sheet-check' aria-hidden='true' />}
        </button>
      ))}
    </ApplianceSheet>
  );
}
