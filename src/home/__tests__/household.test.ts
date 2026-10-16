import { describe, expect, it } from 'vitest';
import { availablePhonePlayer, HOUSEHOLD, isPhonePlayer, phonePlayerOf, type StateReader } from '../household';

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

describe("the viewer's own phone in the media list", () => {
  const MIKKELS = 'media_player.mikkels_phone';
  const states =
    (known: Record<string, string>): StateReader =>
    entityId =>
      known[entityId];

  it('is the phone of the viewer, while its player exists and is not unavailable', () => {
    expect(availablePhonePlayer('Mikkel', states({ [MIKKELS]: 'playing' }))).toBe(MIKKELS);
    expect(availablePhonePlayer('  mikkel ', states({ [MIKKELS]: 'idle' }))).toBe(MIKKELS);
  });

  it('is nothing while the player is missing or the app is closed', () => {
    expect(availablePhonePlayer('Mikkel', states({}))).toBeUndefined();
    expect(availablePhonePlayer('Mikkel', states({ [MIKKELS]: 'unavailable' }))).toBeUndefined();
  });

  it("is never another member's phone, however many phone players exist", () => {
    const everyone = states({ [MIKKELS]: 'playing', 'media_player.kristines_phone': 'playing', 'media_player.claudias_phone': 'playing' });
    expect(availablePhonePlayer('Kristine', everyone)).toBeUndefined();
    expect(availablePhonePlayer('Claudia', everyone)).toBeUndefined();
    expect(availablePhonePlayer('Guest', everyone)).toBeUndefined();
  });

  it('is nothing for a viewer still resolving', () => {
    const everyone = states({ [MIKKELS]: 'playing' });
    expect(availablePhonePlayer(null, everyone)).toBeUndefined();
    expect(availablePhonePlayer(undefined, everyone)).toBeUndefined();
    expect(availablePhonePlayer('', everyone)).toBeUndefined();
  });

  it('knows which entities are phone players', () => {
    expect(isPhonePlayer(MIKKELS)).toBe(true);
    expect(isPhonePlayer('media_player.kitchen')).toBe(false);
    expect(isPhonePlayer('')).toBe(false);
  });
});
