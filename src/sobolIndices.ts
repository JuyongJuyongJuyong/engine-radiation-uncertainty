/**
 * Sobol global sensitivity indices, per CLAUDE.md's "Math/statistics"
 * scope item: "Sobol sensitivity indices on the propagated output so the
 * uncertainty budget names which input (transposition model, source
 * disagreement, aerosol correction, etc.) actually dominates the final
 * range."
 *
 * Implements Saltelli's (2002, 2010) Monte Carlo estimator for
 * variance-based (Sobol) first-order and total-order sensitivity indices,
 * a standard technique for decomposing a model's output variance among
 * its inputs without needing the model in closed form -- exactly what's
 * needed here, since propagateUncertainty() (monteCarloUncertainty.ts) is
 * a simulation, not a formula. Reference: A. Saltelli et al., "Global
 * Sensitivity Analysis: The Primer" (2008), chapter 4; Jansen (1999) for
 * the total-order estimator used below.
 *
 * Method: draw two independent N x k sample matrices A and B (k =
 * number of uncertain parameters, one column per parameter, one
 * independent sampler per parameter). For each parameter i, build AB_i by
 * taking A and replacing its i-th column with B's i-th column. Evaluate
 * the model at every row of A, B, and each AB_i. Then, writing
 * Var(Y) for the sample variance of all model evaluations combined:
 *
 *   S_i  = (1/N * sum_r yB[r] * (yABi[r] - yA[r])) / Var(Y)        (first-order)
 *   ST_i = (1/(2N) * sum_r (yA[r] - yABi[r])^2)   / Var(Y)          (total-order)
 *
 * S_i measures parameter i's own contribution to output variance; ST_i
 * additionally captures its interactions with other parameters. This
 * module is deliberately generic (any model: (params: number[]) => number
 * and any array of independent samplers) rather than hard-coded to this
 * engine's specific uncertain inputs, so it is verifiable against a
 * standard analytical benchmark independent of this project's own,
 * currently-assumed uncertainty numbers (see sobolIndices.test.ts, which
 * checks it against the Ishigami function's published closed-form Sobol
 * indices) before being trusted to rank *this engine's* aerosol /
 * transposition / source-disagreement inputs.
 */

import type { Rng } from './random';

/** Draws one independent sample of a single parameter, given a uniform RNG. */
export type ParameterSampler = (rng: Rng) => number;

export interface SobolIndicesInput {
  /** The model being analyzed: takes one row of parameter values, returns one scalar output. */
  model: (params: number[]) => number;
  /** One independent sampler per parameter, in the order `model` expects them. */
  samplers: ParameterSampler[];
  /** Number of base Monte Carlo rows (A and B each have this many rows). */
  n: number;
  rng: Rng;
}

export interface SobolIndicesOutput {
  /** First-order Sobol index per parameter, same order as `samplers`. */
  firstOrder: number[];
  /** Total-order Sobol index per parameter, same order as `samplers`. */
  totalOrder: number[];
  /** Sample variance of all model evaluations used (A, B, and every AB_i), for diagnostics. */
  outputVariance: number;
}

function sampleMatrix(samplers: ParameterSampler[], n: number, rng: Rng): number[][] {
  const rows: number[][] = [];
  for (let r = 0; r < n; r++) {
    rows.push(samplers.map((sample) => sample(rng)));
  }
  return rows;
}

function evaluateRows(model: (params: number[]) => number, rows: number[][]): number[] {
  return rows.map((row) => model(row));
}

function variance(values: number[]): number {
  const m = values.reduce((sum, v) => sum + v, 0) / values.length;
  const sumSquaredDeviations = values.reduce((sum, v) => sum + (v - m) ** 2, 0);
  return sumSquaredDeviations / values.length;
}

export function computeSobolIndices(input: SobolIndicesInput): SobolIndicesOutput {
  const { model, samplers, n, rng } = input;
  const k = samplers.length;
  if (k === 0) {
    throw new Error('computeSobolIndices requires at least one parameter/sampler');
  }
  if (n < 2) {
    throw new Error(`computeSobolIndices requires n >= 2, got ${n}`);
  }

  const A = sampleMatrix(samplers, n, rng);
  const B = sampleMatrix(samplers, n, rng);

  const yA = evaluateRows(model, A);
  const yB = evaluateRows(model, B);

  const outputVariance = variance([...yA, ...yB]);
  if (outputVariance === 0) {
    // A constant model has no sensitivity to attribute; every index is 0 rather than 0/0.
    return { firstOrder: new Array(k).fill(0), totalOrder: new Array(k).fill(0), outputVariance: 0 };
  }

  const firstOrder: number[] = [];
  const totalOrder: number[] = [];

  for (let i = 0; i < k; i++) {
    const AB_i = A.map((rowA, r) => {
      const row = [...rowA];
      row[i] = (B[r] as number[])[i] as number;
      return row;
    });
    const yABi = evaluateRows(model, AB_i);

    let firstOrderSum = 0;
    let totalOrderSum = 0;
    for (let r = 0; r < n; r++) {
      const a = yA[r] as number;
      const b = yB[r] as number;
      const abi = yABi[r] as number;
      firstOrderSum += b * (abi - a);
      totalOrderSum += (a - abi) ** 2;
    }

    firstOrder.push(firstOrderSum / n / outputVariance);
    totalOrder.push(totalOrderSum / (2 * n) / outputVariance);
  }

  return { firstOrder, totalOrder, outputVariance };
}
