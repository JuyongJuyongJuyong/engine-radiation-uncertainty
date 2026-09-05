import { describe, expect, it } from 'vitest';
import {
  collaresPereiraRablRt,
  transposeRepresentativeDay,
  estimateAnnualTransposition,
  REPRESENTATIVE_DAY_OF_YEAR,
} from './monthlyTransposition';

describe('collaresPereiraRablRt', () => {
  it('sums to ~1 across the 24 hourly bins of a day, for a range of sunset angles (energy conservation)', () => {
    for (const sunsetAngle of [70, 90, 110, 130, 150, 170]) {
      let sum = 0;
      for (let hourIndex = 0; hourIndex < 24; hourIndex++) {
        const hourAngle = 15 * (hourIndex + 0.5 - 12);
        sum += collaresPereiraRablRt(hourAngle, sunsetAngle);
      }
      expect(Math.abs(sum - 1)).toBeLessThan(0.02);
    }
  });

  it('is zero outside daylight (|hour angle| >= sunset angle)', () => {
    expect(collaresPereiraRablRt(100, 90)).toBe(0);
    expect(collaresPereiraRablRt(-100, 90)).toBe(0);
    expect(collaresPereiraRablRt(90, 90)).toBe(0);
  });

  it('peaks at solar noon (hour angle 0)', () => {
    const atNoon = collaresPereiraRablRt(0, 100);
    const atMorning = collaresPereiraRablRt(-60, 100);
    const atEvening = collaresPereiraRablRt(60, 100);
    expect(atNoon).toBeGreaterThan(atMorning);
    expect(atNoon).toBeGreaterThan(atEvening);
  });
});

describe('transposeRepresentativeDay', () => {
  it('reconstructs the input daily GHI almost exactly at tilt=0 (horizontal identity, same as transposeToPOA)', () => {
    const day = transposeRepresentativeDay({
      lat: 37.5665,
      dailyGhiKwhPerM2: 3.9,
      dayOfYear: REPRESENTATIVE_DAY_OF_YEAR.JUN,
      surfaceTiltDeg: 0,
      surfaceAzimuthDeg: 180,
      albedo: 0.2,
    });
    expect(Math.abs(day.poaKwhPerM2 - 3.9)).toBeLessThan(0.05);
  });

  it('returns a clearness index in [0, 1]', () => {
    const day = transposeRepresentativeDay({
      lat: 37.5665,
      dailyGhiKwhPerM2: 3.9,
      dayOfYear: REPRESENTATIVE_DAY_OF_YEAR.JUN,
      surfaceTiltDeg: 30,
      surfaceAzimuthDeg: 180,
      albedo: 0.2,
    });
    expect(day.clearnessIndex).toBeGreaterThan(0);
    expect(day.clearnessIndex).toBeLessThanOrEqual(1);
  });

  it('gives a latitude-tilt, south-facing panel a large winter boost over horizontal at a mid-latitude site', () => {
    // Low winter sun angle means a horizontal surface catches radiation at
    // a steep, low-yield angle -- this is exactly the case a tilted panel
    // is meant to fix, and the literature commonly cites 1.5-2.5x winter
    // gain at mid/high latitudes for a tilt~=latitude, equator-facing panel.
    const horizontal = transposeRepresentativeDay({
      lat: 37.5665,
      dailyGhiKwhPerM2: 3.9,
      dayOfYear: REPRESENTATIVE_DAY_OF_YEAR.DEC,
      surfaceTiltDeg: 0,
      surfaceAzimuthDeg: 180,
      albedo: 0.2,
    });
    const tilted = transposeRepresentativeDay({
      lat: 37.5665,
      dailyGhiKwhPerM2: 3.9,
      dayOfYear: REPRESENTATIVE_DAY_OF_YEAR.DEC,
      surfaceTiltDeg: 37.5665,
      surfaceAzimuthDeg: 180,
      albedo: 0.2,
    });
    expect(tilted.poaKwhPerM2).toBeGreaterThan(horizontal.poaKwhPerM2 * 1.3);
    expect(tilted.poaKwhPerM2).toBeLessThan(horizontal.poaKwhPerM2 * 3);
  });

  it('returns zero for a non-positive daily GHI input', () => {
    const day = transposeRepresentativeDay({
      lat: 37.5665,
      dailyGhiKwhPerM2: 0,
      dayOfYear: REPRESENTATIVE_DAY_OF_YEAR.JUN,
      surfaceTiltDeg: 30,
      surfaceAzimuthDeg: 180,
      albedo: 0.2,
    });
    expect(day.poaKwhPerM2).toBe(0);
    expect(day.clearnessIndex).toBe(0);
  });
});

describe('estimateAnnualTransposition', () => {
  const seoulMonthlyGhi = {
    JAN: 2.4204,
    FEB: 3.1997,
    MAR: 4.3008,
    APR: 5.0244,
    MAY: 5.5639,
    JUN: 5.2457,
    JUL: 4.2082,
    AUG: 4.4993,
    SEP: 4.1798,
    OCT: 3.5909,
    NOV: 2.4418,
    DEC: 2.1118,
  };

  it('uses all twelve months when all are present and returns a sane transposition factor', () => {
    const result = estimateAnnualTransposition({
      lat: 37.5665,
      monthlyAvgKwhPerM2PerDay: seoulMonthlyGhi,
      surfaceTiltDeg: 30,
      surfaceAzimuthDeg: 180,
      albedo: 0.2,
    });
    expect(result.monthsUsed).toBe(12);
    // A 30 deg, south-facing, latitude~38 panel should beat horizontal
    // annually but not by an implausibly large margin.
    expect(result.transpositionFactor).toBeGreaterThan(1);
    expect(result.transpositionFactor).toBeLessThan(1.4);
    expect(result.clearnessIndex).toBeGreaterThan(0);
    expect(result.clearnessIndex).toBeLessThanOrEqual(1);
  });

  it('skips months with a missing/zero/non-finite value and still returns a result', () => {
    const partial = { ...seoulMonthlyGhi, FEB: 0, JUL: NaN };
    delete (partial as Record<string, number>).NOV;
    const result = estimateAnnualTransposition({
      lat: 37.5665,
      monthlyAvgKwhPerM2PerDay: partial,
      surfaceTiltDeg: 30,
      surfaceAzimuthDeg: 180,
      albedo: 0.2,
    });
    expect(result.monthsUsed).toBe(9);
  });

  it('throws when no month has a usable value', () => {
    expect(() =>
      estimateAnnualTransposition({
        lat: 37.5665,
        monthlyAvgKwhPerM2PerDay: {},
        surfaceTiltDeg: 30,
        surfaceAzimuthDeg: 180,
        albedo: 0.2,
      }),
    ).toThrow();
  });
});
