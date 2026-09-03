/**
 * Combines multiple free irradiance sources into one long-term annual GHI
 * estimate, per CLAUDE.md's ensembling method: "Don't naive-average the
 * irradiance sources. Weight each source by inverse-variance ... based on
 * its local historical error characteristics where ground-truth/validation
 * data exists for that tier; fall back to equal weighting only where no
 * local skill estimate exists yet."
 *
 * This project has no ground-truth/validation dataset (no backend, no
 * database of ground-station comparisons -- see the zero-cost/no-backend
 * constraint in CLAUDE.md), so there is currently no "local historical
 * error characteristic" to derive a real inverse-variance weight from for
 * either source this engine uses. Per the rule above, that means equal
 * weighting is the honest default today, not a simplification to fix
 * later -- claiming a confidence-weighted blend without an actual skill
 * estimate behind it would be exactly the kind of false precision
 * CLAUDE.md's "never claim precision the data doesn't support" rule
 * exists to prevent. The inverse-variance path is fully implemented and
 * tested so it activates automatically once a source can supply a real
 * variance (e.g. from a future validation dataset).
 *
 * ensembleIrradiance() is intentionally agnostic to where each estimate's
 * variance comes from -- nasaPower.ts and openMeteoIrradiance.ts (the two
 * source modules used today) do not populate `varianceKwhPerM2Sq`.
 */

export interface IrradianceSourceEstimate {
  source: string;
  /** Long-term average annual global horizontal irradiation, kWh/m^2/year. */
  annualGhiKwhPerM2: number;
  /**
   * Variance of this source's annual GHI estimate, (kWh/m^2/year)^2.
   * Leave undefined when no real skill/error estimate is available --
   * see this file's module doc comment for why that is the honest
   * default today rather than a gap to silently paper over.
   */
  varianceKwhPerM2Sq?: number;
}

export interface EnsembleResult {
  annualGhiKwhPerM2: number;
  /**
   * 'inverse-variance' only when every input estimate carried a positive
   * variance; 'equal' otherwise (including the "no estimates carry a
   * variance" and "some but not all do" cases -- see module doc comment).
   */
  weightingBasis: 'inverse-variance' | 'equal';
  sources: Array<{ source: string; weight: number; annualGhiKwhPerM2: number }>;
}

export function ensembleIrradiance(estimates: IrradianceSourceEstimate[]): EnsembleResult {
  if (estimates.length === 0) {
    throw new Error('ensembleIrradiance requires at least one source estimate');
  }

  const allHaveUsableVariance = estimates.every(
    (e) => typeof e.varianceKwhPerM2Sq === 'number' && Number.isFinite(e.varianceKwhPerM2Sq) && e.varianceKwhPerM2Sq > 0,
  );

  let weights: number[];
  let weightingBasis: EnsembleResult['weightingBasis'];
  if (allHaveUsableVariance) {
    const inverseVariances = estimates.map((e) => 1 / (e.varianceKwhPerM2Sq as number));
    const sumInverseVariance = inverseVariances.reduce((sum, iv) => sum + iv, 0);
    weights = inverseVariances.map((iv) => iv / sumInverseVariance);
    weightingBasis = 'inverse-variance';
  } else {
    weights = estimates.map(() => 1 / estimates.length);
    weightingBasis = 'equal';
  }

  const annualGhiKwhPerM2 = estimates.reduce(
    (sum, e, i) => sum + e.annualGhiKwhPerM2 * (weights[i] as number),
    0,
  );

  return {
    annualGhiKwhPerM2,
    weightingBasis,
    sources: estimates.map((e, i) => ({
      source: e.source,
      weight: weights[i] as number,
      annualGhiKwhPerM2: e.annualGhiKwhPerM2,
    })),
  };
}
