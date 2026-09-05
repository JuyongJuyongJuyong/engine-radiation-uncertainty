/**
 * monthlyTransposition — bridges NASA POWER's / Open-Meteo's climatological
 * MONTHLY-AVERAGE horizontal irradiation (kWh/m^2/day per calendar month)
 * into an annual plane-of-array (POA) estimate, using the physics chain
 * that needs hourly resolution (solarGeometry -> Erbs -> Perez) that this
 * engine's two irradiance sources (see nasaPower.ts, openMeteoIrradiance.ts)
 * do not themselves provide -- they publish daily/monthly/annual totals,
 * never an hourly time series. index.ts is where this module is wired
 * into getRadiationEstimate().
 *
 * Method: Klein & Theilacker's "representative day of the month" approach
 * (Klein, S.A., 1977, "Calculation of Monthly Average Insolation on Tilted
 * Surfaces", Solar Energy 19(4), 325-329) combined with Collares-Pereira &
 * Rabl's (1979) correlation for splitting a day's total horizontal
 * irradiation into hourly values (Collares-Pereira, M. and Rabl, A., "The
 * average distribution of solar radiation -- correlations between diffuse
 * and hemispherical and between daily and hourly insolation values", Solar
 * Energy 22, 155-164). Both are reproduced in Duffie & Beckman, "Solar
 * Engineering of Thermal Processes" (the same reference already cited by
 * solarGeometry.ts and erbsCorrelation.ts) -- eq. 1.6.1 (representative
 * days) and eq. 2.13.2/2.13.4 (r_t correlation).
 *
 * For each calendar month:
 *   1. Use Klein & Theilacker's recommended "mean day" (the day whose
 *      declination is closest to the month's average declination) as a
 *      single statistically representative day, rather than an arbitrary
 *      mid-month date.
 *   2. For each of that day's 24 hours, split the month's average daily
 *      GHI into an hourly value via the Collares-Pereira & Rabl r_t
 *      correlation -- a function of that hour's hour angle and the day's
 *      sunset hour angle only, needing no measured hourly data.
 *   3. Run the existing hourly chain (Erbs decomposition -> Perez
 *      transposition) on each synthesized hourly GHI value and sum the
 *      day's POA.
 *   4. That day's (POA total / GHI total) is the month's transposition
 *      factor and its GHI-weighted average kt is the month's clearness
 *      index; both are then weighted by days-in-month and averaged across
 *      the year.
 *
 * This is a genuine, disclosed APPROXIMATION, not a measurement: real
 * hourly GHI on any given day deviates from this statistically "typical"
 * clear/cloudy-day shape (clouds don't respect a smooth curve), so the
 * resulting transpositionFactor and clearnessIndex carry their own model
 * error on top of whatever the underlying monthly-average GHI itself
 * carries -- see index.ts's TRANSPOSITION_MODEL_RELATIVE_STD_DEV comment
 * for how that is disclosed in the exported uncertainty, and CLAUDE.md's
 * "never claim precision the data doesn't support" rule.
 *
 * Aerosol correction is intentionally NOT applied inside this module: it
 * would need an hourly/monthly aerosol-optical-depth series (Open-Meteo
 * Air Quality API, see openMeteoAirQuality.ts), which is a real
 * measurement this engine ensembles elsewhere -- layering a second,
 * unrelated statistical approximation underneath this one, for a
 * sub-3%-of-GHI effect per aerosolCorrection.ts's own module doc, is not
 * worth the added false precision here. index.ts is where a real AOD
 * series would be applied, if/when it is wired in.
 */
import { degToRad, radToDeg } from './angles';
import { altitudeAzimuthFromHourAngle, solarDeclination } from './solarGeometry';
import { erbsDecomposition, extraterrestrialNormalIrradiance } from './erbsCorrelation';
import { transposeToPOA } from './perezTransposition';

export const MONTH_KEYS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;
export type MonthKey = (typeof MONTH_KEYS)[number];

/**
 * Klein & Theilacker (1977) recommended "mean day" of each month, as
 * day-of-year (1-366, non-leap-year numbering -- a leap year's extra day
 * shifts these by at most 1 day of declination, negligible at this
 * method's own precision).
 */
