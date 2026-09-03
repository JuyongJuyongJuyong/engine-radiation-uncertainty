/**
 * Deterministic, dependency-free pseudo-random number generation for this
 * engine's Monte Carlo propagation (monteCarloUncertainty.ts) and Sobol
 * sensitivity analysis (sobolIndices.ts). This project has no npm install
 * access in some environments and is browser-only/zero-backend per
 * CLAUDE.md, so this avoids pulling in a random-number-generation
 * dependency for what is a small, well-understood algorithm.
 *
 * createRng() is mulberry32 (Tommy Ettinger's public-domain 32-bit PRNG) --
 * not cryptographically secure, but fast, seedable, and statistically
 * sound enough for Monte Carlo sampling. Determinism from a fixed seed is
 * the point: it makes propagateUncertainty()/computeSobolIndices() calls
 * reproducible and testable.
 */

/** A source of independent draws uniformly distributed on [0, 1). */
export type Rng = () => number;

/** Creates a deterministic mulberry32 RNG from a 32-bit integer seed. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return function rng(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draws one standard normal (mean 0, variance 1) sample via the Box-Muller
 * transform. Guards against log(0) by re-drawing if the first uniform
 * sample is exactly 0 (probability ~2^-32 with this RNG, but not zero).
 */
export function sampleStandardNormal(rng: Rng): number {
  let u1 = rng();
  while (u1 === 0) {
    u1 = rng();
  }
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
