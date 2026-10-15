import type { FingerprintWifi, WifiMiss } from '../../sensorMap/mapDoc';
import type { WifiReady } from '../../sensorMap/wifi';

export const MISS_TEXT: Record<WifiMiss, string> = {
  not_captured: 'Wi-Fi was not captured for this fingerprint',
  no_entity: 'the Wi-Fi sensors are not enabled in the Companion app',
  unavailable: 'the sensor reports no value',
  invalid: 'the sensor reported something that is not a Wi-Fi value',
  roamed: 'the phone moved to another access point during the window',
  command_failed: 'the update command failed and no reading came',
  stale: 'no new reading arrived inside the window',
};

/** Android hides the BSSID from an app that may not read the location, and the app then reports a placeholder. */
const BSSID_HIDDEN = 'the app could not read it, usually because Android withholds the BSSID without location permission';

/** Why a field of a capture is missing, with the one reason that has a likelier cause for the BSSID than for the others. */
export const missText = (field: 'dbm' | 'bssid' | 'freq', reason: WifiMiss): string =>
  field === 'bssid' && reason === 'invalid' ? BSSID_HIDDEN : MISS_TEXT[reason];

export const READY_TEXT: Record<WifiReady, string> = {
  none: 'No Wi-Fi source set up',
  missing: 'Wi-Fi sensors are off in the app',
  offline: 'Wi-Fi sensors report nothing',
  ready: 'Wi-Fi ready',
};

export const bandText = (band: FingerprintWifi['band']): string => (band ? `${band} GHz` : 'band unknown');

/** One line about what a capture caught of Wi-Fi: the strength, the band and the access point, or why there is none. */
export function wifiLine(wifi: FingerprintWifi, apName: string | null): string {
  if (wifi.dbm === null) return `no Wi-Fi, ${MISS_TEXT[wifi.miss.dbm ?? 'stale']}`;
  return [`${wifi.dbm} dBm`, wifi.band ? bandText(wifi.band) : null, apName].filter(Boolean).join(', ');
}

/** What to tell the person after a survey capture: what it caught, or why it caught no Wi-Fi and what to do. */
export function resultText(
  label: string,
  wifi: FingerprintWifi,
  apName: string | null,
  error: string | null
): { text: string; ok: boolean } {
  if (wifi.dbm !== null) {
    const noBssid = wifi.bssid === null && wifi.miss.bssid ? ` No BSSID: ${missText('bssid', wifi.miss.bssid)}.` : '';
    return { text: `${label} saved: ${wifiLine(wifi, apName)}.${noBssid}`, ok: noBssid === '' };
  }
  const why = MISS_TEXT[wifi.miss.dbm ?? 'stale'];
  return { text: `${label} saved without Wi-Fi: ${why}${error ? ` (${error})` : ''}. Tap the point to capture it again.`, ok: false };
}

/** The text of the chip that opens the setup sheet, or null when no setup is waiting. */
export function setupLabel(kinds: readonly ('wifi' | 'phone')[]): string | null {
  if (kinds.length === 0) return null;
  if (kinds.every(kind => kind === 'wifi')) return 'Wi-Fi setup suggested';
  if (kinds.every(kind => kind === 'phone')) return 'Phone suggested';
  return 'Setup suggested';
}
