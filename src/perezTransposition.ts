/**
 * engine-radiation-uncertainty — Perez anisotropic transposition to
 * plane-of-array (POA) irradiance.
 *
 * Step 3 of 6 in the CLAUDE.md engine plan. Takes the horizontal
 * irradiance components produced by step 2 (erbsCorrelation.ts) plus
 * the solar position from step 1 (solarGeometry.ts), and transposes
 * them onto a tilted PV surface: beam (direct) + anisotropic sky
 * diffuse (Perez 1990 model) + isotropic ground-reflected diffuse.
 *
 * The Perez sky-diffuse model coefficients and formulas here are taken
 * directly from the 'allsitescomposite1990' table in pvlib-python
 * (pvlib/irradiance.py, function `perez` / `_get_perez_coefficients`,
 * MIT licensed, https://github.com/pvlib/pvlib-python) — the de facto
 * reference open-source implementation — rather than from memory, since
 * the coefficient table is an 8x6 empirical fit where a single
 * mistyped digit would silently corrupt every downstream energy
 * estimate. Original source: Perez, R., Ineichen, P., Seals, R.,
 * Michalsky, J., Stewart, R., 1990. "Modeling daylight availability and
 * irradiance components from direct and global irradiance." Solar
 * Energy 44(5), 271-289.
 *
 * The relative airmass formula is Kasten & Young, 1989 ("Revised
 * optical air mass tables and approximation formula", Applied Optics
 * 28:4735-4738) — pvlib's default ('kastenyoung1989'), also taken
 * verbatim from pvlib/atmosphere.py's `get_relative_airmass`.
 */

import { degToRad, cosDeg, sinDeg } from './angles';

/**
 * Relative (sea-level, not pressure-corrected) airmass via the Kasten &
 * Young (1989) formula. zenithDeg should be the apparent (ideally
 * refraction-corrected) solar zenith angle; solarGeometry.ts does not
 * model atmospheric refraction, so this is used with the geometric
 * zenith angle, which is the standard simplification for a project at
 * this accuracy tier (refraction shifts the apparent horizon by well
 * under a degree except very close to the horizon itself, where the
 * MIN_ALTITUDE_FOR_BEAM_DEG-style guards elsewhere already dominate the
 * uncertainty budget).
 *
 * Returns NaN for zenith >= 90 (sun at or below the horizon), matching
 * pvlib: airmass is undefined once there is no atmospheric path to the
 * sun left to measure.
 */
export function relativeAirmassKastenYoung1989(zenithDeg: number): number {
  if (zenithDeg >= 90) return NaN;
  const zenithRad = degToRad(zenithDeg);
  return 1 / (Math.cos(zenithRad) + 0.50572 * Math.pow(6.07995 + (90 - zenithDeg), -1.6364));
}

/**
 * cos(angle of incidence): the dot product of the sun's unit direction
 * vector and the tilted surface's outward normal unit vector. 1 when
 * the sun is dead-on to the panel, 0 when it grazes the panel edge-on,
 * negative when the sun is behind the panel (self-shading side) — the
 * caller clamps negative values to 0 where "how much beam actually
 * lands on the panel" is what's wanted (see beamComponent below).
 *
 * All angles in degrees. surfaceAzimuthDeg and solarAzimuthDeg use the
 * same compass-bearing convention as solarGeometry.ts's
 * SolarPosition.azimuth (0 = North, 90 = East, clockwise).
 */
export function angleOfIncidenceCosine(
  surfaceTiltDeg: number,
  surfaceAzimuthDeg: number,
  solarZenithDeg: number,
  solarAzimuthDeg: number,
): number {
  const projection =
    cosDeg(surfaceTiltDeg) * cosDeg(solarZenithDeg) +
    sinDeg(surfaceTiltDeg) * sinDeg(solarZenithDeg) * cosDeg(solarAzimuthDeg - surfaceAzimuthDeg);
  return Math.min(Math.max(projection, -1), 1);
}

