/**
 * Client for Open-Meteo's Historical Weather (Archive) API -- originally
 * built as the second of this engine's (at least two, per CLAUDE.md) free
 * irradiance sources, but flagged here as an AT-RISK / DO-NOT-DEPEND-ON
 * source after a cost-exposure review on 2026-09-04:
 *
 * Open-Meteo's own pricing page (https://open-meteo.com/en/pricing) and
 * its "API Subscriptions for Commercial Use" post list the "Historical
 * Weather API" BY NAME -- exactly this product -- as included only in the
 * paid Professional plan ($99/mo) or higher, grouped with the Climate,
 * Ensemble, and Satellite Radiation APIs (all also gated). That is a
 * narrower, separate carve-out from Open-Meteo's general free/
 * non-commercial tier (600/min, 5,000/hr, 10,000/day, 300,000/month),
 * which does still cover the Forecast, Air Quality (see
 * openMeteoAirQuality.ts), Marine, Geocoding, and Elevation APIs. So the
 * "free for non-commercial use, no API key" claim this file previously
 * made about the Historical Weather API specifically was not correct.
 *
 * Whether the unauthenticated CORS smoke test noted below still succeeds
 * today is unresolved -- this project's review sandbox's network policy
 * blocks direct requests to archive-api.open-meteo.com, so it could not
 * be re-verified live. Given that, this module MUST NOT be wired into
 * getRadiationEstimate() (src/index.ts) as a required source: if used at
 * all, it must be optional/best-effort (its failure caught, never
 * awaited un-guarded) so a 401/403 here degrades the ensemble to NASA
 * POWER alone (nasaPower.ts, which has no such gate) rather than breaking
 * the whole estimate. See CLAUDE.md's "Irradiance ensembling" note.
 *
 * This is a different Open-Meteo product from openMeteoAirQuality.ts
 * (that one is the Air Quality API, used for dust/aerosol correction in
 * step 4, and is unaffected by the above -- it's on the free tier).
 *
 * Docs: https://open-meteo.com/en/docs/historical-weather-api
 * Endpoint: https://archive-api.open-meteo.com/v1/archive
 * Daily parameter: shortwave_radiation_sum (MJ/m^2/day -- GHI integrated
 * over the day), backed by ERA5 reanalysis back to 1940.
 *
 * Unlike NASA POWER's climatology endpoint, Open-Meteo does not publish a
 * pre-computed multi-decadal average here, so this module builds one:
 * fetch daily GHI for the last N *complete* calendar years (the current,
 * still-in-progress year is deliberately excluded so every year in the
 * average is a fair, fully-observed annual total), sum each year's daily
 * MJ/m^2 into an annual total, convert to kWh/m^2 (1 kWh = 3.6 MJ), and
 * average across years. `timezone=UTC` is passed explicitly (as in
 * openMeteoAirQuality.ts) so "which calendar year a day belongs to" is
 * unambiguous.
 *
 * CORS: verified with a real cross-origin browser fetch (example.com ->
 * archive-api.open-meteo.com), before the paid-tier gate above was
 * discovered -- succeeded and returned readable daily data (annual total
 * for Seoul, 2023, came out to ~1441 kWh/m^2, close to NASA POWER's
 * climatological ~1424 kWh/m^2/year for the same point -- a useful
 * cross-source sanity check, not a formal validation, and not proof this
 * still works unauthenticated today).
 */

const ARCHIVE_API_BASE = 'https://archive-api.open-meteo.com/v1/archive';

/** 1 kWh = 3.6 MJ. */
const MJ_PER_KWH = 3.6;

export interface OpenMeteoAnnualGhiInput {
  lat: number;
  lng: number;
  /** Number of most-recent *complete* calendar years to average over. Defaults to 5. */
  years?: number;
  /**
   * What "now" is, for computing which years are complete. Defaults to
   * the real current time; overridable so date-range logic is testable
   * without depending on the day the test happens to run.
   */
  referenceDate?: Date;
}

export interface YearlyGhiTotal {
  year: number;
  totalGhiKwhPerM2: number;
}

export interface OpenMeteoAnnualGhiOutput {
  /** Mean of each complete year's total GHI, kWh/m^2/year. */
  annualGhiKwhPerM2: number;
  /** The per-year totals the mean was built from, oldest first. */
  yearlyTotals: YearlyGhiTotal[];
}

interface OpenMeteoArchiveResponse {
  daily: {
    time: string[];
    shortwave_radiation_sum: Array<number | null>;
  };
}

export async function fetchOpenMeteoAnnualGhi(
  input: OpenMeteoAnnualGhiInput,
): Promise<OpenMeteoAnnualGhiOutput> {
  const years = input.years ?? 5;
  if (years < 1) {
    throw new Error(`years must be >= 1, got ${years}`);
  }
  const referenceYear = (input.referenceDate ?? new Date()).getUTCFullYear();
  const endYear = referenceYear - 1; // last fully-elapsed calendar year
  const startYear = endYear - years + 1;

  const params = new URLSearchParams({
    latitude: String(input.lat),
    longitude: String(input.lng),
    start_date: `${startYear}-01-01`,
    end_date: `${endYear}-12-31`,
    daily: 'shortwave_radiation_sum',
    timezone: 'UTC',
  });
  const url = `${ARCHIVE_API_BASE}?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo Archive API request failed: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as OpenMeteoArchiveResponse;
  const { time, shortwave_radiation_sum: dailyMj } = body.daily;

  const totalMjByYear = new Map<number, number>();
  for (let i = 0; i < time.length; i++) {
    const iso = time[i];
    const value = dailyMj[i];
    if (iso === undefined || value === null || value === undefined || !Number.isFinite(value)) {
      continue; // skip days the API couldn't fill in
    }
    const year = Number(iso.slice(0, 4));
    totalMjByYear.set(year, (totalMjByYear.get(year) ?? 0) + value);
  }

  const yearlyTotals: YearlyGhiTotal[] = [...totalMjByYear.entries()]
    .sort(([yearA], [yearB]) => yearA - yearB)
    .map(([year, totalMj]) => ({ year, totalGhiKwhPerM2: totalMj / MJ_PER_KWH }));

  if (yearlyTotals.length === 0) {
    throw new Error('Open-Meteo Archive API returned no usable daily radiation data for this range');
  }

  const annualGhiKwhPerM2 =
    yearlyTotals.reduce((sum, y) => sum + y.totalGhiKwhPerM2, 0) / yearlyTotals.length;

  return { annualGhiKwhPerM2, yearlyTotals };
}
