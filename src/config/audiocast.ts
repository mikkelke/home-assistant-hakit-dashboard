// "Audiocast": a Chromecast Audio wired into the line-in of one Sonos speaker.
// Any room can pull that speaker's line-in with the x-rincon-stream URI below,
// so the Audiocast input works from every room's source picker.
//
// If the Chromecast Audio moves to another speaker's line-in, update the RINCON
// (HA: Sonos device page identifiers, or media_content_id while line-in plays).
export const AUDIOCAST_STREAM_URI = 'x-rincon-stream:RINCON_804AF2CB391401400'; // Kristines room Era 100

// media_player entities whose raw-Sonos sibling does not follow the `${id}_2`
// convention (empty today; add entries if a speaker is renamed in HA without
// its raw Sonos twin following).
const RAW_SONOS_ENTITY_OVERRIDES: Record<string, string> = {};

// Raw Sonos integration entity for a base (Music Assistant) media_player id.
export function rawSonosEntityId(baseId: string): string {
  return RAW_SONOS_ENTITY_OVERRIDES[baseId] ?? `${baseId}_2`;
}
