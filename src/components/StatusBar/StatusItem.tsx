import { Icon } from '@iconify/react';
import type { StatusItemProps } from '../../types';
import './StatusBar.css';

export function StatusItem({ icon, label, count, countDisplay, active }: StatusItemProps) {
  const displayValue = countDisplay ?? count;
  return (
    <div
      className={`status-item ${active ? 'active' : ''}`}
      data-count={count}
      data-count-display={displayValue}
      title={`${label}: ${displayValue}${active ? ' On' : ''}`}
    >
      <Icon icon={icon} className='status-icon-svg' />
      <div className='status-info'>
        <span className='status-label'>{label}</span>
        <span className='status-count'>{displayValue}</span>
      </div>
    </div>
  );
}
