import { useEffect, useRef, type ReactNode, type TouchEventHandler } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function focusableElements(sheet: HTMLElement) {
  return Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    element =>
      !element.matches(':disabled') &&
      !element.closest('[hidden], [inert], fieldset[disabled]') &&
      (!element.closest('details:not([open])') || element.tagName === 'SUMMARY')
  );
}

function isTopSheet(sheet: HTMLElement) {
  const sheets = document.querySelectorAll('.rq-sheet[aria-modal="true"]');
  return sheets[sheets.length - 1] === sheet;
}

interface SheetProps {
  label: string;
  className?: string;
  variant: 'search' | 'detail';
  onRequestClose: () => void;
  swipe: {
    onTouchStart: TouchEventHandler | undefined;
    onTouchMove: TouchEventHandler | undefined;
    onTouchEnd: TouchEventHandler | undefined;
  };
  children: ReactNode;
}

/**
 * Bottom sheet portaled to document.body (same reason as ApplianceSheet: ancestors with a CSS transform hijack
 * `position: fixed`). Close/back plumbing stays with the owner, which needs `requestClose` itself.
 */
export function Sheet({ label, className, variant, onRequestClose, swipe, children }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const sheet = sheetRef.current;
    const trapFocus = (event: FocusEvent) => {
      if (sheet && isTopSheet(sheet) && event.target instanceof Node && !sheet.contains(event.target)) {
        (focusableElements(sheet)[0] ?? sheet).focus({ preventScroll: true });
      }
    };
    document.addEventListener('focusin', trapFocus);
    sheet?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('focusin', trapFocus);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className={`rq-overlay rq-overlay--${variant}`} onClick={onRequestClose}>
      <div
        ref={sheetRef}
        className={`rq-sheet rq-sheet--${variant}${className ? ` ${className}` : ''}`}
        role='dialog'
        aria-modal='true'
        aria-label={label}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onRequestClose();
            return;
          }
          if (e.key !== 'Tab' || !sheetRef.current) return;
          if (!isTopSheet(sheetRef.current)) return;
          const focusable = focusableElements(sheetRef.current);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first || !last) {
            e.preventDefault();
            return;
          }
          if (document.activeElement === sheetRef.current || (e.shiftKey && document.activeElement === first)) {
            e.preventDefault();
            (e.shiftKey ? last : first).focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
        onTouchStart={swipe.onTouchStart}
        onTouchMove={swipe.onTouchMove}
        onTouchEnd={swipe.onTouchEnd}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
