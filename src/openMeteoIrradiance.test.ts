import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOpenMeteoAnnualGhi } from './openMeteoIrradiance';

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: { 'content-type': 'application/json' },
  });
}

/** Builds a synthetic daily series covering exactly the given years, each day 10 MJ/m^2. */
function dailySeriesForYears(years: number[], mjPerDay = 10) {
  const time: string[] = [];
  const shortwave_radiation_sum: number[] = [];
  for (const year of years) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const daysInYear = isLeap ? 366 : 365;
    for (let d = 0; d < daysInYear; d++) {
      const date = new Date(Date.UTC(year, 0, 1 + d));
      time.push(date.toISOString().slice(0, 10));
      shortwave_radiation_sum.push(mjPerDay);
    }
  }
  return { daily: { time, shortwave_radiation_sum } };
}

describe('fetchOpenMeteoAnnualGhi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the archive endpoint with the last N complete years relative to referenceDate', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url;
      return jsonResponse(dailySeriesForYears([2021, 2022, 2023]));
    });

    await fetchOpenMeteoAnnualGhi({
      lat: 37.5665,
      lng: 126.978,
      years: 3,
      referenceDate: new Date('2024-06-15T00:00:00Z'),
    });

    expect(capturedUrl).toContain('https://archive-api.open-meteo.com/v1/archive');
    expect(capturedUrl).toContain('latitude=37.5665');
    expect(capturedUrl).toContain('longitude=126.978');
    expect(capturedUrl).toContain('start_date=2021-01-01');
    expect(capturedUrl).toContain('end_date=2023-12-31');
    expect(capturedUrl).toContain('daily=shortwave_radiation_sum');
    expect(capturedUrl).toContain('timezone=UTC');
  });

  it('defaults to 5 years when not specified', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url;
      return jsonResponse(dailySeriesForYears([2019, 2020, 2021, 2022, 2023]));
    });
    await fetchOpenMeteoAnnualGhi({ lat: 0, lng: 0, referenceDate: new Date('2024-01-01T00:00:00Z') });
    expect(capturedUrl).toContain('start_date=2019-01-01');
    expect(capturedUrl).toContain('end_date=2023-12-31');
  });

  it('sums daily MJ/m^2 into an annual kWh/m^2 total and averages across years', async () => {
    // 10 MJ/day for a 365-day non-leap year -> 3650 MJ -> /3.6 kWh conversion.
    vi.stubGlobal('fetch', async () => jsonResponse(dailySeriesForYears([2021, 2023], 10)));
    const result = await fetchOpenMeteoAnnualGhi({
      lat: 37.5665,
      lng: 126.978,
      years: 2,
      referenceDate: new Date('2024-01-01T00:00:00Z'),
    });
    const expectedPerYear = (365 * 10) / 3.6;
    expect(result.yearlyTotals.length).toBe(2);
    expect(Math.abs(result.yearlyTotals[0]!.totalGhiKwhPerM2 - expectedPerYear)).toBeLessThan(1e-6);
    expect(Math.abs(result.annualGhiKwhPerM2 - expectedPerYear)).toBeLessThan(1e-6);
  });

  it('accounts for a leap year having one extra day', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(dailySeriesForYears([2020], 10))); // 2020 is a leap year
    const result = await fetchOpenMeteoAnnualGhi({
      lat: 0,
      lng: 0,
      years: 1,
      referenceDate: new Date('2021-01-01T00:00:00Z'),
    });
    expect(Math.abs(result.yearlyTotals[0]!.totalGhiKwhPerM2 - (366 * 10) / 3.6)).toBeLessThan(1e-6);
  });

  it('skips null/missing daily values instead of treating them as zero or crashing', async () => {
    const body = dailySeriesForYears([2023], 10);
    body.daily.shortwave_radiation_sum[5] = null as unknown as number;
    body.daily.shortwave_radiation_sum[10] = null as unknown as number;
    vi.stubGlobal('fetch', async () => jsonResponse(body));
    const result = await fetchOpenMeteoAnnualGhi({
      lat: 0,
      lng: 0,
      years: 1,
      referenceDate: new Date('2024-01-01T00:00:00Z'),
    });
    // 363 valid days (365 - 2 nulled) * 10 MJ, converted to kWh.
    expect(Math.abs(result.yearlyTotals[0]!.totalGhiKwhPerM2 - (363 * 10) / 3.6)).toBeLessThan(1e-6);
  });

  it('throws a descriptive error on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('', { status: 500, statusText: 'Internal Server Error' }),
    );
    await expect(fetchOpenMeteoAnnualGhi({ lat: 0, lng: 0 })).rejects.toThrow('500');
  });

  it('throws if the response has no usable daily data', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ daily: { time: [], shortwave_radiation_sum: [] } }));
    await expect(fetchOpenMeteoAnnualGhi({ lat: 0, lng: 0 })).rejects.toThrow();
  });

  it('throws for a non-positive years value', async () => {
    await expect(fetchOpenMeteoAnnualGhi({ lat: 0, lng: 0, years: 0 })).rejects.toThrow();
  });
});
