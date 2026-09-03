import { describe, expect, it } from 'vitest';
import { createRng } from './random';
import { choleskyDecomposition, sampleCorrelatedNormals, uniformCorrelationMatrix } from './correlatedSampling';

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
function stddev(xs: number[], m = mean(xs)): number {
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
function correlation(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = (xs[i] as number) - mx;
    const dy = (ys[i] as number) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxy / Math.sqrt(sxx * syy);
}

describe('choleskyDecomposition', () => {
  it('matches a known decomposition: [[4,2],[2,2]] = L L^T with L = [[2,0],[1,1]]', () => {
    const L = choleskyDecomposition([
      [4, 2],
      [2, 2],
    ]);
    expect(L[0]?.[0]).toBeCloseTo(2, 9);
    expect(L[0]?.[1]).toBeCloseTo(0, 9);
    expect(L[1]?.[0]).toBeCloseTo(1, 9);
    expect(L[1]?.[1]).toBeCloseTo(1, 9);
  });

  it('reproduces the identity matrix for an identity correlation matrix', () => {
    const L = choleskyDecomposition(uniformCorrelationMatrix(3, 0));
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(L[i]?.[j]).toBeCloseTo(i === j ? 1 : 0, 9);
      }
    }
  });

  it('throws on a non-square matrix', () => {
    expect(() => choleskyDecomposition([[1, 2, 3], [1, 2]])).toThrow();
  });

  it('throws on a non-symmetric matrix', () => {
    expect(() =>
      choleskyDecomposition([
        [1, 2],
        [3, 4],
      ]),
    ).toThrow('symmetric');
  });

  it('throws on a non-positive-definite matrix', () => {
    expect(() =>
      choleskyDecomposition([
        [1, 2],
        [2, 1],
      ]),
    ).toThrow('positive-definite');
  });
});

describe('uniformCorrelationMatrix', () => {
  it('builds a matrix with 1s on the diagonal and rho off-diagonal', () => {
    const m = uniformCorrelationMatrix(3, 0.4);
    expect(m).toEqual([
      [1, 0.4, 0.4],
      [0.4, 1, 0.4],
      [0.4, 0.4, 1],
    ]);
  });

  it('rejects rho outside (-1, 1)', () => {
    expect(() => uniformCorrelationMatrix(2, 1)).toThrow();
    expect(() => uniformCorrelationMatrix(2, -1)).toThrow();
  });
});

describe('sampleCorrelatedNormals', () => {
  it('recovers the specified means, stddevs, and correlation over many draws', () => {
    const rho = 0.6;
    const corrMatrix = uniformCorrelationMatrix(2, rho);
    const rng = createRng(123);
    const n = 200000;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = sampleCorrelatedNormals([10, 20], [2, 5], corrMatrix, rng);
      xs.push(x as number);
      ys.push(y as number);
    }
    expect(Math.abs(mean(xs) - 10)).toBeLessThan(0.05);
    expect(Math.abs(mean(ys) - 20)).toBeLessThan(0.1);
    expect(Math.abs(stddev(xs) - 2)).toBeLessThan(0.05);
    expect(Math.abs(stddev(ys) - 5)).toBeLessThan(0.1);
    expect(Math.abs(correlation(xs, ys) - rho)).toBeLessThan(0.02);
  });

  it('throws when dimensions do not match', () => {
    expect(() => sampleCorrelatedNormals([1, 2], [1], uniformCorrelationMatrix(2, 0.1), createRng(1))).toThrow();
  });
});
