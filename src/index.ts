/**
 * engine-radiation-uncertainty — public entry point.
 *
 * See CLAUDE.md for the full spec: Perez anisotropic GHI->POA transposition,
 * correlated Monte Carlo uncertainty propagation + Sobol sensitivity indices,
 * inverse-variance-weighted irradiance ensembling.
 *
 * Exported interface (consumed by engine-system-economics — see
 * ARCHITECTURE.md "Interface contracts". Any change here needs a version
 * bump + a coordinated PR on engine-system-economics — moot for now since
 * engine-system-economics has no implementation to coordinate with yet).
 *
 * BREAKING CHANGE from the earlier stub: getRadiationEstimate() is now
 * async (returns Promise<RadiationOutput>), not RadiationOutput directly.
 * The stub's synchronous signature was never actually implementable —
 * every real data source here (nasaPower.ts, openMeteoIrradiance.ts) is a
 * network fetch. Flagging explicitly per CLAUDE.md's "any change to this
 * shape needs a version bump" rule, even though there is no live consumer
 * yet to coordinate with.
 *
 * KNOWN LIMITATION (see defaultSurfaceForLatitude() below): RadiationInput
 * carries no tilt/azimuth. Per ARCHITECTURE.md, roof geometry is
 * engine-system-economics' concern (RoofMetadata), so this engine returns
 * kWh_per_m2_per_year for a canonical latitude-tilt, equator-facing
 * reference surface — not the caller's actual roof. engine-system-economics
 * must apply its own tilt/azimuth/shading adjustment on top of this value;
 * it must not be treated as already roof-specific. Worth folding into the
 * next ARCHITECTURE.md revision rather than leaving implicit.
 */
import { fetchNasaPowerAnnualGhi } from './nasaPower';
import { fetchOpenMeteoAnnualGhi } from './openMeteoIrradiance';
import { ensembleIrradiance, type IrradianceSourceEstimate } from './irradianceEnsemble';
import { estimateAnnualTransposition } from './monthlyTransposition';
import { propagateUncertainty, type SourceMeanEstimate } from './monteCarloUncertainty';

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
 * Documented default reference surface: fixed tilt = min(|lat|, 60 deg)
 * (the standard "tilt roughly equal to latitude" rule of thumb for
 * annual-energy-optimal fixed tilt — the same family of heuristic
 * PVGIS's own "optimal angle" tool uses; capped at 60 deg since a literal
 * tilt=latitude becomes an impractically steep, near-vertical panel at
 * high latitudes), equator-facing (south in the northern hemisphere,
 * north in the southern hemisphere). See this module's doc comment above
 * for why RadiationInput has no real tilt/azimuth to use instead.
 */
function defaultSurfaceForLatitude(lat: number): { tiltDeg: number; azimuthDeg: number } {
  const tiltDeg = Math.min(Math.abs(lat), 60);
  const azimuthDeg = lat >= 0 ? 180 : 0;
  return { tiltDeg, azimuthDeg };
}

/** Typical urban/mixed-ground albedo — see perezTransposition.ts's groundReflectedPOA doc comment. */
const DEFAULT_ALBEDO = 0.2;

/**
 * Per-source relative std dev fed to propagateUncertainty(). Not a
 * measured value — this project has no ground-truth validation dataset
 * (see irradianceEnsemble.ts's and monteCarloUncertainty.ts's module docs
 * for the same caveat about their own assumptions) — picked, together
 * with propagateUncertainty()'s own documented defaults
 * (sourceCorrelation=0.5, aerosolRelativeStdDev=0.03,
 * transpositionRelativeStdDev=0.05), so that a two-source, equal-weight
 * ensemble's 90% CI lands close to CLAUDE.md's ~11% Tier-1 accuracy
 * target — a sanity check on the assumption, not a derivation of it, per
 * monteCarloUncertainty.ts's own stated relationship to that target.
 */
const SOURCE_RELATIVE_STD_DEV = 0.055;

