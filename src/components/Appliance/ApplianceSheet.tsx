import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@iconify/react';
import { useModalBackButton, useSwipeToClose } from '../../hooks';

export interface ApplianceSheetProps {
  /** Modifier class carrying this appliance's `--appliance-accent*` custom properties (see
   * Appliance.css). Applied here (not just on the card root) because createPortal moves this
   * subtree under document.body, out from under the card — custom properties don't cascade
   * across that jump, so the sheet needs its own copy of the accent class. */
  accentClassName: string;
  glyphIcon: string;
  title: string;
  historyKey: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Shared portaled sheet shell for the appliance cards (picker + history sheets): overlay, sheet,
 * a top row with glyph/title/close, and a body slot. Always portaled to document.body — this is
 * load-bearing: the mobile room-detail panel has a CSS transform that hijacks `position: fixed`
 * descendants, so a non-portaled sheet would render a full viewport off-screen.
 */
export function ApplianceSheet({ accentClassName, glyphIcon, title, historyKey, onClose, children }: ApplianceSheetProps) {
  const { requestClose } = useModalBackButton({ isOpen: true, onRequestClose: onClose, historyKey });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestClose);

  return createPortal(
    <div className={`appliance-modal-overlay ${accentClassName}`} onClick={requestClose}>
      <div
        className='appliance-sheet'
        role='dialog'
        aria-modal='true'
        onClick={e => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className='appliance-sheet-top'>
          <span className='appliance-glyph'>
            <Icon icon={glyphIcon} aria-hidden='true' />
          </span>
          <span className='appliance-title'>{title}</span>
          <button className='appliance-sheet-close modal-close-button' onClick={requestClose} aria-label='Close'>
            <Icon icon='mdi:close' />
          </button>
        </div>
        <div className='appliance-sheet-body'>{children}</div>
      </div>
    </div>,
    document.body
  );
}
