import { describe, expect, it } from 'vitest';
import { aerosolTransmittance, applyAerosolCorrection } from './aerosolCorrection';

describe('aerosolTransmittance', () => {
  it('is exactly 1 when AOD=0 (no aerosol, no attenuation)', () => {
    expect(aerosolTransmittance(0, 5)).toBe(1);
  });

  it('is exactly 1 when airmass=0 (exp(0)=1 identity)', () => {
    expect(aerosolTransmittance(0.3, 0)).toBe(1);
  });

  it('is guarded to 1 for a NaN AOD (no correction rather than NaN)', () => {
    expect(aerosolTransmittance(NaN, 2)).toBe(1);
  });

  it('is guarded to 1 for a NaN airmass (e.g. sun below horizon)', () => {
    expect(aerosolTransmittance(0.3, NaN)).toBe(1);
  });

  it('clamps a negative AOD to 0, matching the AOD=0 result', () => {
    expect(aerosolTransmittance(-0.5, 3)).toBe(aerosolTransmittance(0, 3));
  });

  it('decreases monotonically with increasing AOD', () => {
    let prev = aerosolTransmittance(0, 2);
    for (let aod = 0.05; aod <= 2; aod += 0.05) {
      const t = aerosolTransmittance(aod, 2);
      expect(t).toBeLessThan(prev);
      prev = t;
    }
  });

  it('decreases monotonically with increasing airmass', () => {
    let prev = aerosolTransmittance(0.3, 0);
    for (let m = 0.1; m <= 10; m += 0.1) {
      const t = aerosolTransmittance(0.3, m);
      expect(t).toBeLessThan(prev);
      prev = t;
    }
  });

  it('stays within (0, 1] for finite non-negative inputs', () => {
    for (const aod of [0, 0.1, 0.5, 1, 3, 10]) {
      for (const m of [0, 0.5, 1, 2, 5, 20]) {
        const t = aerosolTransmittance(aod, m);
        expect(t).toBeGreaterThan(0);
        expect(t).toBeLessThanOrEqual(1);
      }
    }
  });

  it('matches the closed-form Beer-Lambert identity exp(-tau*m) exactly', () => {
    for (const aod of [0.1, 0.4, 1.2]) {
      for (const m of [1, 2.5, 8]) {
        expect(Math.abs(aerosolTransmittance(aod, m) - Math.exp(-aod * m))).toBeLessThan(1e-12);
      }
    }
  });
});

describe('applyAerosolCorrection', () => {
  it('returns ghiCorrected=0 when ghi=0, regardless of AOD/airmass', () => {
    const r = applyAerosolCorrection({ ghi: 0, aerosolOpticalDepth: 0.5, relativeAirmass: 3 });
    expect(r.ghiCorrected).toBe(0);
  });

  it('never increases GHI (ghiCorrected <= ghi always)', () => {
    for (const ghi of [0, 50, 300, 900]) {
      for (const aod of [0, 0.2, 1, 3]) {
        for (const m of [0, 1, 3, 10]) {
          const r = applyAerosolCorrection({ ghi, aerosolOpticalDepth: aod, relativeAirmass: m });
          expect(r.ghiCorrected).toBeLessThanOrEqual(ghi + 1e-9);
        }
      }
    }
  });

  it('keeps ghiCorrected = ghi * transmittance exactly (internal consistency)', () => {
    const r = applyAerosolCorrection({ ghi: 623.4, aerosolOpticalDepth: 0.35, relativeAirmass: 1.8 });
    expect(Math.abs(r.ghiCorrected - 623.4 * r.transmittance)).toBeLessThan(1e-9);
  });

  it('leaves ghi unchanged when AOD=0 (identity, ties into the transposeToPOA golden test)', () => {
    const r = applyAerosolCorrection({ ghi: 741.2, aerosolOpticalDepth: 0, relativeAirmass: 2.1 });
    expect(r.ghiCorrected).toBe(741.2);
  });
});
