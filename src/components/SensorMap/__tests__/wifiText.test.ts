import { describe, expect, it } from 'vitest';
import { noWifi, type FingerprintWifi } from '../../../sensorMap/mapDoc';
import { MISS_TEXT, READY_TEXT, bandText, missText, resultText, wifiLine } from '../wifiText';

const caught = (partial: Partial<FingerprintWifi> = {}): FingerprintWifi => ({
  dbm: -62,
  readings: [{ dbm: -62, at: '2030-01-01T10:00:00.000Z' }],
  bssid: '02:00:5e:10:00:0a',
  freq_mhz: 5180,
  band: '5',
  at: '2030-01-01T10:00:00.000Z',
  miss: {},
  ...partial,
});

describe('what the page says about a capture', () => {
  it('has words for every reason a field can be missing, and for every state the sensors can be in', () => {
    for (const reason of Object.keys(MISS_TEXT)) expect(MISS_TEXT[reason as keyof typeof MISS_TEXT].length).toBeGreaterThan(10);
    expect(Object.keys(READY_TEXT).sort()).toEqual(['missing', 'none', 'offline', 'ready']);
  });

  it('names the band, or says it is not known', () => {
    expect([bandText('2.4'), bandText('5'), bandText('6'), bandText(null)]).toEqual(['2.4 GHz', '5 GHz', '6 GHz', 'band unknown']);
  });

  it('gives the strength, band and access point of a capture in one line, or why there is none', () => {
    expect(wifiLine(caught(), 'AP One')).toBe('-62 dBm, 5 GHz, AP One');
    expect(wifiLine(caught({ band: null }), null)).toBe('-62 dBm');
    expect(wifiLine(noWifi('stale'), null)).toBe('no Wi-Fi, no new reading arrived inside the window');
  });

  it('points at the location permission when the BSSID is the placeholder Android gives', () => {
    expect(missText('bssid', 'invalid')).toContain('location permission');
    expect(missText('dbm', 'invalid')).toBe(MISS_TEXT.invalid);
    expect(missText('freq', 'stale')).toBe(MISS_TEXT.stale);
  });

  it('tells the person a capture was saved, and what it caught', () => {
    expect(resultText('Point 3', caught(), 'AP One', null)).toEqual({ text: 'Point 3 saved: -62 dBm, 5 GHz, AP One.', ok: true });
  });

  it('says so when a reading came without a BSSID, since the access point is then unknown', () => {
    const result = resultText('Point 3', caught({ bssid: null, miss: { bssid: 'invalid' } }), null, null);
    expect(result.ok).toBe(false);
    expect(result.text).toContain('Point 3 saved: -62 dBm, 5 GHz. No BSSID: the app could not read it');
  });

  it('says why nothing was caught, with the failure of the command when there was one, and what to do', () => {
    expect(resultText('Point 4', noWifi('stale'), null, null)).toEqual({
      text: 'Point 4 saved without Wi-Fi: no new reading arrived inside the window. Tap the point to capture it again.',
      ok: false,
    });
    const failed = { ...noWifi('command_failed') };
    expect(resultText('Point 4', failed, null, 'no such service').text).toContain(
      'the update command failed and no reading came (no such service)'
    );
  });
});
