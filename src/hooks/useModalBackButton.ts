import { useCallback, useEffect, useRef } from 'react';
import { getAccessibleHistoryWindow, getHistoryUrl } from '../utils/navigation';

interface UseModalBackButtonOptions {
  isOpen: boolean;
  onRequestClose: () => void;
  historyKey: string;
}

let modalInstanceCount = 0;
let bodyLockCount = 0;
const modalStack: string[] = [];

function getNextModalInstanceId() {
  modalInstanceCount += 1;
  return `modal-${modalInstanceCount}`;
}

function pushModalToStack(stackId: string) {
  modalStack.push(stackId);
}

function removeModalFromStack(stackId: string) {
  const index = modalStack.lastIndexOf(stackId);
  if (index >= 0) {
    modalStack.splice(index, 1);
  }
}

function isTopmostModal(stackId: string) {
  return modalStack[modalStack.length - 1] === stackId;
}

function lockModalBody() {
  if (typeof document === 'undefined') return;
  bodyLockCount += 1;
  if (bodyLockCount === 1) {
    document.body.classList.add('modal-open');
  }
}

function unlockModalBody() {
  if (typeof document === 'undefined') return;
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0) {
    document.body.classList.remove('modal-open');
  }
}

export function useModalBackButton({ isOpen, onRequestClose, historyKey }: UseModalBackButtonOptions) {
  const onRequestCloseRef = useRef(onRequestClose);
  const instanceIdRef = useRef<string | null>(null);

  if (instanceIdRef.current == null) {
    instanceIdRef.current = getNextModalInstanceId();
  }

  useEffect(() => {
    onRequestCloseRef.current = onRequestClose;
  }, [onRequestClose]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;

    const targetWindow = getAccessibleHistoryWindow();
    if (!targetWindow) return;

    const stackId = `${historyKey}:${instanceIdRef.current}`;
    pushModalToStack(stackId);
    lockModalBody();

    try {
      targetWindow.history.pushState({ modal: historyKey }, '', getHistoryUrl(targetWindow));
    } catch {
      // Ignore history API failures in limited WebView contexts.
    }

    const handleModalBack = (event: Event) => {
      if (!isTopmostModal(stackId)) return;
      event.preventDefault();
      onRequestCloseRef.current();
    };

    window.addEventListener('modalBackButton', handleModalBack);

    return () => {
      window.removeEventListener('modalBackButton', handleModalBack);
      removeModalFromStack(stackId);
      unlockModalBody();
    };
  }, [historyKey, isOpen]);

  const requestClose = useCallback(() => {
    if (!isOpen) return;

    const targetWindow = getAccessibleHistoryWindow();
    if (targetWindow) {
      try {
        targetWindow.history.back();
        return;
      } catch {
        // Fall back to local state close below.
      }
    }

    onRequestCloseRef.current();
  }, [isOpen]);

  return { requestClose };
}
