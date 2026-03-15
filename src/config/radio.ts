// Radio station presets for Sonos
// Using direct stream URLs for Danish Radio

const DRP3Logo = new URL('../images/logo/DRP3.png', import.meta.url).href;
const DRP4Logo = new URL('../images/logo/DRP4.png', import.meta.url).href;

export interface RadioStation {
  id: string;
  name: string;
  // Direct stream URL or TuneIn ID
  mediaId: string;
  // "music" for streams
  mediaType: string;
  // Optional Music Assistant media-source ID (e.g., media-source://mediaassistant/...)
  maMediaId?: string;
  // Optional override for MA content type
  maMediaType?: string;
  // Station logo URL
  logo?: string;
  // Fallback icon if no logo
  icon?: string;
  // Brand color for styling
  color?: string;
}

// Danish Radio Stations (DR) - Direct HLS streams
export const RADIO_STATIONS: RadioStation[] = [
  {
    id: 'dr-p3',
    name: 'DR P3',
    mediaId: 'https://drliveradio.akamaized.net/hls/live/2022411/p3/playlist-320000.m3u8',
    mediaType: 'music',
    logo: DRP3Logo,
    color: '#6ee866', // P3 green
  },
  {
    id: 'dr-p4',
    name: 'DR P4',
    mediaId: 'https://drliveradio.akamaized.net/hls/live/2022411/p4kobenhavn/playlist-320000.m3u8',
    mediaType: 'music',
    logo: DRP4Logo,
    color: '#ff7f00', // P4 orange
  },
];

// To add more stations, use this format:
//
// TuneIn stations (use station ID from tunein.com URL):
// {
//   id: 'station-id',
//   name: 'Station Name',
//   mediaId: 's12345',  // TuneIn ID
//   mediaType: 'music',
//   icon: 'mdi:radio',
// }
//
// Direct stream URLs:
// {
//   id: 'station-id',
//   name: 'Station Name',
//   mediaId: 'https://stream.example.com/stream.m3u8',
//   mediaType: 'music',
//   logo: 'https://example.com/logo.png',
// }
