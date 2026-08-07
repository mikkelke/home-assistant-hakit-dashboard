import type { ReactNode } from 'react';
import { Icon } from '@iconify/react';
import { useTouchScrollSlopGuard } from '../../hooks';
import './Appliance.css';

export interface ApplianceCardProps {
  /** Modifier class carrying this appliance's `--appliance-accent*` custom properties (see
   * Appliance.css), e.g. `appliance-accent-washer`. */
  accentClassName: string;
  glyphIcon: string;
  title: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Collapsed-row quick-action button (announce bell / mark-emptied basket), or omitted when
   * expanded or when the current state has no quick action. Callers gate this themselves. */
  quickButton?: ReactNode;
  stateWord: string;
  stateWordClass: 'tint' | 'alert' | 'muted';
  /** Hairline progress strip under the header, shown only while collapsed. */
  showCollapsedStrip: boolean;
  progressPct: number;
  /** Expanded body content (cycle strip, chips, hero, footer, ...) — stays card-specific. */
  children?: ReactNode;
}

/**
 * Shared shell for the washer/dryer/dishwasher cards: collapsible header (glyph disc, title,
 * quick-button slot, state word, chevron), the collapsed-state progress strip, and a body slot
 * for the rest of the card. Card-specific content (cycle strip, chips, hero, footer, sheets) is
 * passed in as `children` and rendered by each card component itself.
 */
export function ApplianceCard({
  accentClassName,
  glyphIcon,
  title,
  collapsed,
  onToggleCollapsed,
  quickButton,
  stateWord,
  stateWordClass,
  showCollapsedStrip,
  progressPct,
  children,
}: ApplianceCardProps) {
  const headerSlop = useTouchScrollSlopGuard();

  return (
    <div className={`appliance-card ${accentClassName}`}>
      <div
        className='appliance-header'
        onClick={() => {
          if (headerSlop.consumeBlockClick()) return;
          onToggleCollapsed();
        }}
        onTouchStart={headerSlop.onTouchStart}
        onTouchMove={headerSlop.onTouchMove}
        onTouchEnd={headerSlop.onTouchEnd}
        onTouchCancel={headerSlop.onTouchCancel}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleCollapsed();
          }
        }}
        role='button'
        tabIndex={0}
        aria-expanded={!collapsed}
      >
        <span className='appliance-glyph'>
          <Icon icon={glyphIcon} aria-hidden='true' />
        </span>
        <span className='appliance-title'>{title}</span>
        {quickButton && (
          <span className='appliance-quick' onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} role='presentation'>
            {quickButton}
          </span>
        )}
        <span className='appliance-header-right'>
          <span className={`appliance-word ${stateWordClass}`}>{stateWord}</span>
          <Icon icon={collapsed ? 'mdi:chevron-down' : 'mdi:chevron-up'} aria-hidden='true' className='appliance-chevron' />
        </span>
      </div>

      {collapsed && showCollapsedStrip && (
        <div className='appliance-collapsed-strip'>
          <div className='appliance-collapsed-strip-fill' style={{ width: `${progressPct}%` }} />
        </div>
      )}

      {!collapsed && <div className='appliance-content'>{children}</div>}
    </div>
  );
}
