import { describe, expect, it } from 'vitest';
import { HOUSEHOLD, phonePlayerOf } from '../household';

describe('phone player', () => {
  it("resolves a viewer's phone from their HA user name, ignoring case and padding", () => {
    expect(phonePlayerOf('Mikkel')).toBe('media_player.mikkels_phone');
    expect(phonePlayerOf('  mikkel ')).toBe('media_player.mikkels_phone');
    for (const member of HOUSEHOLD) expect(phonePlayerOf(member.name)).toBe(member.phonePlayerEntityId);
  });

  it('has none for a stranger or a viewer still resolving', () => {
    expect(phonePlayerOf('Guest')).toBeUndefined();
    expect(phonePlayerOf('')).toBeUndefined();
    expect(phonePlayerOf(null)).toBeUndefined();
  });
});
