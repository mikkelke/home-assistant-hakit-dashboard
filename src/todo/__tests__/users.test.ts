import { describe, expect, it } from 'vitest';
import { TABLET_LABEL, shareableUsers } from '../users';

const user = (name: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${name.toLowerCase()}`,
  name,
  username: name.toLowerCase(),
  is_owner: false,
  is_active: true,
  system_generated: false,
  group_ids: ['system-users'],
  ...extra,
});

describe('the people a list can be shown to', () => {
  const reply = [
    user('Mikkel', { is_owner: true, group_ids: ['system-admin'] }),
    user('Kristine'),
    user('Claudia'),
    user('Rooftop'),
    user('AppDaemon'),
    user('NodeRed'),
    user('Supervisor', { system_generated: true }),
    user('Former', { is_active: false }),
  ];

  it('are the active users of people and devices, without the administrator themself and the service accounts', () => {
    const users = shareableUsers(reply, 'id-mikkel');
    expect(users.map(u => u.id)).toEqual(['id-claudia', 'id-kristine', 'id-rooftop']);
  });

  it('call the kitchen tablet Tablet', () => {
    expect(shareableUsers(reply, 'id-mikkel').map(u => u.label)).toEqual(['Claudia', 'Kristine', TABLET_LABEL]);
    expect(TABLET_LABEL).toBe('Tablet');
  });

  it('are kept apart from the service accounts whatever their capitals and spaces', () => {
    const accounts = [user('appdaemon'), user(' NodeRed '), user('NODERED'), user('Node Red')];
    expect(shareableUsers(accounts, null).map(u => u.label)).toEqual(['Node Red']);
  });

  it('leave out nobody but the viewer when the viewer is unknown', () => {
    expect(shareableUsers(reply, null).map(u => u.label)).toEqual(['Claudia', 'Kristine', 'Mikkel', TABLET_LABEL]);
  });

  it('leave out a user with no id, no name or no active flag', () => {
    const odd = [{ ...user('A'), id: '' }, { ...user('B'), name: ' ' }, { ...user('C'), is_active: undefined }, 5, null, user('D')];
    expect(shareableUsers(odd, null).map(u => u.label)).toEqual(['D']);
  });

  it('are none for a reply that is not a list', () => {
    for (const bad of [null, undefined, {}, 'users']) expect(shareableUsers(bad, null)).toEqual([]);
  });
});
