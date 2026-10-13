/** A level this card sent for a speaker that HA has not settled on yet. `seen` is every level HA may still report on
 *  the way there (the one before the first send plus each send), which tells an echo of our own writes from something
 *  else moving the speaker. */
export type SentVolume = { value: number; seen: number[] };

/** Levels HA may report for a level sent as volume_level / 100: Music Assistant truncates, so 29 comes back as 28. */
const reportedLevels = (pct: number): number[] => [pct, Math.trunc((pct / 100) * 100)];

export const isUnsettled = (sent: SentVolume | undefined, live: number): sent is SentVolume =>
  sent !== undefined && sent.seen.includes(live) && !reportedLevels(sent.value).includes(live);

/** Where a speaker is heading while HA still catches up, otherwise where it really is. */
export const runningVolume = (sent: SentVolume | undefined, live: number): number => (isUnsettled(sent, live) ? sent.value : live);

export const sendVolume = (sent: SentVolume | undefined, live: number, next: number): SentVolume => ({
  value: next,
  seen: [...(isUnsettled(sent, live) ? sent.seen : [live]), ...reportedLevels(next)],
});
