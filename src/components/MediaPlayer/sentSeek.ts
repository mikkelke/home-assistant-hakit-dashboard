/** A seek this card sent, shown as sent while Home Assistant's player is still catching up with it. */
export type SentSeek = {
  /** Where the viewer let go, in seconds. */
  value: number;
  /** The state the card showed when it was sent. */
  state: string;
  /** The speaker and the media item it was sent for. */
  item: string;
  /** The position anchor (`media_position_updated_at`) the player reported when it was sent. */
  anchor: string | undefined;
  /** When it was sent, in epoch ms. */
  at: number;
};

/** Music Assistant stops the old stream and builds a new one for a seek, and answers within about two seconds. Until then it
 *  reports a shifted position, then a stopped player; a position reported earlier than this is not yet the one to trust. */
export const SEEK_SETTLE_MS = 3000;

/** A seek that Home Assistant never reports (failed, or the player went away) stops being shown after this. */
export const SEEK_GIVE_UP_MS = 10_000;

/** How far, in seconds, the reported position may be from the sought one and still count as it. */
const SEEK_AGREE_S = 2;

/** What Home Assistant reports about the player, as far as a seek is concerned. */
export type SeekLive = { item: string; anchor: string | undefined; position: number | undefined };

/** Whether the card still shows the sought position instead of the player's: from the send until the settle time has passed
 *  and the player reports a position near it, but never past the give-up time or onto another item. */
export const isSeekHeld = (sent: SentSeek, live: SeekLive, now: number): boolean => {
  const age = now - sent.at;
  if (live.item !== sent.item || age >= SEEK_GIVE_UP_MS) return false;
  const reported = live.anchor !== sent.anchor && live.position !== undefined && Math.abs(live.position - sent.value) <= SEEK_AGREE_S;
  return age < SEEK_SETTLE_MS || !reported;
};