/**
 * Perez (1990) 'allsitescomposite1990' F1/F2 coefficients: 8 rows, one
 * per clearness (epsilon) bin, each [f11, f12, f13, f21, f22, f23].
 * F1 = f11 + f12*delta + f13*zenithRad (circumsolar brightening).
 * F2 = f21 + f22*delta + f23*zenithRad (horizon brightening).
 * Verbatim from pvlib-python's coeffdict['allsitescomposite1990'] —
 * see the module-level doc comment for provenance.
 */
const PEREZ_1990_COEFFICIENTS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [-0.008, 0.588, -0.062, -0.06, 0.072, -0.022],
  [0.13, 0.683, -0.151, -0.019, 0.066, -0.029],
  [0.33, 0.487, -0.221, 0.055, -0.064, -0.026],
  [0.568, 0.187, -0.295, 0.109, -0.152, -0.014],
  [0.873, -0.392, -0.362, 0.226, -0.462, 0.001],
  [1.132, -1.237, -0.412, 0.288, -0.823, 0.056],
  [1.06, -1.6, -0.359, 0.264, -1.127, 0.131],
  [0.678, -0.327, -0.25, 0.156, -1.377, 0.251],
];

/** Bin edges for the Perez clearness parameter epsilon (8 bins from these 7 interior edges). */
const EPSILON_BIN_EDGES = [1.065, 1.23, 1.5, 1.95, 2.8, 4.5, 6.2];

/**
 * Which of the 8 Perez clearness bins epsilon falls into (0 = most
 * overcast, 7 = clearest). epsilon is always >= 1 by construction (see
 * perezSkyDiffuse), so, matching numpy.digitize(eps, (0, ...edges)) - 1
 * for eps >= 1, this reduces to "how many edges does eps meet or exceed".
 */
export function epsilonBinIndex(epsilon: number): number {
  let bin = 0;
  for (const edge of EPSILON_BIN_EDGES) {
    if (epsilon >= edge) bin++;
    else break;
  }
  return bin;
}

export interface PerezSkyDiffuseInput {
  /** Diffuse horizontal irradiance, W/m^2 (e.g. from erbsDecomposition().dhi). */
  dhi: number;
  /** Direct normal irradiance, W/m^2 (e.g. from erbsDecomposition().dni). */
  dni: number;
  /** Extraterrestrial normal irradiance, W/m^2 (extraterrestrialNormalIrradiance() from erbsCorrelation.ts). */
  dniExtra: number;
  /** Solar zenith angle, degrees (90 - altitude). */
  solarZenithDeg: number;
  /** Solar azimuth, degrees, compass bearing (0=N, 90=E). */
  solarAzimuthDeg: number;
  /** Panel tilt from horizontal, degrees (0 = flat, 90 = vertical). */
  surfaceTiltDeg: number;
  /** Panel azimuth, degrees, compass bearing, same convention as solarAzimuthDeg. */
  surfaceAzimuthDeg: number;
}

export interface PerezSkyDiffuseOutput {
  /** Total sky-diffuse irradiance on the tilted plane, W/m^2 (isotropic + circumsolar + horizon). */
  poaSkyDiffuse: number;
  /** Isotropic-sky-dome portion of poaSkyDiffuse. */
  poaIsotropic: number;
  /** Circumsolar-brightening portion of poaSkyDiffuse. */
  poaCircumsolar: number;
  /** Horizon-brightening portion of poaSkyDiffuse. */
  poaHorizon: number;
  /** Clearness parameter used (>= 1; NaN in the degenerate dhi<=0 case, where output is 0 anyway). */
  epsilon: number;
  /** Sky brightness parameter used. */
  delta: number;
}

