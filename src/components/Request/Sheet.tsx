import { useEffect, useRef, type ReactNode, type TouchEventHandler } from 'react';
import { createPortal } from 'react-dom';

interface SheetProps {
  label: string;
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
export function Sheet({ label, variant, onRequestClose, swipe, children }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus({ preventScroll: true });
    return () => {
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className={`rq-overlay rq-overlay--${variant}`} onClick={onRequestClose}>
      <div
        ref={sheetRef}
        className={`rq-sheet rq-sheet--${variant}`}
        role='dialog'
        aria-modal='true'
        aria-label={label}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key !== 'Escape') return;
          e.stopPropagation();
          onRequestClose();
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
