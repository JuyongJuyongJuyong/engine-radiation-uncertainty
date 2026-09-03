import { describe, expect, it } from 'vitest';
import {
  relativeAirmassKastenYoung1989,
  angleOfIncidenceCosine,
  epsilonBinIndex,
  perezSkyDiffuse,
  beamComponent,
  groundReflectedPOA,
  transposeToPOA,
} from './perezTransposition';
import {
  erbsDecomposition,
  extraterrestrialHorizontalIrradiance,
  extraterrestrialNormalIrradiance,
} from './erbsCorrelation';

describe('relativeAirmassKastenYoung1989', () => {
  it('is close to 1 at zenith=0 (known ~0.9997 quirk of the fitted formula)', () => {
    expect(Math.abs(relativeAirmassKastenYoung1989(0) - 1)).toBeLessThan(0.001);
  });

  it('is close to sec(60deg)=2 at zenith=60', () => {
    expect(Math.abs(relativeAirmassKastenYoung1989(60) - 2)).toBeLessThan(0.05);
  });

  it('is NaN once the sun is at or below the horizon', () => {
    expect(Number.isNaN(relativeAirmassKastenYoung1989(90))).toBe(true);
    expect(Number.isNaN(relativeAirmassKastenYoung1989(95))).toBe(true);
  });

  it('increases monotonically with zenith (a longer atmospheric path to a lower sun)', () => {
    let prev = relativeAirmassKastenYoung1989(0);
    for (let z = 1; z < 90; z++) {
      const am = relativeAirmassKastenYoung1989(z);
      expect(am).toBeGreaterThan(prev);
      prev = am;
    }
  });
});

describe('angleOfIncidenceCosine', () => {
  it('at tilt=0 reduces to cos(zenith), independent of surface azimuth', () => {
    for (const zenith of [10, 30, 50, 70]) {
      for (const surfAz of [0, 90, 180, 270]) {
        const cosAoi = angleOfIncidenceCosine(0, surfAz, zenith, 123.4);
        expect(Math.abs(cosAoi - Math.cos((zenith * Math.PI) / 180))).toBeLessThan(1e-9);
      }
    }
  });

  it('is exactly 1 for a panel tilted to directly track the sun (tilt=zenith, azimuth matches)', () => {
    for (const zenith of [5, 20, 45, 70, 85]) {
      for (const solarAz of [0, 90, 200, 340]) {
        const cosAoi = angleOfIncidenceCosine(zenith, solarAz, zenith, solarAz);
        expect(Math.abs(cosAoi - 1)).toBeLessThan(1e-9);
      }
    }
  });

  it('is negative when a vertical panel faces directly away from the sun', () => {
    expect(angleOfIncidenceCosine(90, 0, 30, 180)).toBeLessThan(0);
  });
});

describe('epsilonBinIndex', () => {
  it('matches the documented Perez clearness-bin edges', () => {
    expect(epsilonBinIndex(1.0)).toBe(0);
    expect(epsilonBinIndex(1.064)).toBe(0);
    expect(epsilonBinIndex(1.065)).toBe(1);
    expect(epsilonBinIndex(1.229)).toBe(1);
    expect(epsilonBinIndex(1.23)).toBe(2);
    expect(epsilonBinIndex(6.199)).toBe(6);
    expect(epsilonBinIndex(6.2)).toBe(7);
    expect(epsilonBinIndex(1000)).toBe(7);
  });
});

describe('perezSkyDiffuse', () => {
  it('returns an all-zero, non-NaN result for degenerate inputs (dhi<=0, dniExtra<=0, sun below horizon)', () => {
    const base = {
      dhi: 0,
      dni: 0,
      dniExtra: 1400,
      solarZenithDeg: 30,
      solarAzimuthDeg: 180,
      surfaceTiltDeg: 20,
      surfaceAzimuthDeg: 180,
    };
    expect(perezSkyDiffuse(base).poaSkyDiffuse).toBe(0);
    expect(perezSkyDiffuse({ ...base, dhi: 100, dniExtra: 0 }).poaSkyDiffuse).toBe(0);
    expect(perezSkyDiffuse({ ...base, dhi: 100, solarZenithDeg: 95 }).poaSkyDiffuse).toBe(0);

    // The specific dhi=0,dni=0 case that a literal 0*NaN port would leak as NaN.
    const degenerate = perezSkyDiffuse({ ...base, dhi: 0, dni: 0 });
    expect(Number.isNaN(degenerate.poaSkyDiffuse)).toBe(false);
  });

  it('equals dhi exactly at surfaceTilt=0 (a horizontal panel only ever sees the full sky dome), for zenith < 85', () => {
    // zenith is kept below 85 deg so the B = max(cos(zenith), cos(85))
    // clamp never engages -- see perezTransposition.ts's doc comment.
    const days = [1, 80, 172, 266, 355];
    for (const n of days) {
      for (const zenith of [10, 30, 50, 70, 80]) {
        const dniExtra = extraterrestrialNormalIrradiance(n);
        for (const dni of [0, 200, 600]) {
          for (const dhi of [50, 300]) {
            const r = perezSkyDiffuse({
              dhi,
              dni,
              dniExtra,
              solarZenithDeg: zenith,
              solarAzimuthDeg: 150,
              surfaceTiltDeg: 0,
              surfaceAzimuthDeg: 180,
            });
            expect(Math.abs(r.poaSkyDiffuse - dhi)).toBeLessThan(1e-6);
          }
        }
      }
    }
  });

  it('stays non-negative and finite across a wide sweep of tilt/zenith/irradiance conditions', () => {
    const dniExtra = extraterrestrialNormalIrradiance(150);
    for (let zenith = 5; zenith < 90; zenith += 5) {
      for (let tilt = 0; tilt <= 90; tilt += 15) {
        for (const dni of [0, 100, 400, 800]) {
          for (const dhi of [10, 100, 400]) {
            const r = perezSkyDiffuse({
              dhi,
              dni,
              dniExtra,
              solarZenithDeg: zenith,
              solarAzimuthDeg: 180,
              surfaceTiltDeg: tilt,
              surfaceAzimuthDeg: 180,
            });
            expect(r.poaSkyDiffuse).toBeGreaterThanOrEqual(0);
            expect(Number.isNaN(r.poaSkyDiffuse)).toBe(false);
          }
        }
      }
    }
  });
});

