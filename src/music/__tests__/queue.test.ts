import { describe, expect, it } from 'vitest';
import { SONOS_SPEAKERS } from '../../config/speakers';
import type { HassEntities } from '../../types';
import { queueIdFor } from '../queue';

const speaker = (state: string, attributes: Record<string, unknown>) => ({ entity_id: '', state, attributes });

describe('the queue to play on', () => {
  it("is the one the speaker's entity reports", () => {
    const entities: HassEntities = { 'media_player.kitchen': speaker('playing', { active_queue: 'RINCON_ELSEWHERE' }) };
    expect(queueIdFor(entities, 'media_player.kitchen')).toBe('RINCON_ELSEWHERE');
  });

  it("is the speaker's own player when its entity reports no queue", () => {
    const kitchen = SONOS_SPEAKERS.find(s => s.id === 'media_player.kitchen')?.maPlayerId;
    expect(kitchen).toBe('RINCON_F0F6C1A525A201400');
    expect(queueIdFor({ 'media_player.kitchen': speaker('idle', { active_queue: null }) }, 'media_player.kitchen')).toBe(kitchen);
    expect(queueIdFor({ 'media_player.kitchen': speaker('idle', { active_queue: '' }) }, 'media_player.kitchen')).toBe(kitchen);
    expect(queueIdFor({ 'media_player.kitchen': speaker('idle', {}) }, 'media_player.kitchen')).toBe(kitchen);
  });

  it("is the speaker's own player while its entity is missing", () => {
    expect(queueIdFor({}, 'media_player.rooftop')).toBe('RINCON_74CA6021706E01400');
    expect(queueIdFor(undefined, 'media_player.rooftop')).toBe('RINCON_74CA6021706E01400');
  });

  it('is nothing for a speaker that is not configured and reports no queue', () => {
    expect(queueIdFor({}, 'media_player.garage')).toBeNull();
    expect(queueIdFor({ 'media_player.garage': speaker('idle', { active_queue: 7 }) }, 'media_player.garage')).toBeNull();
  });
});

describe('the configured speakers', () => {
  it('each have their own Music Assistant player id', () => {
    const ids = SONOS_SPEAKERS.map(s => s.maPlayerId);
    expect(ids.every(id => typeof id === 'string' && /^RINCON_[0-9A-F]+$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(SONOS_SPEAKERS.length);
  });
});
