/**
 * Cholesky decomposition and correlated multivariate-normal sampling, used
 * by monteCarloUncertainty.ts to model irradiance sources' errors as
 * correlated rather than independent -- per CLAUDE.md: "NASA POWER,
 * Open-Meteo, and PVGIS likely share upstream reanalysis inputs like
 * ERA5/MERRA-2, so their errors are not independent -- model that
 * correlation structure rather than assuming i.i.d. noise."
 *
 * Standard technique: to draw a sample from a multivariate normal with
 * mean vector mu, standard deviations sigma, and correlation matrix R,
 * compute the Cholesky factor L of R (L L^T = R, L lower-triangular),
 * draw a vector z of independent standard normals, and return
 * mu + sigma .* (L z). The resulting vector has covariance
 * diag(sigma) R diag(sigma) by construction (see e.g. Glasserman,
 * "Monte Carlo Methods in Financial Engineering", section 2.3).
 */

import { sampleStandardNormal, type Rng } from './random';

/**
 * Computes the lower-triangular Cholesky factor L of a symmetric
 * positive-definite matrix, i.e. L L^T = matrix. Throws if the matrix is
 * not square, not symmetric (within tolerance), or not positive-definite
 * (a diagonal pivot goes non-positive during elimination).
 */
export function choleskyDecomposition(matrix: number[][]): number[][] {
  const n = matrix.length;
  for (const row of matrix) {
    if (row.length !== n) {
      throw new Error('choleskyDecomposition requires a square matrix');
    }
  }
  const symmetryTolerance = 1e-9;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = matrix[i]?.[j] ?? NaN;
      const b = matrix[j]?.[i] ?? NaN;
      if (Math.abs(a - b) > symmetryTolerance) {
        throw new Error(`choleskyDecomposition requires a symmetric matrix (mismatch at [${i}][${j}])`);
      }
    }
  }

  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += (L[i]?.[k] ?? 0) * (L[j]?.[k] ?? 0);
      }
      const target = (matrix[i]?.[j] ?? 0) - sum;
      if (i === j) {
        if (target <= 0) {
          throw new Error(
            `choleskyDecomposition: matrix is not positive-definite (non-positive pivot at row ${i})`,
          );
        }
        (L[i] as number[])[j] = Math.sqrt(target);
      } else {
        const diag = L[j]?.[j] ?? 0;
        (L[i] as number[])[j] = target / diag;
      }
    }
  }
  return L;
}

/**
 * Draws one sample from a multivariate normal distribution with the given
 * per-component means and standard deviations and the given correlation
 * matrix (diagonal entries 1, symmetric, positive-definite). Consumes
 * means.length independent standard normal draws from rng per call.
 */
export function sampleCorrelatedNormals(
  means: number[],
  stdDevs: number[],
  correlationMatrix: number[][],
  rng: Rng,
): number[] {
  const n = means.length;
  if (stdDevs.length !== n || correlationMatrix.length !== n) {
    throw new Error('sampleCorrelatedNormals: means, stdDevs, and correlationMatrix must have matching dimensions');
  }
  const L = choleskyDecomposition(correlationMatrix);
  const z = Array.from({ length: n }, () => sampleStandardNormal(rng));

  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    let correlatedStandardNormal = 0;
    for (let k = 0; k <= i; k++) {
      correlatedStandardNormal += (L[i]?.[k] ?? 0) * (z[k] ?? 0);
    }
    result.push((means[i] ?? 0) + (stdDevs[i] ?? 0) * correlatedStandardNormal);
  }
  return result;
}

/**
 * Builds an n x n correlation matrix with 1s on the diagonal and a
 * uniform pairwise correlation `rho` off-diagonal. A convenient default
 * shape for "these sources share some common upstream error" when no
 * per-pair correlation estimate exists -- see monteCarloUncertainty.ts's
 * module doc comment for why a single assumed rho is today's honest
 * starting point rather than a derived value.
 */
export function uniformCorrelationMatrix(n: number, rho: number): number[][] {
  if (rho <= -1 || rho >= 1) {
    throw new Error(`uniformCorrelationMatrix: rho must be in (-1, 1), got ${rho}`);
  }
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : rho)));
}
