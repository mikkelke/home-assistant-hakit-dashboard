import type { EnergyTab } from './EnergyPage';
import './EnergyTabs.css';

interface EnergyTabsProps {
  tab: EnergyTab;
  onChange: (tab: EnergyTab) => void;
}

const TAB_OPTIONS: Array<{ value: EnergyTab; label: string }> = [
  { value: 'live', label: 'Live' },
  { value: 'price', label: 'Price' },
  { value: 'usage', label: 'Usage' },
  { value: 'devices', label: 'Devices' },
  { value: 'bill', label: 'Bill' },
];

/** Segmented Live/Price/Usage/Devices/Bill tab bar — visually mirrors PeriodPicker's own segment control
 * (filled-pill active state, ≥44px touch height). Rendered outside the page's scrollable content,
 * so — like the header — it stays on screen while a tab's own content scrolls underneath it. */
export function EnergyTabs({ tab, onChange }: EnergyTabsProps) {
  return (
    <div className='energy-tabs'>
      {TAB_OPTIONS.map(option => (
        <button
          key={option.value}
          type='button'
          className={`energy-tabs-btn ${tab === option.value ? 'active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