export const REPRESENTATIVE_DAY_OF_YEAR: Record<MonthKey, number> = {
  JAN: 17,
  FEB: 47,
  MAR: 75,
  APR: 105,
  MAY: 135,
  JUN: 162,
  JUL: 198,
  AUG: 228,
  SEP: 258,
  OCT: 288,
  NOV: 318,
  DEC: 344,
};

/** Average days in each calendar month across a 4-year leap cycle; sums to 365.25. */
export const AVG_DAYS_IN_MONTH: Record<MonthKey, number> = {
  JAN: 31,
  FEB: 28.25,
  MAR: 31,
  APR: 30,
  MAY: 31,
  JUN: 30,
  JUL: 31,
  AUG: 31,
  SEP: 30,
  OCT: 31,
  NOV: 30,
  DEC: 31,
};

/** Sunset hour angle (degrees), clamped for polar day/night. */
function sunsetHourAngleDeg(latDeg: number, declinationDeg: number): number {
  const cosOmegaS = -Math.tan(degToRad(latDeg)) * Math.tan(degToRad(declinationDeg));
  const clamped = Math.min(1, Math.max(-1, cosOmegaS));
  return radToDeg(Math.acos(clamped));
}

/**
 * Collares-Pereira & Rabl (1979) r_t: the fraction of a day's total
 * horizontal irradiation falling in the 1-hour bin centered on hourAngleDeg
 * (solar time), given that day's sunset hour angle. Returns 0 outside
 * daylight hours (|hourAngleDeg| >= sunsetHourAngleDeg).
 */
export function collaresPereiraRablRt(hourAngleDeg: number, sunsetAngleDeg: number): number {
  if (Math.abs(hourAngleDeg) >= sunsetAngleDeg) return 0;
  const hsRad = degToRad(sunsetAngleDeg);
  const hRad = degToRad(hourAngleDeg);
  const a = 0.409 + 0.5016 * Math.sin(hsRad - degToRad(60));
  const b = 0.6609 - 0.4767 * Math.sin(hsRad - degToRad(60));
  const cosH = Math.cos(hRad);
  const cosHs = Math.cos(hsRad);
  const denominator = Math.sin(hsRad) - hsRad * cosHs;
  if (denominator <= 1e-9) return 0;
  const numerator = (a + b * cosH) * (cosH - cosHs);
  const rt = (Math.PI / 24) * (numerator / denominator);
  return rt > 0 ? rt : 0;
}

export interface RepresentativeDayInput {
  lat: number;
  /** That month's average daily GHI, kWh/m^2/day. */
  dailyGhiKwhPerM2: number;
  dayOfYear: number;
  surfaceTiltDeg: number;
  surfaceAzimuthDeg: number;
  albedo: number;
}

export interface RepresentativeDayOutput {
  /** This day's POA total, kWh/m^2/day. */
  poaKwhPerM2: number;
  /** GHI-weighted average clearness index kt across this day's daylight hours. */
  clearnessIndex: number;
}

/**
 * Runs the full hourly chain (Collares-Pereira & Rabl hourly split ->
 * Erbs decomposition -> Perez transposition) over one representative
 * day's 24 hours and returns that day's POA total and GHI-weighted kt.
 *
 * Hour bins are centered on solar-time hour angles -172.5 .. +172.5 deg in
 * 15 deg (1 hour) steps -- i.e. the midpoint of each of the 24 clock
 * hours in solar time, matching the convention the Collares-Pereira & Rabl
 * correlation is defined for.
 */
