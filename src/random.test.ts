import { describe, expect, it } from 'vitest';
import { createRng, sampleStandardNormal } from './random';

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
function stddev(xs: number[], m = mean(xs)): number {
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    const seq1 = Array.from({ length: 5 }, () => rng1());
    const seq2 = Array.from({ length: 5 }, () => rng2());
    expect(seq1).toEqual(seq2);
  });

  it('produces different sequences for different seeds', () => {
    const rngA = createRng(1);
    const rngB = createRng(2);
    const seqA = Array.from({ length: 5 }, () => rngA());
    const seqB = Array.from({ length: 5 }, () => rngB());
    expect(seqA).not.toEqual(seqB);
  });

  it('produces values in [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('sampleStandardNormal', () => {
  it('has approximately mean 0 and stddev 1 over many draws', () => {
    const rng = createRng(7);
    const normals = Array.from({ length: 200000 }, () => sampleStandardNormal(rng));
    const m = mean(normals);
    const sd = stddev(normals, m);
    expect(Math.abs(m)).toBeLessThan(0.02);
    expect(Math.abs(sd - 1)).toBeLessThan(0.02);
  });

  it('is deterministic given a seeded rng', () => {
    const rngA = createRng(5);
    const rngB = createRng(5);
    const a = Array.from({ length: 10 }, () => sampleStandardNormal(rngA));
    const b = Array.from({ length: 10 }, () => sampleStandardNormal(rngB));
    expect(a).toEqual(b);
  });
});
