import { describe, expect, it } from 'vitest';
import { propagateUncertainty } from './monteCarloUncertainty';

describe('propagateUncertainty', () => {
  it('collapses to the deterministic point estimate when every uncertainty is zero', () => {
    const result = propagateUncertainty({
      sources: [
        { source: 'a', annualGhiKwhPerM2: 1000, weight: 0.5 },
        { source: 'b', annualGhiKwhPerM2: 1400, weight: 0.5 },
      ],
      sourceRelativeStdDevs: [0, 0],
      aerosolRelativeStdDev: 0,
      transpositionRelativeStdDev: 0,
      trials: 100,
    });
    expect(Math.abs(result.meanKwhPerM2 - 1200)).toBeLessThan(1e-9);
    expect(Math.abs(result.ci90[0] - 1200)).toBeLessThan(1e-9);
    expect(Math.abs(result.ci90[1] - 1200)).toBeLessThan(1e-9);
  });

  it('gives independent sources a lower ensemble std dev than perfectly-correlated sources', () => {
    const commonArgs = {
      sources: [
        { source: 'a', annualGhiKwhPerM2: 1200, weight: 0.5 },
        { source: 'b', annualGhiKwhPerM2: 1200, weight: 0.5 },
      ],
      sourceRelativeStdDevs: [0.1, 0.1],
      aerosolRelativeStdDev: 0,
      transpositionRelativeStdDev: 0,
      trials: 300000,
    };
    const correlated = propagateUncertainty({ ...commonArgs, sourceCorrelation: 0.999, seed: 1 });
    const independent = propagateUncertainty({ ...commonArgs, sourceCorrelation: 0, seed: 1 });
    expect(independent.stdDevKwhPerM2).toBeLessThan(correlated.stdDevKwhPerM2);
  });

  it('matches the analytical relative std for an independent, equal-weight, equal-std two-source ensemble (std/sqrt(2))', () => {
    const independent = propagateUncertainty({
      sources: [
        { source: 'a', annualGhiKwhPerM2: 1200, weight: 0.5 },
        { source: 'b', annualGhiKwhPerM2: 1200, weight: 0.5 },
      ],
      sourceRelativeStdDevs: [0.1, 0.1],
      sourceCorrelation: 0,
      aerosolRelativeStdDev: 0,
      transpositionRelativeStdDev: 0,
      trials: 300000,
      seed: 1,
    });
    const expected = 0.1 / Math.sqrt(2);
    const actual = independent.stdDevKwhPerM2 / independent.meanKwhPerM2;
    expect(Math.abs(actual - expected)).toBeLessThan(0.003);
  });

  it('matches the analytical relative std for a perfectly-correlated two-source ensemble (no diversification)', () => {
    const correlated = propagateUncertainty({
      sources: [
        { source: 'a', annualGhiKwhPerM2: 1200, weight: 0.5 },
        { source: 'b', annualGhiKwhPerM2: 1200, weight: 0.5 },
      ],
      sourceRelativeStdDevs: [0.1, 0.1],
      sourceCorrelation: 0.999,
      aerosolRelativeStdDev: 0,
      transpositionRelativeStdDev: 0,
      trials: 300000,
      seed: 1,
    });
    const actual = correlated.stdDevKwhPerM2 / correlated.meanKwhPerM2;
    expect(Math.abs(actual - 0.1)).toBeLessThan(0.003);
  });

  it('produces a ci90 that brackets the mean and is consistent with +/-1.645 sigma', () => {
    const result = propagateUncertainty({
      sources: [
        { source: 'a', annualGhiKwhPerM2: 1200, weight: 0.5 },
        { source: 'b', annualGhiKwhPerM2: 1200, weight: 0.5 },
      ],
      sourceRelativeStdDevs: [0.1, 0.1],
      sourceCorrelation: 0,
      aerosolRelativeStdDev: 0,
      transpositionRelativeStdDev: 0,
      trials: 300000,
      seed: 1,
    });
    expect(result.ci90[0]).toBeLessThan(result.meanKwhPerM2);
    expect(result.meanKwhPerM2).toBeLessThan(result.ci90[1]);
    const impliedHalfWidth = 1.645 * result.stdDevKwhPerM2;
    const actualHalfWidth = (result.ci90[1] - result.ci90[0]) / 2;
    expect(Math.abs(actualHalfWidth - impliedHalfWidth) / impliedHalfWidth).toBeLessThan(0.02);
  });

  it('throws on an empty sources array', () => {
    expect(() => propagateUncertainty({ sources: [], sourceRelativeStdDevs: [] })).toThrow('at least one source');
  });

  it('throws when sourceRelativeStdDevs length does not match sources length', () => {
    expect(() =>
      propagateUncertainty({
        sources: [{ source: 'a', annualGhiKwhPerM2: 1000, weight: 1 }],
        sourceRelativeStdDevs: [0.1, 0.2],
      }),
    ).toThrow('one entry per source');
  });

  it('throws for a non-positive trials value', () => {
    expect(() =>
      propagateUncertainty({
        sources: [{ source: 'a', annualGhiKwhPerM2: 1000, weight: 1 }],
        sourceRelativeStdDevs: [0.1],
        trials: 0,
      }),
    ).toThrow();
  });
});
