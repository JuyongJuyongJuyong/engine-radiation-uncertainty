/**
 * Dust/aerosol correction for GHI, per CLAUDE.md's physics scope
 * ("dust/aerosol correction to GHI").
 *
 * Data source (see openMeteoAirQuality.ts): Open-Meteo's Air Quality API
 * ships a single broadband-ish aerosol_optical_depth value (dimensionless,
 * ~550nm column AOD, sourced from CAMS reanalysis) rather than the
 * two-wavelength (380nm + 500nm) input the full Bird & Hulstrom (1981)
 * clear-sky aerosol transmittance term needs -- see pvlib.clearsky.bird,
 * which takes aod380/aod500 specifically so it can fit an Angstrom
 * exponent. Without a second wavelength we cannot recover that exponent,
 * so this module intentionally uses the simpler, single-band Beer-Lambert
 * aerosol extinction law instead: Iqbal, "An Introduction to Solar
 * Radiation" (Academic Press, 1983), the aerosol transmittance term
 * Ta = exp(-tau_a * m), where tau_a is (broadband) aerosol optical depth
 * and m is relative airmass along the beam path.
 *
 * This is a first-order approximation, not a full spectral radiative-
 * transfer correction. Consistent with CLAUDE.md's "never claim precision
 * the data doesn't support" rule, the correction is exposed as an
 * explicit, separately-tested multiplier (`transmittance`) rather than
 * folded silently into a single opaque GHI number.
 *
 * Documented caveat (not solved here): the irradiance sources used for
 * ensembling (NASA POWER / Open-Meteo / PVGIS, see step 5) are themselves
 * reanalysis- or satellite-derived and already reflect *some* aerosol
 * climatology baked into their own retrieval. This correction targets
 * local/transient deviations (e.g. a dust event) from that baseline, not
 * a full atmospheric re-derivation -- rigorously separating "climatological
 * aerosol already in the source" from "the local anomaly this correction
 * should capture" would need per-source aerosol assumptions that aren't
 * published. Left as a known limitation rather than a false-precision fix.
 */

export interface AerosolCorrectionInput {
  /** Global horizontal irradiance before correction, W/m^2. */
  ghi: number;
  /** Aerosol optical depth (dimensionless), from Open-Meteo Air Quality API. */
  aerosolOpticalDepth: number;
  /** Relative airmass along the beam path (e.g. Kasten & Young 1989). */
  relativeAirmass: number;
}

export interface AerosolCorrectionOutput {
  /** GHI after applying the aerosol transmittance multiplier, W/m^2. */
  ghiCorrected: number;
  /** The multiplier applied, in (0, 1]. 1 means "no correction". */
  transmittance: number;
}

/**
 * Broadband aerosol transmittance via the single-band Beer-Lambert law
 * (Iqbal 1983): Ta = exp(-tau_a * m).
 *
 * Degenerate/invalid inputs (NaN airmass -- e.g. the sun is below the
 * horizon and relativeAirmassKastenYoung1989 returns NaN -- or NaN AOD)
 * return 1 (no correction) rather than propagating NaN, matching the
 * degenerate-input guard used in perezTransposition.ts.
 */
export function aerosolTransmittance(
  aerosolOpticalDepth: number,
  relativeAirmass: number,
): number {
  if (!Number.isFinite(aerosolOpticalDepth) || !Number.isFinite(relativeAirmass)) {
    return 1;
  }
  const tau = Math.max(0, aerosolOpticalDepth);
  const m = Math.max(0, relativeAirmass);
  return Math.exp(-tau * m);
}

/**
 * Applies the aerosol transmittance multiplier to GHI. Never increases
 * irradiance (transmittance is capped at 1 in the degenerate case, and
 * strictly <= 1 otherwise since tau and m are both clamped non-negative).
 */
export function applyAerosolCorrection(
  input: AerosolCorrectionInput,
): AerosolCorrectionOutput {
  const transmittance = aerosolTransmittance(input.aerosolOpticalDepth, input.relativeAirmass);
  const ghiCorrected = input.ghi <= 0 ? 0 : input.ghi * transmittance;
  return { ghiCorrected, transmittance };
}
