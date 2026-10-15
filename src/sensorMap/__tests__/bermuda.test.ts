import { describe, expect, it } from 'vitest';
import { dumpOf, dumpRequest, parseDump } from '../bermuda';

const response = {
  'test-beacon-address': {
    name: 'Tester',
    area_id: 'alpha_area',
    adverts: {
      'test-beacon-address__00:00:5e:00:53:01': {
        scanner_address: '00:00:5e:00:53:01',
        stamp: 100.5,
        rssi: -61,
        rssi_distance: 2.5,
        rssi_distance_raw: 2.1,
      },
      'test-beacon-address__00:00:5e:00:53:02': {
        scanner_address: '00:00:5E:00:53:02',
        stamp: 99,
        rssi: -70,
        rssi_distance: 6,
        rssi_distance_raw: null,
      },
      'other-key__00:00:5e:00:53:02': { scanner_address: '00:00:5e:00:53:02', stamp: 101, rssi: -68, rssi_distance_raw: '4.2' },
      'broken-1': { scanner_address: '00:00:5e:00:53:03', stamp: 'later', rssi: -50 },
      'broken-2': { stamp: 5, rssi: -50 },
      'broken-3': 'nothing',
    },
  },
  'no-area': { area_id: '', adverts: {} },
  'no-adverts': { area_id: 'alpha_area' },
  skipped: 'not a device',
};

describe('reading a Bermuda dump', () => {
  const dump = parseDump(response);

  it('keys devices by lowercase address and finds them without regard to case', () => {
    expect(Object.keys(dump).sort()).toEqual(['no-adverts', 'no-area', 'test-beacon-address']);
    expect(dumpOf(dump, 'TEST-BEACON-ADDRESS')?.areaId).toBe('alpha_area');
    expect(dumpOf(dump, 'missing')).toBeNull();
  });

  it('keeps one advert per scanner, the newest, under the scanner address in capitals', () => {
    const adverts = dumpOf(dump, 'test-beacon-address')?.adverts ?? [];
    expect(adverts.map(a => a.scanner).sort()).toEqual(['00:00:5E:00:53:01', '00:00:5E:00:53:02']);
    const second = adverts.find(a => a.scanner === '00:00:5E:00:53:02');
    expect(second).toEqual({ scanner: '00:00:5E:00:53:02', stamp: 101, rssi: -68, dist: null });
  });

  it('takes the distance of the single sample, and stores one that is missing or not a number as null', () => {
    const adverts = dumpOf(dump, 'test-beacon-address')?.adverts ?? [];
    expect(adverts.find(a => a.scanner === '00:00:5E:00:53:01')?.dist).toBe(2.1);
    expect(adverts.find(a => a.scanner === '00:00:5E:00:53:02')?.dist).toBeNull();
  });

  it('skips adverts without a numeric stamp or a scanner', () => {
    expect(dumpOf(dump, 'test-beacon-address')?.adverts.some(a => a.scanner === '00:00:5E:00:53:03')).toBe(false);
  });

  it('has no area for an empty or missing one, and no adverts for a device without them', () => {
    expect(dumpOf(dump, 'no-area')).toMatchObject({ areaId: null, adverts: [] });
    expect(dumpOf(dump, 'no-adverts')).toMatchObject({ areaId: 'alpha_area', adverts: [] });
  });

  it('survives an answer that is not a dump', () => {
    expect(parseDump(null)).toEqual({});
    expect(parseDump([])).toEqual({});
    expect(parseDump('x')).toEqual({});
  });
});

describe('the dump request', () => {
  it('never asks with an empty address list, which Bermuda answers with every device it has seen', () => {
    expect(dumpRequest([])).toBeNull();
    expect(dumpRequest(['', '  '])).toBeNull();
  });

  it('joins the addresses and turns redaction and the configured device list off', () => {
    expect(dumpRequest([' addr-one ', 'addr-two'])).toEqual({ addresses: 'addr-one addr-two', redact: false, configured_devices: false });
  });
});
