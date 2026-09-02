/**
 * solarGeometry — sun-position calculations (declination, hour angle,
 * solar altitude/azimuth) for engine-radiation-uncertainty.
 *
 * Step 1 of the CLAUDE.md implementation plan: "Solar geometry (sun
 * position — declination via Cooper's equation, hour angle -> alt/az)."
 *
 * This module has no dependency on any data source (NASA POWER /
 * Open-Meteo / PVGIS) — it is pure astronomy, a function of
 * (latitude, longitude, UTC timestamp) only. Everything downstream
 * (Erbs decomposition, Perez transposition) needs these values as
 * inputs, which is why it comes first.
 *
 * All angles are degrees in/out unless a name says otherwise
 * (radians only ever appear in local `*Rad` variables used for
 * Math.sin/cos/tan calls).
 *
 * IMPORTANT: every Date is read using its UTC getters
 * (getUTCFullYear/getUTCHours/etc), never the local getters. Using
 * local getters would silently make every result depend on the
 * timezone of the machine running the code, which is exactly the
 * kind of bug that is invisible in a quick manual test and wrong in
 * production.
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Day of year, 1 (Jan 1) through 365 or 366 (Dec 31), based on the
 * date's UTC calendar fields.
 */
export function dayOfYear(date: Date): number {
  const year = date.getUTCFullYear();
  const startOfYearUTC = Date.UTC(year, 0, 1);
  const msPerDay = 24 * 60 * 60 * 1000;
  // Truncate `date` to its own UTC midnight before diffing, so the
  // time-of-day component never leaks a fractional day in (e.g.
  // 23:59 UTC on day 1 must still be day 1, not day 1.999...).
  const dateUTCMidnight = Date.UTC(
    year,
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return Math.round((dateUTCMidnight - startOfYearUTC) / msPerDay) + 1;
}

/**
 * Solar declination angle (degrees), via Cooper's equation (1969):
 *
 *   delta = 23.45 * sin( 360/365 * (284 + n) )
 *
 * where n is the day of year. This is the standard simplified
 * approximation used throughout solar-engineering texts (e.g. Duffie
 * & Beckman, "Solar Engineering of Thermal Processes"); it is
 * accurate to within about +/-0.5 degrees of a rigorous ephemeris,
 * which is well inside this project's stated accuracy targets
 * (Tier 1 ~+/-11% energy, Tier 3 ~+/-16% energy, 90% CI).
 *
 * Range: -23.45 to +23.45 degrees, with the maximum at the June
 * solstice (n ~= 172) and the minimum at the December solstice
 * (n ~= 355).
 */
export function solarDeclination(n: number): number {
  return 23.45 * Math.sin(DEG2RAD * ((360 / 365) * (284 + n)));
}

/**
 * Equation of time (minutes) — the difference between apparent solar
 * time and mean solar time, caused by the Earth's axial tilt and
 * orbital eccentricity. Spencer's (1971) Fourier-series
 * approximation, accurate to within about +/-30 seconds:
 *
 *   B = 360/365 * (n - 81)            (degrees)
 *   EoT = 9.87*sin(2B) - 7.53*cos(B) - 1.5*sin(B)   (minutes)
 *
 * Without this correction, hour angle (and therefore azimuth) can be
 * off by up to ~4 degrees at the extremes (mid-February / early
 * November) — small next to the +/-11-16% energy target, but it is a
 * standard, cheap correction, so there is no reason to skip it.
 */
export function equationOfTime(n: number): number {
  const b = DEG2RAD * ((360 / 365) * (n - 81));
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

/**
 * Hour angle (degrees) at the given UTC instant and longitude.
 *
 * Hour angle is 0 at local solar noon, negative in the morning,
 * positive in the afternoon, moving 15 degrees per hour (360
 * degrees / 24 hours).
 *
 * This works directly from UTC + longitude, deliberately avoiding
 * any timezone/standard-meridian lookup: local solar time is
 * mean-solar-time-at-this-longitude plus the equation-of-time
 * correction, and mean solar time at a given longitude is just UTC
 * shifted by longitude/15 hours (15 degrees of longitude = 1 hour).
 * That sidesteps an entire class of bugs (DST, political timezone
 * boundaries, missing tz data) that a "look up the timezone for
 * (lat,lng)" approach would invite — appropriate for a
 * zero-backend, no-paid-API tool that must work for any point on
 * Earth given only coordinates.
 */
export function hourAngle(date: Date, lng: number): number {
  const n = dayOfYear(date);
  const utcHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;
  const solarTimeHours =
    utcHours + lng / 15 + equationOfTime(n) / 60;
  return 15 * (solarTimeHours - 12);
}

export interface SolarPosition {
  /** Day of year, 1-366. */
  dayOfYear: number;
  /** Solar declination, degrees (-23.45 to +23.45). */
  declination: number;
  /** Hour angle, degrees (negative = morning, 0 = solar noon, positive = afternoon). */
  hourAngle: number;
  /** Solar altitude above the horizon, degrees (-90 to +90; negative = sun below horizon). */
  altitude: number;
  /**
   * Solar azimuth as a compass bearing, degrees (0 = North, 90 =
   * East, 180 = South, 270 = West), matching the convention roof
   * orientation will be expressed in downstream (app-rooftop-solar).
   */
  azimuth: number;
}

/**
 * Full solar position (declination, hour angle, altitude, azimuth)
 * for a given latitude/longitude and UTC instant.
 *
 * Derivation (standard spherical-astronomy horizon-coordinate
 * transform, e.g. Duffie & Beckman ch. 1):
 *
 *   sin(altitude) = sin(lat)*sin(dec) + cos(lat)*cos(dec)*cos(H)
 *
 *   azimuth (measured from South, positive toward West):
 *     gamma_s = atan2( sin(H), cos(H)*sin(lat) - tan(dec)*cos(lat) )
 *
 * atan2 is used (rather than acos + a manual sign(H) branch, which
 * is the more commonly seen textbook form) because it resolves the
 * correct quadrant automatically from the signs of both arguments —
 * removing an entire class of "forgot to flip the sign in the
 * morning" bugs that a manual branch invites.
 *
 * gamma_s is then converted from "0=South,+West" to a compass
 * bearing ("0=North,+East,clockwise") via (gamma_s + 180) mod 360,
 * since that is the convention the rest of this project uses for
 * orientation (roof azimuth, etc).
 */
export function solarPosition(
  lat: number,
  lng: number,
  date: Date,
): SolarPosition {
  const n = dayOfYear(date);
  const dec = solarDeclination(n);
  const H = hourAngle(date, lng);

  const latRad = lat * DEG2RAD;
  const decRad = dec * DEG2RAD;
  const hRad = H * DEG2RAD;

  const sinAltitude =
    Math.sin(decRad) * Math.sin(latRad) +
    Math.cos(decRad) * Math.cos(latRad) * Math.cos(hRad);
  // Clamp before asin: floating-point error can push |sinAltitude|
  // fractionally past 1 (e.g. 1.0000000000000002) at the poles/
  // solstices, which would otherwise make Math.asin return NaN.
  const clampedSinAltitude = Math.min(1, Math.max(-1, sinAltitude));
  const altitude = Math.asin(clampedSinAltitude) * RAD2DEG;

  const gammaSRad = Math.atan2(
    Math.sin(hRad),
    Math.cos(hRad) * Math.sin(latRad) - Math.tan(decRad) * Math.cos(latRad),
  );
  const gammaS = gammaSRad * RAD2DEG; // 0 = South, +West, range (-180, 180]
  const azimuth = ((gammaS + 180) % 360 + 360) % 360; // -> 0 = North, +East, [0, 360)

  return { dayOfYear: n, declination: dec, hourAngle: H, altitude, azimuth };
}