/**
 * Perez (1990) anisotropic sky-diffuse transposition: how much of the
 * diffuse horizontal irradiance (dhi) lands on a tilted plane, given
 * that the sky is brighter near the sun (circumsolar) and near the
 * horizon than a naive isotropic dome would predict.
 *
 * Degenerate inputs (dhi <= 0, dniExtra <= 0, or sun at/below the
 * horizon) return an all-zero result directly. This both matches the
 * physically correct answer (no measured diffuse light means nothing
 * to transpose) and sidesteps a real floating-point trap in a literal
 * port of the reference algorithm: epsilon becomes 0/0 = NaN whenever
 * dhi and dni are both exactly 0, and NaN coefficients would then
 * multiply through dhi=0 as 0 * NaN = NaN rather than 0, in both
 * JavaScript and the numpy implementation this was ported from (pvlib
 * separately patches this for its own night-time case via an
 * airmass-is-NaN check; this guard covers the same ground more
 * directly for every degenerate case at once).
 */
export function perezSkyDiffuse(input: PerezSkyDiffuseInput): PerezSkyDiffuseOutput {
  const { dhi, dni, dniExtra, solarZenithDeg, solarAzimuthDeg, surfaceTiltDeg, surfaceAzimuthDeg } = input;

  if (dhi <= 0 || dniExtra <= 0 || solarZenithDeg >= 90) {
    return { poaSkyDiffuse: 0, poaIsotropic: 0, poaCircumsolar: 0, poaHorizon: 0, epsilon: NaN, delta: 0 };
  }

  const airmass = relativeAirmassKastenYoung1989(solarZenithDeg);
  const zenithRad = degToRad(solarZenithDeg);
  const kappa = 1.041;

  // Sky brightness: how much diffuse light relative to what a clear,
  // "1 airmass thickness" atmosphere would let through overhead.
  const delta = (dhi * airmass) / dniExtra;

  // Sky clearness: near 1 for a fully overcast sky (dni=0), growing
  // for an increasingly clear sky (large dni relative to dhi). The
  // kappa*zenithRad^3 correction keeps the bin assignment stable near
  // the horizon, where a small change in the dhi/dni ratio would
  // otherwise swing epsilon wildly (Perez et al.'s original fix).
  const epsilon = ((dhi + dni) / dhi + kappa * zenithRad ** 3) / (1 + kappa * zenithRad ** 3);

  const bin = epsilonBinIndex(epsilon);
  const [f11, f12, f13, f21, f22, f23] = PEREZ_1990_COEFFICIENTS[bin]!;

  const F1 = Math.max(0, f11 + f12 * delta + f13 * zenithRad);
  const F2 = f21 + f22 * delta + f23 * zenithRad;

  const A = Math.max(0, angleOfIncidenceCosine(surfaceTiltDeg, surfaceAzimuthDeg, solarZenithDeg, solarAzimuthDeg));
  const B = Math.max(Math.cos(zenithRad), cosDeg(85));

  const term1 = 0.5 * (1 - F1) * (1 + cosDeg(surfaceTiltDeg));
  const term2 = (F1 * A) / B;
  const term3 = F2 * sinDeg(surfaceTiltDeg);

  const poaIsotropic = dhi * term1;
  const poaCircumsolar = dhi * term2;
  const poaHorizon = dhi * term3;
  const poaSkyDiffuse = Math.max(0, poaIsotropic + poaCircumsolar + poaHorizon);

  if (poaSkyDiffuse === 0) {
    return { poaSkyDiffuse: 0, poaIsotropic: 0, poaCircumsolar: 0, poaHorizon: 0, epsilon, delta };
  }
  return { poaSkyDiffuse, poaIsotropic, poaCircumsolar, poaHorizon, epsilon, delta };
}

/**
 * Beam (direct) irradiance landing on the tilted plane: DNI projected
 * onto the panel's normal. 0 when the sun is behind the panel (self-
 * shading side, cos(AOI) < 0) rather than negative.
 */
export function beamComponent(
  dni: number,
  surfaceTiltDeg: number,
  surfaceAzimuthDeg: number,
  solarZenithDeg: number,
  solarAzimuthDeg: number,
): number {
  if (dni <= 0) return 0;
  const cosAoi = angleOfIncidenceCosine(surfaceTiltDeg, surfaceAzimuthDeg, solarZenithDeg, solarAzimuthDeg);
  return dni * Math.max(0, cosAoi);
}

