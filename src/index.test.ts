import { describe, expect, it } from 'vitest';
import { getRadiationEstimate } from './index';

describe('getRadiationEstimate', () => {
  it('is not implemented yet (placeholder so CI has something to run)', () => {
    expect(() => getRadiationEstimate({ lat: 37.5, lng: 127.0, tier: 1 })).toThrow();
  });
});
