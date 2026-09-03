/**
 * engine-radiation-uncertainty — Erbs decomposition.
 *
 * Splits global horizontal irradiance (GHI) into its diffuse horizontal
 * (DHI) and direct/beam normal (DNI) components, using the Erbs
 * correlation (Erbs, Klein & Duffie, 1982, "Estimation of the diffuse
 * radiation fraction for hourly, daily and monthly-average global
 * radiation", Solar Energy 28(4), 293-302). This is the standard,
 * widely-reproduced decomposition model (see also Duffie & Beckman,
 * "Solar Engineering of Thermal Processes", Table 2.10.1; the open-source
 * pvlib.irradiance.erbs function uses the same coefficients).
 *
 * Step 2 of 6 in the CLAUDE.md engine plan. Consumes the solar zenith
 * angle and day-of-year produced by step 1 (solarGeometry.ts) — it does
 * not compute them itself, to keep the two modules independently
 * testable and composable from index.ts.
 *
 * All irradiance values are in W/m^2 (or any consistent power-flux
 * unit): the model is a dimensionless ratio applied to GHI, so it works
 * equally on instantaneous W/m^2 or values averaged over an interval,
 * as long as GHI and the returned DHI/DNI share the same unit.
 */

/** Solar constant: mean extraterrestrial irradiance at 1 AU. */
const SOLAR_CONSTANT_W_M2 = 1367;

/**
 * Below this solar altitude (degrees), the direct-beam component is
 * treated as negligible and all irradiance is folded into "diffuse"
 * rather than solved for as DNI. This avoids the classic near-horizon
 * blow-up: DNI = (GHI - DHI) / cos(zenith) is numerically unstable as
 * zenith -> 90 deg (cos -> 0), and physically the atmospheric path
 * length at grazing incidence is so long that the beam component is
 * heavily attenuated anyway. 3 degrees is a conservative, commonly used
 * cutoff (comparable to the min-cos-zenith guards used in production
 * libraries such as pvlib).
 */
const MIN_ALTITUDE_FOR_BEAM_DEG = 3;

/**
 * Eccentricity correction factor E0 for Earth's slightly elliptical
 * orbit (Duffie & Beckman eq. 1.4.1a — the standard low-order
 * approximation conventionally paired with the Erbs correlation). n is
 * day of year (1-366). E0 ranges ~0.967 (aphelion, early July) to
 * ~1.034 (perihelion, early January): Earth-Sun distance varies enough
 * over the year to swing extraterrestrial irradiance by a few percent.
 */
export function eccentricityCorrectionFactor(n: number): number {
  const B = (2 * Math.PI * n) / 365;
  return 1 + 0.033 * Math.cos(B);
}

/**
 * Extraterrestrial irradiance on a horizontal plane, G0 (W/m^2): the
 * irradiance that would reach a horizontal surface at the top of the
 * atmosphere, before any atmospheric absorption or scattering. Used as
 * the denominator of the clearness index kt = GHI / G0, which is the
 * Erbs correlation's measure of "how clear the sky is" (kt near 1 means
 * almost no atmospheric attenuation, kt near 0 means heavily overcast).
 *
 * zenithDeg is the solar zenith angle in degrees (90 - altitude, i.e.
 * the complement of solarPosition().altitude). Returns 0 when the sun
 * is at or below the horizon, since no extraterrestrial beam reaches a
 * horizontal surface there.
 */
export function extraterrestrialHorizontalIrradiance(n: number, zenithDeg: number): number {
  if (zenithDeg >= 90) return 0;
  const cosZenith = Math.cos((zenithDeg * Math.PI) / 180);
  return extraterrestrialNormalIrradiance(n) * cosZenith;
}

/**
 * Extraterrestrial irradiance normal to the sun's rays, "dni_extra"
 * (W/m^2): the irradiance a surface would receive at the top of the
 * atmosphere if it were held perpendicular to the sun at all times —
 * i.e. solar constant * eccentricity correction, with no zenith-angle
 * (cosine) factor applied. This is the quantity step 3
 * (perezTransposition.ts) needs for its clearness/brightness indices,
 * as distinct from extraterrestrialHorizontalIrradiance (G0) above,
 * which is the same value projected onto a horizontal surface.
 */