describe('beamComponent', () => {
  it('is 0 whenever dni <= 0', () => {
    expect(beamComponent(0, 20, 180, 30, 180)).toBe(0);
    expect(beamComponent(-5, 20, 180, 30, 180)).toBe(0);
  });

  it('is 0 (not negative) when the sun is behind the panel', () => {
    expect(beamComponent(800, 90, 0, 30, 180)).toBe(0); // vertical panel facing N, sun in the S
  });

  it('equals dni*cos(zenith) at surfaceTilt=0', () => {
    for (const zenith of [10, 40, 70]) {
      const b = beamComponent(600, 0, 180, zenith, 123);
      expect(Math.abs(b - 600 * Math.cos((zenith * Math.PI) / 180))).toBeLessThan(1e-9);
    }
  });
});

describe('groundReflectedPOA', () => {
  it('is 0 at surfaceTilt=0 and 0 whenever ghi<=0', () => {
    expect(groundReflectedPOA(500, 0, 0.2)).toBe(0);
    expect(groundReflectedPOA(0, 45, 0.2)).toBe(0);
  });

  it('equals ghi*albedo/2 at surfaceTilt=90 (a vertical panel sees half the ground hemisphere)', () => {
    const g = groundReflectedPOA(500, 90, 0.2);
    expect(Math.abs(g - 500 * 0.2 * 0.5)).toBeLessThan(1e-9);
  });

  it('increases monotonically with tilt', () => {
    let prev = groundReflectedPOA(500, 0, 0.2);
    for (let tilt = 1; tilt <= 90; tilt++) {
      const g = groundReflectedPOA(500, tilt, 0.2);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });
});

describe('transposeToPOA', () => {
  it('golden identity: at surfaceTilt=0, poaGlobal equals ghi exactly -- ties steps 1 (geometry), 2 (Erbs) and 3 (Perez) together', () => {
    const days = [1, 80, 172, 266, 355];
    for (const n of days) {
      for (const zenith of [10, 30, 50, 70]) {
        const dniExtra = extraterrestrialNormalIrradiance(n);
        const g0 = extraterrestrialHorizontalIrradiance(n, zenith);
        for (const kt of [0.2, 0.5, 0.8]) {
          const ghi = kt * g0;
          const { dhi, dni } = erbsDecomposition({ ghi, zenithDeg: zenith, dayOfYear: n });
          const poa = transposeToPOA({
            ghi,
            dhi,
            dni,
            dniExtra,
            solarZenithDeg: zenith,
            solarAzimuthDeg: 160,
            surfaceTiltDeg: 0,
            surfaceAzimuthDeg: 180,
            albedo: 0.2,
          });
          expect(Math.abs(poa.poaGlobal - ghi)).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('a panel tilted to directly track the sun gets aoiDeg ~= 0', () => {
    const n = 150;
    const zenith = 40;
    const dniExtra = extraterrestrialNormalIrradiance(n);
    const g0 = extraterrestrialHorizontalIrradiance(n, zenith);
    const ghi = 0.7 * g0;
    const { dhi, dni } = erbsDecomposition({ ghi, zenithDeg: zenith, dayOfYear: n });
    const poa = transposeToPOA({
      ghi,
      dhi,
      dni,
      dniExtra,
      solarZenithDeg: zenith,
      solarAzimuthDeg: 200,
      surfaceTiltDeg: zenith,
      surfaceAzimuthDeg: 200,
      albedo: 0.2,
    });
    expect(poa.aoiDeg).toBeLessThan(1e-3);
  });

  it('a sensibly tilted/oriented panel out-collects a flat panel under clear, low-sun conditions', () => {
    // Classic result: when the sun is low, a panel tilted up toward it
    // captures much more direct beam than a flat panel, because
    // cos(AOI) for the tilted panel is much larger than cos(zenith)
    // for the flat one under the same beam irradiance.
    const n = 355; // December
    const zenith = 75; // low sun
    const dniExtra = extraterrestrialNormalIrradiance(n);
    const g0 = extraterrestrialHorizontalIrradiance(n, zenith);
    const ghi = 0.75 * g0; // clear sky
    const { dhi, dni } = erbsDecomposition({ ghi, zenithDeg: zenith, dayOfYear: n });
    const solarAz = 180;
    const flat = transposeToPOA({
      ghi,
      dhi,
      dni,
      dniExtra,
      solarZenithDeg: zenith,
      solarAzimuthDeg: solarAz,
      surfaceTiltDeg: 0,
      surfaceAzimuthDeg: 180,
      albedo: 0.2,
    });
    const tilted = transposeToPOA({
      ghi,
      dhi,
      dni,
      dniExtra,
      solarZenithDeg: zenith,
      solarAzimuthDeg: solarAz,
      surfaceTiltDeg: 60,
      surfaceAzimuthDeg: solarAz,
      albedo: 0.2,
    });
    expect(tilted.poaGlobal).toBeGreaterThan(flat.poaGlobal);
  });
});
