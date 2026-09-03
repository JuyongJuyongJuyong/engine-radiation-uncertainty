/**
 * Whole-system Monte Carlo uncertainty propagation, per CLAUDE.md's
 * "Math/statistics" scope item: "whole-system Monte Carlo uncertainty
 * propagation with correlated error terms across sources (NASA POWER,
 * Open-Meteo, and PVGIS likely share upstream reanalysis inputs like
 * ERA5/MERRA-2, so their errors are not independent -- model that
 * correlation structure rather than assuming i.i.d. noise)".
 *
 * `monte_carlo.py`, CLAUDE.md's named reference implementation for the
 * base propagation, is not available in this environment (confirmed
 * missing in an earlier session; the user confirmed they don't have its
 * location either and authorized implementing directly from CLAUDE.md's
 * spec instead of porting it). This module is therefore an original
 * implementation of the propagation CLAUDE.md describes, not a port.
 *
 * Model: for each Monte Carlo trial, this engine's two irradiance sources
 * (NASA POWER, Open-Meteo -- PVGIS excluded, see irradianceEnsemble.ts)
 * each get a correlated relative error draw (via correlatedSampling.ts's
 * multivariate-normal sampler), are combined with the same weights
 * ensembleIrradiance() would use, and are then perturbed by independent
 * aerosol-correction and Perez-transposition relative-error factors to
 * produce one sample of final annual kWh/m^2. Aerosol and transposition
 * errors are modeled independently of the source errors and of each
 * other because they arise from different, unrelated physical/model
 * approximations (a single-band Beer-Lambert aerosol fit; an anisotropic
 * sky-diffuse model) rather than from shared upstream reanalysis data.
 *
 * Every numeric default below (source relative std dev, source
 * correlation rho, aerosol/transposition relative std dev) is a
 * documented, disclosed assumption, not a measured value -- this project
 * has no ground-truth/validation dataset (zero-backend constraint, see
 * irradianceEnsemble.ts's module doc comment for the same caveat applied
 * to ensembling weights). CLAUDE.md's own accuracy targets (~11% 90% CI
 * for Tier 1, ~16% for Tier 3) were used to sanity-check that these
 * defaults land in a physically reasonable range, not derived from them.
 */

import { sampleCorrelatedNormals, uniformCorrelationMatrix } from './correlatedSampling';
import { sampleStandardNormal, createRng, type Rng } from './random';

export interface SourceMeanEstimate {
  source: string;
  /** This source's mean annual GHI estimate, kWh/m^2/year. */
  annualGhiKwhPerM2: number;
  /** This source's weight in the ensemble (see ensembleIrradiance()'s EnsembleResult.sources). */
  weight: number;
}

export interface MonteCarloUncertaintyInput {
  /** Per-source mean estimates and ensemble weights, e.g. from ensembleIrradiance()'s output. */
  sources: SourceMeanEstimate[];
  /**
   * Relative (fractional) standard deviation of each source's error, same order as `sources`.
   * E.g. 0.08 means that source's annual GHI estimate carries ~8% (1 std dev) uncertainty.
   */
  sourceRelativeStdDevs: number[];
  /**
   * Assumed pairwise correlation between sources' errors (shared upstream reanalysis inputs
   * per CLAUDE.md). Must be in (-1, 1); ignored when there is only one source. Defaults to 0.5
   * -- a documented mid-range assumption, not a measured value (see module doc comment).
   */
  sourceCorrelation?: number;
  /** Aerosol correction's relative uncertainty (1 std dev, multiplicative). Defaults to 0.03 (3%). */
  aerosolRelativeStdDev?: number;
  /** Perez transposition model's relative uncertainty (1 std dev, multiplicative). Defaults to 0.05 (5%). */
  transpositionRelativeStdDev?: number;
  /** Number of Monte Carlo trials. Defaults to 10000. */
  trials?: number;
  /** Seed for the deterministic RNG (see random.ts). Defaults to 1. */
  seed?: number;
}

export interface MonteCarloUncertaintyOutput {
  meanKwhPerM2: number;
  stdDevKwhPerM2: number;
  /** [p5, p95] of the simulated distribution -- the 90% confidence interval on annual kWh/m^2. */
  ci90: [number, number];
  /** Half-width of ci90 relative to the mean, e.g. 0.11 for a +/-11% 90% CI. */
  relativeCi90HalfWidth: number;
  trials: number;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function sampleStdDev(values: number[], meanValue: number): number {
  if (values.length < 2) return 0;
  const sumSquaredDeviations = values.reduce((sum, v) => sum + (v - meanValue) ** 2, 0);
  return Math.sqrt(sumSquaredDeviations / (values.length - 1));
}

/** Linear-interpolation percentile (p in [0, 1]) of an already-sorted array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0] as number;
  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = sorted[lower] as number;
  if (lower === upper) return lowerValue;
  const upperValue = sorted[upper] as number;
  return lowerValue + (index - lower) * (upperValue - lowerValue);
}

export function propagateUncertainty(input: MonteCarloUncertaintyInput): MonteCarloUncertaintyOutput {
  const { sources, sourceRelativeStdDevs } = input;
  if (sources.length === 0) {
    throw new Error('propagateUncertainty requires at least one source');
  }
  if (sourceRelativeStdDevs.length !== sources.length) {
    throw new Error('propagateUncertainty: sourceRelativeStdDevs must have one entry per source');
  }

  const sourceCorrelation = input.sourceCorrelation ?? 0.5;
  const aerosolRelativeStdDev = input.aerosolRelativeStdDev ?? 0.03;
  const transpositionRelativeStdDev = input.transpositionRelativeStdDev ?? 0.05;
  const trials = input.trials ?? 10000;
  const seed = input.seed ?? 1;

  if (trials < 1) {
    throw new Error(`propagateUncertainty: trials must be >= 1, got ${trials}`);
  }

  const rng: Rng = createRng(seed);
  const n = sources.length;
  const zeroMeans = new Array(n).fill(0);
  const correlationMatrix = n > 1 ? uniformCorrelationMatrix(n, sourceCorrelation) : [[1]];

  const samples: number[] = [];
  for (let trial = 0; trial < trials; trial++) {
    const relativeErrors =
      n > 1
        ? sampleCorrelatedNormals(zeroMeans, sourceRelativeStdDevs, correlationMatrix, rng)
        : [sampleStandardNormal(rng) * (sourceRelativeStdDevs[0] ?? 0)];

    let ensembleValue = 0;
    for (let i = 0; i < n; i++) {
      const src = sources[i] as SourceMeanEstimate;
      const perturbed = src.annualGhiKwhPerM2 * (1 + (relativeErrors[i] ?? 0));
      ensembleValue += perturbed * src.weight;
    }

    const aerosolFactor = 1 + sampleStandardNormal(rng) * aerosolRelativeStdDev;
    const transpositionFactor = 1 + sampleStandardNormal(rng) * transpositionRelativeStdDev;
    samples.push(ensembleValue * aerosolFactor * transpositionFactor);
  }

  const meanKwhPerM2 = mean(samples);
  const stdDevKwhPerM2 = sampleStdDev(samples, meanKwhPerM2);
  const sorted = [...samples].sort((a, b) => a - b);
  const p5 = percentile(sorted, 0.05);
  const p95 = percentile(sorted, 0.95);

  return {
    meanKwhPerM2,
    stdDevKwhPerM2,
    ci90: [p5, p95],
    relativeCi90HalfWidth: (p95 - p5) / 2 / meanKwhPerM2,
    trials,
  };
}
