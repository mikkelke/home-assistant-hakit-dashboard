import { Icon } from '@iconify/react';
import type { EnergyTab } from './energyTab';
import './EnergyTabs.css';

interface EnergyTabsProps {
  tab: EnergyTab;
  onChange: (tab: EnergyTab) => void;
}

const TAB_OPTIONS: Array<{ value: EnergyTab; label: string; icon: string }> = [
  { value: 'live', label: 'Live', icon: 'mdi:flash-outline' },
  { value: 'plan', label: 'Plan', icon: 'mdi:calendar-clock-outline' },
  { value: 'usage', label: 'Usage', icon: 'mdi:chart-bar' },
  { value: 'rooms', label: 'Rooms', icon: 'mdi:home-outline' },
  { value: 'bill', label: 'Bill', icon: 'mdi:receipt-text-outline' },
];

/** Live · Plan · Usage · Rooms · Bill, icon over label. Rendered outside the page's scrollable
 * content, so it stays on screen while a tab's own content scrolls underneath it. */
export function EnergyTabs({ tab, onChange }: EnergyTabsProps) {
  return (
    <div className='energy-tabs' role='tablist'>
      {TAB_OPTIONS.map(option => (
        <button
          key={option.value}
          type='button'
          role='tab'
          aria-selected={tab === option.value}
          className={`energy-tabs-btn ${tab === option.value ? 'active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          <Icon icon={option.icon} className='energy-tabs-icon' aria-hidden='true' />
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
