// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPEN_ROOM_EVENT, requestOpenRoom, type OpenRoomRequest } from '../navigation';

describe('requestOpenRoom', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tells the dashboard's window which room to open and where in it to scroll", () => {
    const seen: OpenRoomRequest[] = [];
    const listener = (event: Event) => seen.push((event as CustomEvent<OpenRoomRequest>).detail);
    window.addEventListener(OPEN_ROOM_EVENT, listener);
    requestOpenRoom({ areaId: 'rooftop', section: 'terrace' });
    requestOpenRoom({ areaId: 'kitchen' });
    window.removeEventListener(OPEN_ROOM_EVENT, listener);
    expect(seen).toEqual([{ areaId: 'rooftop', section: 'terrace' }, { areaId: 'kitchen' }]);
  });

  it('does nothing without a window', () => {
    vi.stubGlobal('window', undefined);
    expect(() => requestOpenRoom({ areaId: 'rooftop' })).not.toThrow();
    vi.unstubAllGlobals();
  });
});