/**
 * Implements CLAUDE.md's 6-step plan:
 *  1-3. Solar geometry -> Erbs -> Perez transposition: done per hour, for
 *       each month's Klein & Theilacker representative day, inside
 *       monthlyTransposition.ts (see that module's doc comment for why a
 *       representative-day method is needed at all: the irradiance
 *       sources below only publish daily/monthly/annual totals, never a
 *       real hourly series).
 *  4. Aerosol/dust correction: NOT applied in the current pipeline — see
 *     monthlyTransposition.ts's module doc for why (needs a real hourly/
 *     monthly AOD series from openMeteoAirQuality.ts to be worth doing
 *     honestly; left as a disclosed gap, not silently skipped).
 *  5. Ensemble NASA POWER + Open-Meteo (PVGIS excluded — CORS, see
 *     irradianceEnsemble.ts) via ensembleIrradiance(). Open-Meteo's
 *     Historical Weather API is optional/best-effort only (see
 *     openMeteoIrradiance.ts's module doc for the paid-tier-gate risk
 *     found in the 2026-09-04 cost-exposure review) — its failure
 *     degrades the ensemble to NASA POWER alone rather than failing the
 *     whole estimate.
 *  6. Correlated Monte Carlo propagation -> uncertainty_ci_90, via
 *     propagateUncertainty(). (Sobol sensitivity indices, also
 *     implemented in this repo per CLAUDE.md, are a diagnostic over a
 *     propagateUncertainty() run rather than something every
 *     getRadiationEstimate() call needs to compute — see
 *     sobolIndices.ts / scratch_simulation.ts for a worked example
 *     against this same pipeline's shape.)
 */
export async function getRadiationEstimate(input: RadiationInput): Promise<RadiationOutput> {
  const { lat, lng } = input;
  // `tier` is accepted for interface compatibility (CLAUDE.md's tiered
  // source-routing plan) but does not yet change behavior: PVGIS, the
  // Tier-1/NSRDB-grade source CLAUDE.md names, is unusable from a browser
  // (CORS — see irradianceEnsemble.ts's module doc), so every tier
  // currently gets the same NASA-POWER-anchored estimate.
  // TODO(Owner A): branch on input.tier once a real Tier-1/2 source
  // exists to route to.
  void input.tier;

  const nasaPower = await fetchNasaPowerAnnualGhi({ lat, lng });

  const sources: IrradianceSourceEstimate[] = [
    { source: 'NASA POWER', annualGhiKwhPerM2: nasaPower.annualGhiKwhPerM2 },
  ];
  try {
    const openMeteo = await fetchOpenMeteoAnnualGhi({ lat, lng });
    sources.push({ source: 'Open-Meteo Archive', annualGhiKwhPerM2: openMeteo.annualGhiKwhPerM2 });
  } catch {
    // Optional/best-effort — see this function's doc comment (step 5).
  }
  const ensemble = ensembleIrradiance(sources);

  const { tiltDeg, azimuthDeg } = defaultSurfaceForLatitude(lat);
  const transposition = estimateAnnualTransposition({
    lat,
    monthlyAvgKwhPerM2PerDay: nasaPower.monthlyAvgKwhPerM2PerDay,
    surfaceTiltDeg: tiltDeg,
    surfaceAzimuthDeg: azimuthDeg,
    albedo: DEFAULT_ALBEDO,
  });

  const mcSources: SourceMeanEstimate[] = ensemble.sources.map((s) => ({
    source: s.source,
    annualGhiKwhPerM2: s.annualGhiKwhPerM2 * transposition.transpositionFactor,
    weight: s.weight,
  }));
  const mc = propagateUncertainty({
    sources: mcSources,
    sourceRelativeStdDevs: mcSources.map(() => SOURCE_RELATIVE_STD_DEV),
  });

  return {
    kWh_per_m2_per_year: mc.meanKwhPerM2,
    uncertainty_ci_90: mc.ci90,
    clearnessIndex: transposition.clearnessIndex,
    transpositionFactor: transposition.transpositionFactor,
  };
}
