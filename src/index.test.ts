import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRadiationEstimate } from './index';

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: { 'content-type': 'application/json' },
  });
}

// Representative NASA POWER climatology for a mid-latitude northern-hemisphere point.
function nasaPowerBody() {
  return {
    properties: {
      parameter: {
        ALLSKY_SFC_SW_DWN: {
          JAN: 2.4204,
          FEB: 3.1997,
          MAR: 4.3008,
          APR: 5.0244,
          MAY: 5.5639,
          JUN: 5.2457,
          JUL: 4.2082,
          AUG: 4.4993,
          SEP: 4.1798,
          OCT: 3.5909,
          NOV: 2.4418,
          DEC: 2.1118,
          ANN: 3.9007,
        },
      },
    },
  };
}

// Two full non-leap years of a flat, plausible daily shortwave_radiation_sum
// (MJ/m^2/day) so fetchOpenMeteoAnnualGhi has something consistent to average.
function openMeteoBody() {
  const time: string[] = [];
  const shortwave_radiation_sum: number[] = [];
  for (const year of [2023, 2024]) {
    for (let month = 1; month <= 12; month++) {
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
      for (let day = 1; day <= daysInMonth; day++) {
        time.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
        shortwave_radiation_sum.push(14.0); // MJ/m^2/day -> ~3.9 kWh/m^2/day, close to the NASA POWER body above
      }
    }
  }
  return { daily: { time, shortwave_radiation_sum } };
}

function routedFetch(overrides: { nasaOk?: boolean; openMeteoOk?: boolean } = {}) {
  const { nasaOk = true, openMeteoOk = true } = overrides;
  return async (url: string) => {
    if (url.includes('power.larc.nasa.gov')) {
      return nasaOk ? jsonResponse(nasaPowerBody()) : new Response('', { status: 500, statusText: 'Internal Server Error' });
    }
    if (url.includes('archive-api.open-meteo.com')) {
      return openMeteoOk
        ? jsonResponse(openMeteoBody())
        : new Response('', { status: 403, statusText: 'Forbidden' });
    }
    throw new Error(`unexpected fetch URL in test: ${url}`);
  };
}

describe('getRadiationEstimate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a physically plausible annual estimate when both sources succeed', async () => {
    vi.stubGlobal('fetch', routedFetch());
    const result = await getRadiationEstimate({ lat: 37.5665, lng: 126.978, tier: 1 });

    // Seoul-like climatology (~1424 kWh/m^2/year GHI): a latitude-tilt,
    // equator-facing POA estimate should stay within a wide but sane band.
    expect(result.kWh_per_m2_per_year).toBeGreaterThan(1000);
    expect(result.kWh_per_m2_per_year).toBeLessThan(2200);

    expect(result.uncertainty_ci_90[0]).toBeLessThan(result.kWh_per_m2_per_year);
    expect(result.uncertainty_ci_90[1]).toBeGreaterThan(result.kWh_per_m2_per_year);

    expect(result.clearnessIndex).toBeGreaterThan(0);
    expect(result.clearnessIndex as number).toBeLessThanOrEqual(1);

    expect(result.transpositionFactor).toBeGreaterThan(0.8);
    expect(result.transpositionFactor as number).toBeLessThan(1.3);
  });

  it('falls back to NASA POWER alone when Open-Meteo fails, without throwing', async () => {
    vi.stubGlobal('fetch', routedFetch({ openMeteoOk: false }));
    const result = await getRadiationEstimate({ lat: 37.5665, lng: 126.978, tier: 1 });
    expect(result.kWh_per_m2_per_year).toBeGreaterThan(0);
    expect(Number.isFinite(result.uncertainty_ci_90[0])).toBe(true);
    expect(Number.isFinite(result.uncertainty_ci_90[1])).toBe(true);
  });

  it('propagates NASA POWER failures (the one required source)', async () => {
    vi.stubGlobal('fetch', routedFetch({ nasaOk: false }));
    await expect(getRadiationEstimate({ lat: 37.5665, lng: 126.978, tier: 1 })).rejects.toThrow();
  });

  it('produces a sane, finite result for a southern-hemisphere point', async () => {
    // Note: this does NOT assert north/south transpositionFactor symmetry.
    // This test's mock monthly GHI shape is a real *northern*-hemisphere
    // seasonal curve (peaks in local summer, Jun); mirroring only the
    // latitude sign without also shifting the seasonal GHI curve by 6
    // months breaks the physical symmetry between the two calls (a
    // southern-hemisphere point's real summer is Dec-Feb, not Jun-Aug) --
    // so a large difference here versus the northern case is expected and
    // correct, not a bug. This test only checks the southern branch
    // (negative latitude, azimuthDeg=0 per defaultSurfaceForLatitude)
    // still produces a physically sane, finite result.
    vi.stubGlobal('fetch', routedFetch());
    const south = await getRadiationEstimate({ lat: -37.5665, lng: 126.978, tier: 1 });
    expect(Number.isFinite(south.kWh_per_m2_per_year)).toBe(true);
    expect(south.kWh_per_m2_per_year).toBeGreaterThan(0);
    expect(south.transpositionFactor as number).toBeGreaterThan(0.3);
    expect(south.transpositionFactor as number).toBeLessThan(2.5);
  });

  it('is deterministic for the same inputs (fixed default seed in propagateUncertainty)', async () => {
    vi.stubGlobal('fetch', routedFetch());
    const a = await getRadiationEstimate({ lat: 37.5665, lng: 126.978, tier: 1 });
    vi.stubGlobal('fetch', routedFetch());
    const b = await getRadiationEstimate({ lat: 37.5665, lng: 126.978, tier: 1 });
    expect(a.kWh_per_m2_per_year).toBe(b.kWh_per_m2_per_year);
    expect(a.uncertainty_ci_90).toEqual(b.uncertainty_ci_90);
  });
});
