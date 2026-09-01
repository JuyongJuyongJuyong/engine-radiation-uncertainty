/**
 * engine-radiation-uncertainty — public entry point.
 *
 * See CLAUDE.md for the full spec: Perez anisotropic GHI->POA transposition,
 * correlated Monte Carlo uncertainty propagation + Sobol sensitivity indices,
 * inverse-variance-weighted irradiance ensembling.
 *
 * Exported interface (consumed by engine-system-economics — see
 * ARCHITECTURE.md "Interface contracts". Any change here needs a version
 * bump + a coordinated PR on engine-system-economics).
 */

export interface RadiationInput {
  lat: number;
  lng: number;
  tier: 1 | 2 | 3;
}

export interface RadiationOutput {
  kWh_per_m2_per_year: number;
  /** 90% confidence interval, as [low, high]. */
  uncertainty_ci_90: [number, number];
  /** Intermediate values engine-system-economics needs downstream. */
  clearnessIndex?: number;
  transpositionFactor?: number;
}

/**
 * TODO(Owner A) — implement per CLAUDE.md:
 *  1. Solar geometry (Cooper's equation declination, hour angle -> alt/az).
 *  2. Erbs correlation: split GHI into direct/diffuse.
 *  3. Perez anisotropic transposition -> POA.
 *  4. Aerosol/dust correction (Open-Meteo Air Quality API).
 *  5. Ensemble NASA POWER + Open-Meteo + PVGIS via inverse-variance weighting.
 *  6. Correlated Monte Carlo propagation + Sobol sensitivity -> uncertainty_ci_90.
 */
export function getRadiationEstimate(_input: RadiationInput): RadiationOutput {
  throw new Error('Not implemented yet — see CLAUDE.md for the spec.');
}
