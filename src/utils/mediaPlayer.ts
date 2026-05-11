import type { HassEntities, HassEntity } from '../types';

export interface ResolvedMediaPlayer {
  entityId: string;
  entity: HassEntity | undefined;
  maEntityId: string;
  maEntity: HassEntity | undefined;
  sonosEntityId: string;
  sonosEntity: HassEntity | undefined;
}

function normalizeBaseEntityId(entityId: string): string {
  return entityId.endsWith('_2') ? entityId.slice(0, -2) : entityId;
}

function getMediaPlayerPair(entities: HassEntities | undefined, entityId: string) {
  const maEntityId = normalizeBaseEntityId(entityId);
  const sonosEntityId = `${maEntityId}_2`;
  const maEntity = entities?.[maEntityId];
  const sonosEntity = entities?.[sonosEntityId];

  return {
    maEntityId,
    maEntity,
    sonosEntityId,
    sonosEntity,
  };
}

function getGroupSize(entity: HassEntity | undefined): number {
  const rawMembers = entity?.attributes?.group_members;
  if (!Array.isArray(rawMembers)) return 0;
  return rawMembers.filter((member): member is string => typeof member === 'string' && member.length > 0).length;
}

function hasMediaContext(entity: HassEntity | undefined): boolean {
  if (!entity) return false;

  const mediaTitle = entity.attributes?.media_title;
  const mediaArtist = entity.attributes?.media_artist;
  const mediaContentId = entity.attributes?.media_content_id;
  const source = entity.attributes?.source;

  return (
    (typeof mediaTitle === 'string' && mediaTitle.trim() !== '' && mediaTitle !== 'Not playing') ||
    (typeof mediaArtist === 'string' && mediaArtist.trim() !== '') ||
    (typeof mediaContentId === 'string' && mediaContentId.trim() !== '') ||
    (typeof source === 'string' && source.trim() !== '')
  );
}

function getEntityScore(entity: HassEntity | undefined): number {
  if (!entity) return Number.NEGATIVE_INFINITY;

  let score = 0;

  switch (entity.state) {
    case 'playing':
      score += 100;
      break;
    case 'buffering':
      score += 85;
      break;
    case 'paused':
      score += 70;
      break;
    case 'idle':
      score += 35;
      break;
    case 'on':
      score += 20;
      break;
    case 'off':
    case 'standby':
      score += 5;
      break;
    case 'unavailable':
    case 'unknown':
      score -= 25;
      break;
    default:
      break;
  }

  const groupSize = getGroupSize(entity);
  if (groupSize > 1) score += 15 + groupSize;
  if (hasMediaContext(entity)) score += 10;

  return score;
}

export function resolvePreferredMediaPlayer(entities: HassEntities | undefined, entityId: string): ResolvedMediaPlayer {
  const { maEntityId, maEntity, sonosEntityId, sonosEntity } = getMediaPlayerPair(entities, entityId);

  if (!maEntity && !sonosEntity) {
    return {
      entityId: maEntityId,
      entity: undefined,
      maEntityId,
      maEntity,
      sonosEntityId,
      sonosEntity,
    };
  }

  if (!maEntity) {
    return {
      entityId: sonosEntityId,
      entity: sonosEntity,
      maEntityId,
      maEntity,
      sonosEntityId,
      sonosEntity,
    };
  }

  if (!sonosEntity) {
    return {
      entityId: maEntityId,
      entity: maEntity,
      maEntityId,
      maEntity,
      sonosEntityId,
      sonosEntity,
    };
  }

  const maScore = getEntityScore(maEntity);
  const sonosScore = getEntityScore(sonosEntity);
  const preferSonos = sonosScore > maScore;

  return {
    entityId: preferSonos ? sonosEntityId : maEntityId,
    entity: preferSonos ? sonosEntity : maEntity,
    maEntityId,
    maEntity,
    sonosEntityId,
    sonosEntity,
  };
}

export function isMediaPlayerOutOfSync(entities: HassEntities | undefined, entityId: string): boolean {
  const { maEntity, sonosEntity } = getMediaPlayerPair(entities, entityId);

  if (!maEntity || !sonosEntity) return false;
  if (maEntity.state === sonosEntity.state) return false;

  if (maEntity.state === 'playing' && sonosEntity.state !== 'playing') return true;
  if (sonosEntity.state === 'playing' && maEntity.state !== 'playing') return true;
  if (maEntity.state === 'paused' && sonosEntity.state === 'playing') return true;
  if (sonosEntity.state === 'paused' && maEntity.state === 'playing') return true;

  return false;
}
