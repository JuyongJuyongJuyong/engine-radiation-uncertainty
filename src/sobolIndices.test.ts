import { describe, expect, it } from 'vitest';
import { createRng } from './random';
import { computeSobolIndices } from './sobolIndices';

// Ishigami function: f(x1,x2,x3) = sin(x1) + a*sin(x2)^2 + b*x3^4*sin(x1), xi ~ U(-pi,pi).
// A standard analytical benchmark for Sobol estimators (Saltelli et al. 2008, "Global
// Sensitivity Analysis: The Primer", ch. 4). With a=7, b=0.1, the published closed-form
// indices are S1=0.3139, S2=0.4424, S3=0, ST1=0.5576, ST2=0.4424, ST3=0.2437.
const ISHIGAMI_A = 7;
const ISHIGAMI_B = 0.1;
function ishigami([x1, x2, x3]: number[]): number {
  return (
    Math.sin(x1 as number) +
    ISHIGAMI_A * Math.sin(x2 as number) ** 2 +
    ISHIGAMI_B * (x3 as number) ** 4 * Math.sin(x1 as number)
  );
}
function uniformMinusPiPi(rng: () => number): number {
  return (rng() * 2 - 1) * Math.PI;
}

describe('computeSobolIndices', () => {
  it('matches the published Ishigami-function first-order and total-order indices', () => {
    const result = computeSobolIndices({
      model: ishigami,
      samplers: [uniformMinusPiPi, uniformMinusPiPi, uniformMinusPiPi],
      n: 65536,
      rng: createRng(99),
    });

    const expectedFirstOrder = [0.3139, 0.4424, 0];
    const expectedTotalOrder = [0.5576, 0.4424, 0.2437];
    const tol = 0.04;
    for (let i = 0; i < 3; i++) {
      expect(Math.abs((result.firstOrder[i] as number) - (expectedFirstOrder[i] as number))).toBeLessThan(tol);
      expect(Math.abs((result.totalOrder[i] as number) - (expectedTotalOrder[i] as number))).toBeLessThan(tol);
    }
  });

  it('gives every parameter a total-order index at least as large as its first-order index', () => {
    const result = computeSobolIndices({
      model: ishigami,
      samplers: [uniformMinusPiPi, uniformMinusPiPi, uniformMinusPiPi],
      n: 65536,
      rng: createRng(99),
    });
    for (let i = 0; i < 3; i++) {
      expect(result.totalOrder[i]).toBeGreaterThanOrEqual((result.firstOrder[i] as number) - 0.02);
    }
  });

  it('assigns zero sensitivity to every parameter for a constant model', () => {
    const result = computeSobolIndices({
      model: () => 42,
      samplers: [uniformMinusPiPi, uniformMinusPiPi],
      n: 1000,
      rng: createRng(1),
    });
    expect(result.firstOrder).toEqual([0, 0]);
    expect(result.totalOrder).toEqual([0, 0]);
    expect(result.outputVariance).toBe(0);
  });

  it('throws with no parameters', () => {
    expect(() => computeSobolIndices({ model: () => 0, samplers: [], n: 10, rng: createRng(1) })).toThrow(
      'at least one parameter',
    );
  });

  it('throws when n < 2', () => {
    expect(() =>
      computeSobolIndices({ model: () => 0, samplers: [uniformMinusPiPi], n: 1, rng: createRng(1) }),
    ).toThrow('n >= 2');
  });
});
