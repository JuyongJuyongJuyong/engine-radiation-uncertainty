import { describe, expect, it } from 'vitest';
import { ensembleIrradiance } from './irradianceEnsemble';

describe('ensembleIrradiance', () => {
  it('returns the source unchanged for a single-source ensemble (weight=1, basis=equal)', () => {
    const r = ensembleIrradiance([{ source: 'a', annualGhiKwhPerM2: 1234.5 }]);
    expect(r.annualGhiKwhPerM2).toBe(1234.5);
    expect(r.weightingBasis).toBe('equal');
    expect(r.sources.length).toBe(1);
    expect(r.sources[0]?.weight).toBe(1);
  });

  it('averages two variance-less sources as a plain arithmetic mean with equal weights', () => {
    const r = ensembleIrradiance([
      { source: 'a', annualGhiKwhPerM2: 1000 },
      { source: 'b', annualGhiKwhPerM2: 1400 },
    ]);
    expect(r.weightingBasis).toBe('equal');
    expect(Math.abs(r.annualGhiKwhPerM2 - 1200)).toBeLessThan(1e-9);
    expect(Math.abs((r.sources[0]?.weight ?? NaN) - 0.5)).toBeLessThan(1e-9);
    expect(Math.abs((r.sources[1]?.weight ?? NaN) - 0.5)).toBeLessThan(1e-9);
  });

  it('two sources with equal variances land on the same result as equal weighting', () => {
    const r = ensembleIrradiance([
      { source: 'a', annualGhiKwhPerM2: 1000, varianceKwhPerM2Sq: 50 },
      { source: 'b', annualGhiKwhPerM2: 1400, varianceKwhPerM2Sq: 50 },
    ]);
    expect(r.weightingBasis).toBe('inverse-variance');
    expect(Math.abs(r.annualGhiKwhPerM2 - 1200)).toBeLessThan(1e-9);
  });

  it('matches the closed-form inverse-variance weighted mean for differing variances', () => {
    const a = { source: 'a', annualGhiKwhPerM2: 1000, varianceKwhPerM2Sq: 100 };
    const b = { source: 'b', annualGhiKwhPerM2: 1400, varianceKwhPerM2Sq: 400 };
    const r = ensembleIrradiance([a, b]);
    const wA = 1 / a.varianceKwhPerM2Sq / (1 / a.varianceKwhPerM2Sq + 1 / b.varianceKwhPerM2Sq);
    const wB = 1 - wA;
    const expected = a.annualGhiKwhPerM2 * wA + b.annualGhiKwhPerM2 * wB;
    expect(Math.abs(r.annualGhiKwhPerM2 - expected)).toBeLessThan(1e-9);
    expect(Math.abs((r.sources[0]?.weight ?? 0) + (r.sources[1]?.weight ?? 0) - 1)).toBeLessThan(1e-12);
  });

  it('pulls the ensemble estimate toward the lower-variance (more confident) source', () => {
    const r = ensembleIrradiance([
      { source: 'confident', annualGhiKwhPerM2: 1000, varianceKwhPerM2Sq: 1 },
      { source: 'noisy', annualGhiKwhPerM2: 2000, varianceKwhPerM2Sq: 10000 },
    ]);
    expect(Math.abs(r.annualGhiKwhPerM2 - 1000)).toBeLessThan(15);
  });

  it('falls back to equal weighting for the whole ensemble if any one source lacks a variance', () => {
    const r = ensembleIrradiance([
      { source: 'a', annualGhiKwhPerM2: 1000, varianceKwhPerM2Sq: 10 },
      { source: 'b', annualGhiKwhPerM2: 1400 },
    ]);
    expect(r.weightingBasis).toBe('equal');
    expect(Math.abs(r.annualGhiKwhPerM2 - 1200)).toBeLessThan(1e-9);
  });

  it('treats a zero or negative variance as unusable, forcing equal weighting', () => {
    const r = ensembleIrradiance([
      { source: 'a', annualGhiKwhPerM2: 1000, varianceKwhPerM2Sq: 0 },
      { source: 'b', annualGhiKwhPerM2: 1400, varianceKwhPerM2Sq: 10 },
    ]);
    expect(r.weightingBasis).toBe('equal');
  });

  it('weights sum to 1 for three equal-weighted sources', () => {
    const r = ensembleIrradiance([
      { source: 'a', annualGhiKwhPerM2: 900 },
      { source: 'b', annualGhiKwhPerM2: 1100 },
      { source: 'c', annualGhiKwhPerM2: 1300 },
    ]);
    const sumWeights = r.sources.reduce((s, x) => s + x.weight, 0);
    expect(Math.abs(sumWeights - 1)).toBeLessThan(1e-12);
    expect(Math.abs(r.annualGhiKwhPerM2 - 1100)).toBeLessThan(1e-9);
  });

  it('weights sum to 1 for three inverse-variance-weighted sources', () => {
    const r = ensembleIrradiance([
      { source: 'a', annualGhiKwhPerM2: 900, varianceKwhPerM2Sq: 20 },
      { source: 'b', annualGhiKwhPerM2: 1100, varianceKwhPerM2Sq: 50 },
      { source: 'c', annualGhiKwhPerM2: 1300, varianceKwhPerM2Sq: 200 },
    ]);
    const sumWeights = r.sources.reduce((s, x) => s + x.weight, 0);
    expect(Math.abs(sumWeights - 1)).toBeLessThan(1e-12);
  });

  it('throws on an empty estimates array', () => {
    expect(() => ensembleIrradiance([])).toThrow();
  });
});