export function extraterrestrialNormalIrradiance(n: number): number {
  return SOLAR_CONSTANT_W_M2 * eccentricityCorrectionFactor(n);
}

/**
 * Erbs correlation: diffuse fraction kd = DHI / GHI, as a piecewise
 * quartic function of the clearness index kt. kt is clamped to [0, 1]
 * first — real-world GHI measurements can slightly exceed the
 * extraterrestrial value near sunrise/sunset, or under cloud-edge
 * enhancement, and the correlation was only ever fit over kt in [0, 1].
 *
 * The three pieces (kt <= 0.22, 0.22 < kt <= 0.8, kt > 0.8) are the
 * original Erbs/Klein/Duffie breakpoints; the fitted quartic has a
 * small (~0.0003) known discontinuity right at kt = 0.22, which is a
 * real artifact of the published correlation, not a bug introduced
 * here — see the "no wild discontinuity" test in
 * erbsCorrelation.test.ts, which allows a small tolerance rather than
 * asserting exact continuity.
 */
export function erbsDiffuseFraction(kt: number): number {
  const k = Math.min(Math.max(kt, 0), 1);
  if (k <= 0.22) {
    return 1 - 0.09 * k;
  }
  if (k <= 0.8) {
    return 0.9511 - 0.1604 * k + 4.388 * k ** 2 - 16.638 * k ** 3 + 12.336 * k ** 4;
  }
  return 0.165;
}

export interface ErbsInput {
  /** Global horizontal irradiance, W/m^2 (or consistent unit). */
  ghi: number;
  /** Solar zenith angle in degrees (90 - altitude); from solarPosition(). */
  zenithDeg: number;
  /** Day of year, 1-366; from dayOfYear(). */
  dayOfYear: number;
}

export interface ErbsOutput {
  /** Diffuse horizontal irradiance, same unit as ghi. */
  dhi: number;
  /**
   * Direct normal irradiance, same unit as ghi. Forced to 0 when the
   * sun is below MIN_ALTITUDE_FOR_BEAM_DEG (see that constant's doc).
   */
  dni: number;
  /** Clearness index actually used (ghi / extraterrestrial, clamped to [0, 1]). */
  kt: number;
  /** Extraterrestrial horizontal irradiance G0, same unit as ghi. */
  extraterrestrial: number;
}

/**
 * Decomposes GHI into DHI + DNI via the Erbs correlation.
 *
 * By construction (away from the near-horizon guard), dhi + dni *
 * cos(zenith) reconstructs ghi exactly — this is the fundamental
 * irradiance-components identity, and erbsCorrelation.test.ts checks it
 * directly rather than relying on any memorized reference number.
 *
 * Returns all-zero (aside from extraterrestrial) whenever ghi <= 0 or
 * the sun is below the horizon — there is nothing to decompose.
 */
export function erbsDecomposition(input: ErbsInput): ErbsOutput {
  const { ghi, zenithDeg, dayOfYear } = input;
  const extraterrestrial = extraterrestrialHorizontalIrradiance(dayOfYear, zenithDeg);

  if (ghi <= 0 || extraterrestrial <= 0) {
    return { dhi: 0, dni: 0, kt: 0, extraterrestrial };
  }

  const kt = Math.min(Math.max(ghi / extraterrestrial, 0), 1);
  const kd = erbsDiffuseFraction(kt);
  const dhi = kd * ghi;

  const altitudeDeg = 90 - zenithDeg;
  if (altitudeDeg < MIN_ALTITUDE_FOR_BEAM_DEG) {
    // Near-horizon: treat everything as diffuse rather than solving an
    // ill-conditioned division by a near-zero cosine (see
    // MIN_ALTITUDE_FOR_BEAM_DEG doc above). dni = 0 here still satisfies
    // dhi + dni * cos(zenith) = ghi exactly, since dhi = ghi.
    return { dhi: ghi, dni: 0, kt, extraterrestrial };
  }

  const cosZenith = Math.cos((zenithDeg * Math.PI) / 180);
  const dni = (ghi - dhi) / cosZenith;

  return { dhi, dni, kt, extraterrestrial };
}
