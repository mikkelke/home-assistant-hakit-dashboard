import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
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

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared portaled sheet shell for the appliance cards (picker + history sheets): overlay, sheet,
 * a top row with glyph/title/close, and a body slot. Always portaled to document.body — this is
 * load-bearing: the mobile room-detail panel has a CSS transform that hijacks `position: fixed`
 * descendants, so a non-portaled sheet would render a full viewport off-screen.
 */
export function ApplianceSheet({ accentClassName, glyphIcon, title, historyKey, onClose, children }: ApplianceSheetProps) {
  const { requestClose } = useModalBackButton({ isOpen: true, onRequestClose: onClose, historyKey });
  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(requestClose);
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      requestCloseRef.current();
      return;
    }
    if (e.key !== 'Tab' || !sheetRef.current) return;
    const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className={`appliance-modal-overlay ${accentClassName}`} onClick={requestClose}>
      <div
        ref={sheetRef}
        className='appliance-sheet'
        role='dialog'
        aria-modal='true'
        aria-label={title}
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className='appliance-sheet-top'>
          <span className='appliance-glyph'>
            <Icon icon={glyphIcon} aria-hidden='true' />
          </span>
          <span className='appliance-title'>{title}</span>
          <button ref={closeButtonRef} className='appliance-sheet-close modal-close-button' onClick={requestClose} aria-label='Close'>
            <Icon icon='mdi:close' />
          </button>
        </div>
        <div className='appliance-sheet-body'>{children}</div>
      </div>
    </div>,
    document.body
  );
}
