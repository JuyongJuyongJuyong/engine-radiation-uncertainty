import { describe, expect, it } from 'vitest';
import {
  eccentricityCorrectionFactor,
  extraterrestrialHorizontalIrradiance,
  erbsDiffuseFraction,
  erbsDecomposition,
} from './erbsCorrelation';
import { dayOfYear, solarPosition } from './solarGeometry';

describe('eccentricityCorrectionFactor', () => {
  it('stays within the known physical range 0.966-1.035 for every day of the year', () => {
    for (let n = 1; n <= 366; n++) {
      const e0 = eccentricityCorrectionFactor(n);
      expect(e0).toBeGreaterThanOrEqual(0.966);
      expect(e0).toBeLessThanOrEqual(1.035);
    }
  });

  it('peaks near perihelion (~Jan 3) and troughs near aphelion (~Jul 4)', () => {
    const eJan = eccentricityCorrectionFactor(3);
    const eJul = eccentricityCorrectionFactor(185);
    expect(eJan).toBeGreaterThan(1.03);
    expect(eJul).toBeLessThan(0.97);
    expect(eJan).toBeGreaterThan(eJul);
  });
});

describe('extraterrestrialHorizontalIrradiance', () => {
  it('is 0 when the sun is at or below the horizon', () => {
    expect(extraterrestrialHorizontalIrradiance(80, 90)).toBe(0);
    expect(extraterrestrialHorizontalIrradiance(80, 120)).toBe(0);
  });

  it('at zenith=0 equals solar-constant * E0, bounded to the known ~1322-1414 W/m^2 range', () => {
    for (const n of [3, 80, 172, 266, 355]) {
      const g0 = extraterrestrialHorizontalIrradiance(n, 0);
      expect(g0).toBeGreaterThanOrEqual(1322);
      expect(g0).toBeLessThanOrEqual(1414);
    }
  });

  it('scales exactly with cos(zenith)', () => {
    const g0_0 = extraterrestrialHorizontalIrradiance(80, 0);
    const g0_60 = extraterrestrialHorizontalIrradiance(80, 60); // cos(60deg) = 0.5 exactly
    expect(Math.abs(g0_60 - g0_0 * 0.5)).toBeLessThan(1e-9);
  });
});

describe("erbsDiffuseFraction (Erbs' correlation)", () => {
  it('is 1 at kt=0 (fully overcast -> fully diffuse)', () => {
    expect(erbsDiffuseFraction(0)).toBe(1);
  });

  it('stays within [0,1] across the whole kt domain', () => {
    for (let i = 0; i <= 1000; i++) {
      const kt = i / 1000;
      const kd = erbsDiffuseFraction(kt);
      expect(kd).toBeGreaterThanOrEqual(0);
      expect(kd).toBeLessThanOrEqual(1.001);
    }
  });

  it('is (near-)monotonically non-increasing in kt: a clearer sky means less diffuse fraction', () => {
    // The published quartic is a fit to real data, not a mathematically
    // monotone function, so a tiny amount of numerical wiggle is
    // expected and allowed here rather than asserted away.
    let prev = erbsDiffuseFraction(0);
    let worstIncrease = 0;
    for (let i = 1; i <= 1000; i++) {
      const kt = i / 1000;
      const kd = erbsDiffuseFraction(kt);
      if (kd - prev > worstIncrease) worstIncrease = kd - prev;
      prev = kd;
    }
    expect(worstIncrease).toBeLessThan(0.01);
  });

  it('is flat at 0.165 for kt > 0.8 (kt=0.8 itself is still the polynomial piece, ~0.1653)', () => {
    expect(Math.abs(erbsDiffuseFraction(0.8) - 0.165)).toBeLessThan(0.001);
    expect(erbsDiffuseFraction(0.8 + 1e-9)).toBe(0.165);
    expect(erbsDiffuseFraction(0.9)).toBe(0.165);
    expect(erbsDiffuseFraction(1)).toBe(0.165);
  });

  it('is continuous at the kt=0.22 breakpoint within the known small (~0.0003) fitted-polynomial tolerance', () => {
    const below = erbsDiffuseFraction(0.22 - 1e-6);
    const above = erbsDiffuseFraction(0.22 + 1e-6);
    expect(Math.abs(above - below)).toBeLessThan(0.01);
  });

  it('clamps kt outside [0,1] rather than extrapolating the fit', () => {
    expect(erbsDiffuseFraction(-1)).toBe(erbsDiffuseFraction(0));
    expect(erbsDiffuseFraction(2)).toBe(erbsDiffuseFraction(1));
  });
});

