import { Icon } from '@iconify/react';
import { useEffect, useState, type ReactNode } from 'react';

/** A tap on the plan opens a sheet under the finger, and the browser then sends the click of that tap to whatever
 * is there now. The sheet takes no input until that moment has passed. */
const SETTLE_MS = 350;

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
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <section
      className={`sm-sheet${collapsed ? ' collapsed' : ''} ${className}`}
      aria-label='Details'
      style={settled ? undefined : { pointerEvents: 'none' }}
    >
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
