import { describe, expect, it } from 'vitest';
import { groupOf } from '../speakers';

const FULL = [
  'media_player.living_room',
  'media_player.kitchen',
  'media_player.rooftop',
  'media_player.bathroom',
  'media_player.dining_room',
  'media_player.bedroom',
];
const STALE = ['media_player.living_room', 'media_player.kitchen', 'media_player.rooftop', 'media_player.dining_room'];

const house = {
  'media_player.living_room': { attributes: { group_members: FULL } },
  'media_player.kitchen': { attributes: { group_members: STALE } },
  'media_player.rooftop': { attributes: { group_members: [] } },
  'media_player.bedroom': { attributes: { group_members: FULL } },
  'media_player.claudias_room': { attributes: { group_members: [] } },
  'media_player.guest_bathroom': { attributes: { group_members: ['media_player.living_room', 'media_player.guest_bathroom'] } },
};

describe('groupOf', () => {
  it("gives every member the coordinator's list, whatever the member's own list says", () => {
    expect(groupOf(house, 'media_player.living_room')).toEqual(FULL);
    expect(groupOf(house, 'media_player.kitchen')).toEqual(FULL);
    expect(groupOf(house, 'media_player.rooftop')).toEqual(FULL);
  });

  it('leaves a speaker no coordinator lists on its own', () => {
    expect(groupOf(house, 'media_player.claudias_room')).toEqual(['media_player.claudias_room']);
    expect(groupOf(house, 'media_player.guest_bathroom')).toEqual(['media_player.guest_bathroom']);
    expect(groupOf(undefined, 'media_player.kitchen')).toEqual(['media_player.kitchen']);
  });
});
