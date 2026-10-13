// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTE_ADOPTED_EVENT } from '../../utils/navigation';
import { useCloseOnRouteAdopted, useModalBackButton } from '../useModalBackButton';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Sheet({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  useModalBackButton({ isOpen, onRequestClose: onClose, historyKey: 'sheet' });
  return null;
}

function OwnHistoryModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  useCloseOnRouteAdopted(isOpen, onClose);
  return null;
}

let root: Root;

beforeEach(() => {
  root = createRoot(document.createElement('div'));
});

afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
});

const adoptRoute = () => act(() => void window.dispatchEvent(new Event(ROUTE_ADOPTED_EVENT)));

describe('a route the dashboard follows from outside', () => {
  it('closes every open sheet in place, without going back over the new entry', () => {
    const back = vi.spyOn(window.history, 'back');
    const first = vi.fn();
    const second = vi.fn();
    act(() =>
      root.render([
        createElement(Sheet, { key: 'a', isOpen: true, onClose: first }),
        createElement(Sheet, { key: 'b', isOpen: true, onClose: second }),
      ])
    );

    adoptRoute();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });

  it('closes a modal that keeps its own history, and leaves closed ones alone', () => {
    const back = vi.spyOn(window.history, 'back');
    const open = vi.fn();
    const closed = vi.fn();
    act(() =>
      root.render([
        createElement(OwnHistoryModal, { key: 'open', isOpen: true, onClose: open }),
        createElement(OwnHistoryModal, { key: 'closed', isOpen: false, onClose: closed }),
        createElement(Sheet, { key: 'sheet', isOpen: false, onClose: closed }),
      ])
    );

    adoptRoute();
    expect(open).toHaveBeenCalledTimes(1);
    expect(closed).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });
});
