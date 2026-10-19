import { describe, expect, it, vi } from 'vitest';

vi.mock('@hakit/core', () => ({ useHass: { getState: () => ({ connection: null }) } }));

const { coffeeCommandMessage, sendCoffeeCommand } = await import('../command');

describe('coffee commands', () => {
  it('run script.coffee_command with the op and its data as JSON text', () => {
    expect(coffeeCommandMessage('rate', { brew_id: 'c1792991000', taste: 'sour' })).toEqual({
      type: 'call_service',
      domain: 'script',
      service: 'coffee_command',
      service_data: { op: 'rate', data: '{"brew_id":"c1792991000","taste":"sour"}' },
    });
    expect(coffeeCommandMessage('stop', {}).service_data).toEqual({ op: 'stop', data: '{}' });
  });

  it('never fire an event, which only an admin may', async () => {
    const send = vi.fn(() => Promise.resolve(null));
    await sendCoffeeCommand('start', { variant: 'tweak', grind_size: 44 }, send);
    expect(send).toHaveBeenCalledTimes(1);
    const message = (send.mock.calls[0] as unknown[])[0] as { type: string; service_data: { data: string } };
    expect(message.type).toBe('call_service');
    expect(JSON.parse(message.service_data.data)).toEqual({ variant: 'tweak', grind_size: 44 });
  });

  it('reject when HA refuses, so a caller can show it', async () => {
    const send = vi.fn(() => Promise.reject(new Error('Unable to find service script.coffee_command')));
    await expect(sendCoffeeCommand('connect', {}, send)).rejects.toThrow('script.coffee_command');
  });

  it('reject without a connection', async () => {
    await expect(sendCoffeeCommand('connect', {})).rejects.toThrow('Not connected');
  });
});