export function transposeRepresentativeDay(input: RepresentativeDayInput): RepresentativeDayOutput {
  const { lat, dailyGhiKwhPerM2, dayOfYear, surfaceTiltDeg, surfaceAzimuthDeg, albedo } = input;
  if (dailyGhiKwhPerM2 <= 0) {
    return { poaKwhPerM2: 0, clearnessIndex: 0 };
  }

  const dec = solarDeclination(dayOfYear);
  const sunsetAngle = sunsetHourAngleDeg(lat, dec);
  const dniExtra = extraterrestrialNormalIrradiance(dayOfYear);

  let poaWhTotal = 0;
  let ghiWeightedKtSum = 0;
  let ghiWhTotal = 0;

  for (let hourIndex = 0; hourIndex < 24; hourIndex++) {
    const hourAngle = 15 * (hourIndex + 0.5 - 12); // deg, solar time
    const rt = collaresPereiraRablRt(hourAngle, sunsetAngle);
    if (rt <= 0) continue;

    // 1-hour bin: kWh/m^2 for that hour numerically equals the hour's
    // average W/m^2 x 1000 / 1000 -- i.e. this IS the average W/m^2 for
    // that hour once multiplied by 1000 below, since kWh/m^2 over a
    // 1-hour bin and average-W/m^2-during-that-hour differ by exactly
    // the Wh<->kWh factor of 1000.
    const hourlyGhiKwh = rt * dailyGhiKwhPerM2;
    const hourlyGhiWm2 = hourlyGhiKwh * 1000;

    const { altitude, azimuth } = altitudeAzimuthFromHourAngle(lat, dec, hourAngle);
    if (altitude <= 0) continue; // sun below horizon; rt should already guard this, kept as a defensive check
    const zenithDeg = 90 - altitude;

    const erbs = erbsDecomposition({ ghi: hourlyGhiWm2, zenithDeg, dayOfYear });
    const poa = transposeToPOA({
      ghi: hourlyGhiWm2,
      dhi: erbs.dhi,
      dni: erbs.dni,
      dniExtra,
      solarZenithDeg: zenithDeg,
      solarAzimuthDeg: azimuth,
      surfaceTiltDeg,
      surfaceAzimuthDeg,
      albedo,
    });

    poaWhTotal += poa.poaGlobal; // W/m^2 for a 1-hour bin == Wh/m^2 for that hour
    ghiWhTotal += hourlyGhiWm2;
    ghiWeightedKtSum += erbs.kt * hourlyGhiWm2;
  }

  return {
    poaKwhPerM2: poaWhTotal / 1000,
    clearnessIndex: ghiWhTotal > 0 ? ghiWeightedKtSum / ghiWhTotal : 0,
  };
}

export interface AnnualTranspositionInput {
  lat: number;
  /** Twelve climatological monthly averages, kWh/m^2/day, keyed JAN..DEC (as returned by nasaPower.ts). */
  monthlyAvgKwhPerM2PerDay: Partial<Record<MonthKey, number>>;
  surfaceTiltDeg: number;
  surfaceAzimuthDeg: number;
  albedo: number;
}

export interface AnnualTranspositionOutput {
  /** Annual POA / annual GHI, days-in-month-weighted across the twelve representative days. */
  transpositionFactor: number;
  /** Annual GHI-weighted average clearness index, same weighting. */
  clearnessIndex: number;
  /** Number of months actually used (nasaPower.ts can return fewer than 12 if some are unfilled/fill-valued). */
  monthsUsed: number;
}

/**
 * Averages transposeRepresentativeDay() across all twelve (or however many
 * are available) calendar months, weighted by days-in-month, to produce
 * one annual transpositionFactor and clearnessIndex -- the two
 * intermediate values RadiationOutput exports (see index.ts).
 */
export function estimateAnnualTransposition(input: AnnualTranspositionInput): AnnualTranspositionOutput {
  const { lat, monthlyAvgKwhPerM2PerDay, surfaceTiltDeg, surfaceAzimuthDeg, albedo } = input;

  let weightedPoaKwh = 0;
  let weightedGhiKwh = 0;
  let weightedKtNumerator = 0;
  let monthsUsed = 0;

  for (const month of MONTH_KEYS) {
    const dailyGhi = monthlyAvgKwhPerM2PerDay[month];
    if (typeof dailyGhi !== 'number' || !Number.isFinite(dailyGhi) || dailyGhi <= 0) continue;

    const days = AVG_DAYS_IN_MONTH[month];
    const day = transposeRepresentativeDay({
      lat,
      dailyGhiKwhPerM2: dailyGhi,
      dayOfYear: REPRESENTATIVE_DAY_OF_YEAR[month],
      surfaceTiltDeg,
      surfaceAzimuthDeg,
      albedo,
    });

    weightedPoaKwh += day.poaKwhPerM2 * days;
    weightedGhiKwh += dailyGhi * days;
    weightedKtNumerator += day.clearnessIndex * dailyGhi * days;
    monthsUsed += 1;
  }

  if (monthsUsed === 0 || weightedGhiKwh <= 0) {
    throw new Error('estimateAnnualTransposition: no usable monthly GHI values (need at least one month > 0)');
  }

  return {
    transpositionFactor: weightedPoaKwh / weightedGhiKwh,
    clearnessIndex: weightedKtNumerator / weightedGhiKwh,
    monthsUsed,
  };
}
