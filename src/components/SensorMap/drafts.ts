import { DOC_KEYS, PARSE, type DocKey, type Draft } from '../../sensorMap/saveQueue';

const slot = (key: DocKey) => `sensormap-draft-v1:${key}`;

/** Storage can be blocked or full; a draft that cannot be kept is simply not kept. */
function quietly<T>(work: () => T, otherwise: T): T {
  try {
    return work();
  } catch {
    return otherwise;
  }
}

/** Documents Home Assistant never acknowledged, kept in this browser until the next visit offers them back. */
export const browserDrafts = {
  save: (key: DocKey, base: string | null, doc: unknown) =>
    quietly(() => window.localStorage.setItem(slot(key), JSON.stringify({ base, savedAt: new Date().toISOString(), doc })), undefined),
  clear: (key: DocKey) => quietly(() => window.localStorage.removeItem(slot(key)), undefined),
};

export const findDrafts = (): Draft[] =>
  DOC_KEYS.flatMap(key =>
    quietly(() => {
      const kept = JSON.parse(window.localStorage.getItem(slot(key)) ?? 'null');
      return kept ? [{ key, base: kept.base ?? null, savedAt: String(kept.savedAt), doc: PARSE[key](kept.doc) }] : [];
    }, [])
  );