/**
 * Ground-reflected diffuse irradiance landing on the tilted plane,
 * using the standard isotropic-ground assumption (Liu & Jordan, 1963):
 * the ground is treated as a uniformly-bright Lambertian reflector of
 * reflectance `albedo`, and the panel "sees" a (1 - cos(tilt)) / 2
 * fraction of the ground hemisphere — 0 at tilt=0 (a flat panel faces
 * only the sky), rising to albedo * ghi / 2 at tilt=90 (a vertical
 * panel sees half ground, half sky).
 *
 * albedo has no default here deliberately: it is a real, site-specific
 * physical input (fresh snow ~0.8-0.9, grass ~0.2, dark rooftop
 * membrane ~0.1-0.15) and CLAUDE.md requires every result to carry its
 * assumptions rather than bury a silent default.
 */
export function groundReflectedPOA(ghi: number, surfaceTiltDeg: number, albedo: number): number {
  if (ghi <= 0) return 0;
  return ghi * albedo * ((1 - cosDeg(surfaceTiltDeg)) / 2);
}

export interface POAInput {
  /** Global horizontal irradiance, W/m^2. */
  ghi: number;
  /** Diffuse horizontal irradiance, W/m^2. */
  dhi: number;
  /** Direct normal irradiance, W/m^2. */
  dni: number;
  /** Extraterrestrial normal irradiance, W/m^2. */
  dniExtra: number;
  /** Solar zenith angle, degrees. */
  solarZenithDeg: number;
  /** Solar azimuth, degrees (compass bearing). */
  solarAzimuthDeg: number;
  /** Panel tilt from horizontal, degrees. */
  surfaceTiltDeg: number;
  /** Panel azimuth, degrees (compass bearing). */
  surfaceAzimuthDeg: number;
  /** Ground reflectance, 0-1 (site-specific; see groundReflectedPOA doc). */
  albedo: number;
}

export interface POAOutput {
  /** Total plane-of-array irradiance, W/m^2 (beam + sky diffuse + ground-reflected). */
  poaGlobal: number;
  poaBeam: number;
  poaSkyDiffuse: number;
  poaGroundDiffuse: number;
  /** Angle of incidence between the sun and the panel normal, degrees (0 = sun dead-on). */
  aoiDeg: number;
}

/**
 * Full plane-of-array irradiance: beam + Perez anisotropic sky diffuse
 * + isotropic ground-reflected diffuse. This is the step-3 output that
 * step 5 (ensembling) and, ultimately, index.ts's kWh_per_m2_per_year
 * are built on.
 *
 * Identity check worth knowing (exercised in
 * perezTransposition.test.ts): at surfaceTiltDeg = 0, poaGlobal must
 * equal ghi exactly — a horizontal panel's plane-of-array irradiance
 * is, by definition, the global horizontal irradiance.
 */
export function transposeToPOA(input: POAInput): POAOutput {
  const { ghi, dhi, dni, dniExtra, solarZenithDeg, solarAzimuthDeg, surfaceTiltDeg, surfaceAzimuthDeg, albedo } =
    input;

  const aoiDeg =
    (Math.acos(angleOfIncidenceCosine(surfaceTiltDeg, surfaceAzimuthDeg, solarZenithDeg, solarAzimuthDeg)) * 180) /
    Math.PI;

  const poaBeam = beamComponent(dni, surfaceTiltDeg, surfaceAzimuthDeg, solarZenithDeg, solarAzimuthDeg);
  const poaSkyDiffuse = perezSkyDiffuse({
    dhi,
    dni,
    dniExtra,
    solarZenithDeg,
    solarAzimuthDeg,
    surfaceTiltDeg,
    surfaceAzimuthDeg,
  }).poaSkyDiffuse;
  const poaGroundDiffuse = groundReflectedPOA(ghi, surfaceTiltDeg, albedo);

  return {
    poaGlobal: poaBeam + poaSkyDiffuse + poaGroundDiffuse,
    poaBeam,
    poaSkyDiffuse,
    poaGroundDiffuse,
    aoiDeg,
  };
}
