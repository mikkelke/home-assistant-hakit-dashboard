import { describe, expect, it } from 'vitest';
import { dishwasherSupportsExpress } from '../dishwasherSemanticState';

describe('dishwasherSupportsExpress', () => {
  it('is offered for ECO and QuickPowerWash', () => {
    expect(dishwasherSupportsExpress('ECO')).toBe(true);
    expect(dishwasherSupportsExpress('QuickPowerWash')).toBe(true);
  });

  it('is not offered for the other programmes or with none picked', () => {
    for (const label of ['Auto', 'Gentle', 'Intensive', '—', '', undefined, null]) {
      expect(dishwasherSupportsExpress(label)).toBe(false);
    }
  });
});
