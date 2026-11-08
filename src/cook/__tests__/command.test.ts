import { describe, expect, it, vi } from 'vitest';

const demo = vi.hoisted(() => ({ mode: null as string | null }));
vi.mock('@hakit/core', () => ({ useHass: { getState: () => ({ connection: null }) } }));
vi.mock('../demoStore', () => ({ cookDemoMode: () => demo.mode }));
const { cookCommandMessage, sendCookCommand } = await import('../command');

describe('cooking commands', () => {
  it('calls the HA script with JSON data and preserves numbers', () => {
    expect(cookCommandMessage('bag_in', { minutes: 150 })).toEqual({
      type: 'call_service',
      domain: 'script',
      service: 'cook_command',
      service_data: { op: 'bag_in', data: '{"minutes":150}' },
    });
    expect(cookCommandMessage('probe_preset', { key: 'custom', serve: 55.5 }).service_data.data).toBe('{"key":"custom","serve":55.5}');
    expect(cookCommandMessage('bath_stop', {}).service_data.data).toBe('{}');
  });

  it('never sends a demo command to hardware', async () => {
    const send = vi.fn(() => Promise.resolve(null));
    demo.mode = 'pull';
    await sendCookCommand('bath_start', { target: 58 }, send);
    expect(send).not.toHaveBeenCalled();
    demo.mode = null;
    await sendCookCommand('silence', {}, send);
    expect(send).toHaveBeenCalledOnce();
  });

  it('rejects missing connections and HA errors for the UI to show', async () => {
    await expect(sendCookCommand('bath_stop', {})).rejects.toThrow('Not connected');
    await expect(sendCookCommand('bath_stop', {}, () => Promise.reject(new Error('HA rejected')))).rejects.toThrow('HA rejected');
    await expect(
      sendCookCommand('bath_stop', {}, () => {
        throw new Error('send failed');
      })
    ).rejects.toThrow('send failed');
  });
});
