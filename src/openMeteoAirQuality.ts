/**
 * Client for Open-Meteo's Air Quality API -- the source of the `dust` and
 * `aerosol_optical_depth` inputs aerosolCorrection.ts needs.
 *
 * Docs: https://open-meteo.com/en/docs/air-quality-api
 * Endpoint: https://air-quality-api.open-meteo.com/v1/air-quality
 * Free for non-commercial use, no API key required (CLAUDE.md's zero-cost
 * constraint). `timezone=UTC` is passed explicitly so the returned
 * timestamps are unambiguous ISO8601-without-offset strings in UTC, rather
 * than depending on Open-Meteo's undocumented default.
 *
 * CORS: verified with a real cross-origin browser fetch (a page on
 * https://example.com fetching this endpoint) before relying on it here,
 * per CLAUDE.md's "Verify CORS with one real browser fetch before relying
 * on it" instruction -- the fetch succeeded and returned readable JSON
 * (dust in ug/m^3, aerosol_optical_depth dimensionless), which is only
 * possible if the response carries a permissive Access-Control-Allow-Origin
 * header (a request GitHub's own strict CSP blocks outright was used as a
 * negative control to confirm "Failed to fetch" would look different).
 */

const AIR_QUALITY_API_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';

export interface AirQualityHourly {
  time: string[];
  /** Surface dust concentration, ug/m^3. */
  dust: number[];
  /** Column aerosol optical depth (~550nm), dimensionless. */
  aerosol_optical_depth: number[];
}

export interface AirQualityResponse {
  latitude: number;
  longitude: number;
  hourly: AirQualityHourly;
  hourly_units: Record<string, string>;
}

export interface FetchAirQualityInput {
  lat: number;
  lng: number;
  /** Defaults to 1 (today only). */
  forecastDays?: number;
}

/**
 * Fetches hourly dust + aerosol_optical_depth for a location. Throws on a
 * non-2xx response; does not retry or cache (callers that need resilience,
 * e.g. the ensembling layer in step 5, should wrap this).
 */
export async function fetchAirQuality(input: FetchAirQualityInput): Promise<AirQualityResponse> {
  const params = new URLSearchParams({
    latitude: String(input.lat),
    longitude: String(input.lng),
    hourly: 'dust,aerosol_optical_depth',
    forecast_days: String(input.forecastDays ?? 1),
    timezone: 'UTC',
  });
  const url = `${AIR_QUALITY_API_BASE}?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Open-Meteo Air Quality API request failed: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as AirQualityResponse;
}

export interface AerosolReading {
  aerosolOpticalDepth: number;
  dust: number;
  time: string;
}

/**
 * Picks the hourly reading whose timestamp is closest to `atTime`
 * (defaults to now), rather than assuming the API's first or last entry
 * is "current" -- `forecast_days` includes the full day's hours, some of
 * which are in the past relative to the moment of the request.
 *
 * Returns null if the response has no hourly data, or if the three
 * hourly arrays are inconsistent lengths (a malformed/unexpected response
 * we'd rather surface as "no reading" than silently misalign).
 */
export function nearestAerosolReading(
  response: AirQualityResponse,
  atTime: Date = new Date(),
): AerosolReading | null {
  const { time, dust, aerosol_optical_depth: aod } = response.hourly;
  if (time.length === 0 || dust.length !== time.length || aod.length !== time.length) {
    return null;
  }

  const targetMs = atTime.getTime();
  let bestIndex = 0;
  let bestDiffMs = Number.POSITIVE_INFINITY;
  for (let i = 0; i < time.length; i++) {
    const iso = time[i];
    if (iso === undefined) continue;
    const parsedMs = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
    if (!Number.isFinite(parsedMs)) continue;
    const diffMs = Math.abs(parsedMs - targetMs);
    if (diffMs < bestDiffMs) {
      bestDiffMs = diffMs;
      bestIndex = i;
    }
  }

  const bestTime = time[bestIndex];
  const bestDust = dust[bestIndex];
  const bestAod = aod[bestIndex];
  if (bestTime === undefined || bestDust === undefined || bestAod === undefined) {
    return null;
  }
  return { aerosolOpticalDepth: bestAod, dust: bestDust, time: bestTime };
}