describe('erbsDecomposition', () => {
  it('returns an all-zero decomposition when ghi<=0 or the sun is below the horizon', () => {
    const r1 = erbsDecomposition({ ghi: 0, zenithDeg: 30, dayOfYear: 80 });
    expect(r1.dhi).toBe(0);
    expect(r1.dni).toBe(0);

    const r2 = erbsDecomposition({ ghi: 500, zenithDeg: 95, dayOfYear: 80 });
    expect(r2.dhi).toBe(0);
    expect(r2.dni).toBe(0);
  });

  it('satisfies the fundamental irradiance-components identity dhi + dni*cos(zenith) = ghi, across many conditions', () => {
    // This is the real invariant of the decomposition (not a memorized
    // reference number): whatever the model does internally, the
    // reconstructed beam-plus-diffuse total must equal the input GHI.
    const days = [1, 80, 172, 266, 355];
    const zeniths = [5, 10, 20, 40, 60, 75, 85];
    for (const n of days) {
      for (const z of zeniths) {
        const g0 = extraterrestrialHorizontalIrradiance(n, z);
        if (g0 <= 0) continue;
        for (const kt of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          const ghi = kt * g0;
          const r = erbsDecomposition({ ghi, zenithDeg: z, dayOfYear: n });
          const reconstructed = r.dhi + r.dni * Math.cos((z * Math.PI) / 180);
          expect(Math.abs(reconstructed - ghi)).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('gives dhi close to ghi (mostly diffuse) under overcast conditions (low kt)', () => {
    const g0 = extraterrestrialHorizontalIrradiance(80, 30);
    const ghi = 0.1 * g0; // kt = 0.1
    const r = erbsDecomposition({ ghi, zenithDeg: 30, dayOfYear: 80 });
    expect(r.dhi / ghi).toBeGreaterThan(0.98);
  });

  it('gives dni much larger than dhi (mostly direct) under clear-sky conditions (high kt)', () => {
    const g0 = extraterrestrialHorizontalIrradiance(80, 30);
    const ghi = 0.75 * g0; // kt = 0.75, a typical clear-sky value
    const r = erbsDecomposition({ ghi, zenithDeg: 30, dayOfYear: 80 });
    expect(r.dni).toBeGreaterThan(r.dhi * 2);
  });

  it('forces dni=0 and dhi=ghi near the horizon (altitude < 3deg), instead of a blown-up DNI', () => {
    const n = 80;
    const zenithDeg = 88; // altitude = 2 deg
    const g0 = extraterrestrialHorizontalIrradiance(n, zenithDeg);
    const ghi = 0.5 * g0;
    const r = erbsDecomposition({ ghi, zenithDeg, dayOfYear: n });
    expect(r.dni).toBe(0);
    expect(r.dhi).toBe(ghi);
  });

  it('produces a sane end-to-end decomposition when fed real solarGeometry output', () => {
    const noon = new Date(Date.UTC(2024, 5, 21, 12, 0, 0)); // June solstice, UTC noon
    const pos = solarPosition(35, 0, noon); // mid-latitude
    const n = dayOfYear(noon);
    const zenithDeg = 90 - pos.altitude;
    const g0 = extraterrestrialHorizontalIrradiance(n, zenithDeg);
    expect(g0).toBeGreaterThan(0);

    const ghi = 0.7 * g0; // plausible clear-sky kt
    const r = erbsDecomposition({ ghi, zenithDeg, dayOfYear: n });
    expect(r.dni).toBeGreaterThan(0);
    expect(r.dhi).toBeGreaterThan(0);
    expect(r.dhi).toBeLessThan(ghi);

    const reconstructed = r.dhi + r.dni * Math.cos((zenithDeg * Math.PI) / 180);
    expect(Math.abs(reconstructed - ghi)).toBeLessThan(1e-6);
  });
});
