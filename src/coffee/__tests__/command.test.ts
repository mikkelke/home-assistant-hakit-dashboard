import { describe, expect, it, vi } from 'vitest';

vi.mock('@hakit/core', () => ({ useHass: { getState: () => ({ connection: null }) } }));

const { BEAN_NAME_MAX, cleanBeanName, coffeeCommandMessage, nameableBeans, sendCoffeeCommand } = await import('../command');

describe('coffee commands', () => {
  it('run script.coffee_command with the op and its data as JSON text', () => {
    expect(coffeeCommandMessage('rate', { brew_id: 'c1792991000', taste: 'sour' })).toEqual({
      type: 'call_service',
      domain: 'script',
      service: 'coffee_command',
      service_data: { op: 'rate', data: '{"brew_id":"c1792991000","taste":"sour"}' },
    });
    expect(coffeeCommandMessage('stop', {}).service_data).toEqual({ op: 'stop', data: '{}' });
    expect(coffeeCommandMessage('water_filled', {}).service_data).toEqual({ op: 'water_filled', data: '{}' });
  });

  it('never fire an event, which only an admin may', async () => {
    const send = vi.fn(() => Promise.resolve(null));
    await sendCoffeeCommand('start', { variant: 'tweak', grind_size: 44, temperature: 90 }, send);
    expect(send).toHaveBeenCalledTimes(1);
    const message = (send.mock.calls[0] as unknown[])[0] as { type: string; service_data: { data: string } };
    expect(message.type).toBe('call_service');
    expect(JSON.parse(message.service_data.data)).toEqual({ variant: 'tweak', grind_size: 44, temperature: 90 });
  });

  it('reject when HA refuses, so a caller can show it', async () => {
    const send = vi.fn(() => Promise.reject(new Error('Unable to find service script.coffee_command')));
    await expect(sendCoffeeCommand('connect', {}, send)).rejects.toThrow('script.coffee_command');
  });

  it('reject without a connection', async () => {
    await expect(sendCoffeeCommand('connect', {})).rejects.toThrow('Not connected');
  });
});

describe('a name for new beans', () => {
  it('is kept as the coffee app keeps it: ASCII only, white space collapsed, at most 40 characters', () => {
    expect(cleanBeanName('Guatemala')).toBe('Guatemala');
    expect(cleanBeanName('  Guatemala \t Huehue\n')).toBe('Guatemala Huehue');
    expect(cleanBeanName('Café Ethiopía')).toBe('Caf Ethiopa');
    expect(cleanBeanName('Kenya 😀 AA')).toBe('Kenya AA');
    expect(cleanBeanName('a'.repeat(45))).toBe('a'.repeat(BEAN_NAME_MAX));
    expect(cleanBeanName(`${'a'.repeat(39)} b`)).toBe('a'.repeat(39));
  });

  it('is empty when nothing of ASCII is left of it', () => {
    for (const name of ['', '   ', 'é', '日本語', '😀 😀']) expect(cleanBeanName(name), name).toBe('');
  });

  it('is nameable with a letter or a digit left, and not with only marks', () => {
    for (const name of ['a', 'Z', '7', 'Kenya AA', 'Caf']) expect(nameableBeans(name), name).toBe(true);
    for (const name of ['', ' ', '!!!', '-', '#?']) expect(nameableBeans(name), name).toBe(false);
    expect(nameableBeans(cleanBeanName('é-!'))).toBe(false);
  });
});
