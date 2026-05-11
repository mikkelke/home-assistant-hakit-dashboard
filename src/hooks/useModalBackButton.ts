import { useCallback, useEffect, useRef } from 'react';

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
  const instanceIdRef = useRef<string>('');

  if (!instanceIdRef.current) {
    instanceIdRef.current = getNextModalInstanceId();
  }

  useEffect(() => {
    onRequestCloseRef.current = onRequestClose;
  }, [onRequestClose]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;

    const stackId = `${historyKey}:${instanceIdRef.current}`;
    pushModalToStack(stackId);
    lockModalBody();

    try {
      window.history.pushState({ modal: historyKey }, '', window.location.href);
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

    if (typeof window !== 'undefined') {
      try {
        window.history.back();
        return;
      } catch {
        // Fall back to local state close below.
      }
    }

    onRequestCloseRef.current();
  }, [isOpen]);

  return { requestClose };
}
