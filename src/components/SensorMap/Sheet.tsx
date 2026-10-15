import { Icon } from '@iconify/react';
import type { ReactNode } from 'react';

interface SheetProps {
  title: ReactNode;
  subtitle?: ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}

/** A bottom sheet on a phone and a side panel on a wide screen. Collapsed, it is one line: the handle. */
export function Sheet({ title, subtitle, collapsed = false, onToggle, onClose, className = '', children }: SheetProps) {
  return (
    <section className={`sm-sheet${collapsed ? ' collapsed' : ''} ${className}`} aria-label='Details'>
      <header className='sm-sheet-head'>
        <button type='button' className='sm-sheet-handle' onClick={onToggle} aria-expanded={!collapsed} disabled={!onToggle}>
          <span className='sm-sheet-title'>{title}</span>
          {subtitle && <span className='sm-sheet-sub'>{subtitle}</span>}
        </button>
        {onToggle && (
          <button type='button' className='sm-icon-btn' onClick={onToggle} aria-label={collapsed ? 'Expand' : 'Collapse'}>
            <Icon icon={collapsed ? 'mdi:chevron-up' : 'mdi:chevron-down'} />
          </button>
        )}
        <button type='button' className='sm-icon-btn' onClick={onClose} aria-label='Close'>
          <Icon icon='mdi:close' />
        </button>
      </header>
      {!collapsed && <div className='sm-sheet-body'>{children}</div>}
    </section>
  );
}
