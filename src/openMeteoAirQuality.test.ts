import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAirQuality,
  nearestAerosolReading,
  type AirQualityResponse,
} from './openMeteoAirQuality';

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchAirQuality', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the documented Open-Meteo Air Quality endpoint with lat/lng/hourly/timezone params', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url;
      return jsonResponse({
        latitude: 37.5665,
        longitude: 126.978,
        hourly: { time: ['2026-01-01T00:00'], dust: [4], aerosol_optical_depth: [0.28] },
        hourly_units: { dust: 'ug/m3', aerosol_optical_depth: '' },
      });
    });

    await fetchAirQuality({ lat: 37.5665, lng: 126.978 });

    expect(capturedUrl).toContain('https://air-quality-api.open-meteo.com/v1/air-quality');
    expect(capturedUrl).toContain('latitude=37.5665');
    expect(capturedUrl).toContain('longitude=126.978');
    expect(capturedUrl).toContain('dust%2Caerosol_optical_depth');
    expect(capturedUrl).toContain('timezone=UTC');
  });

  it('defaults forecast_days to 1 when not specified, and honors it when given', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url;
      return jsonResponse({
        latitude: 0,
        longitude: 0,
        hourly: { time: [], dust: [], aerosol_optical_depth: [] },
        hourly_units: {},
      });
    });

    await fetchAirQuality({ lat: 0, lng: 0 });
    expect(capturedUrl).toContain('forecast_days=1');

    await fetchAirQuality({ lat: 0, lng: 0, forecastDays: 3 });
    expect(capturedUrl).toContain('forecast_days=3');
  });

  it('throws a descriptive error on a non-ok response instead of returning it', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('', { status: 500, statusText: 'Internal Server Error' }),
    );
    await expect(fetchAirQuality({ lat: 1, lng: 1 })).rejects.toThrow('500');
  });

  it('parses and returns the response JSON unchanged on success', async () => {
    const payload: AirQualityResponse = {
      latitude: 1,
      longitude: 2,
      hourly: { time: ['2026-01-01T00:00'], dust: [3], aerosol_optical_depth: [0.15] },
      hourly_units: { dust: 'ug/m3', aerosol_optical_depth: '' },
    };
    vi.stubGlobal('fetch', async () => jsonResponse(payload));
    const result = await fetchAirQuality({ lat: 1, lng: 2 });
    expect(result).toEqual(payload);
  });
});

describe('nearestAerosolReading', () => {
  function makeResponse(times: string[], dust: number[], aod: number[]): AirQualityResponse {
    return {
      latitude: 37.5665,
      longitude: 126.978,
      hourly: { time: times, dust, aerosol_optical_depth: aod },
      hourly_units: { dust: 'ug/m3', aerosol_optical_depth: '' },
    };
  }

  it('picks the exact-match hour when one exists', () => {
    const resp = makeResponse(
      ['2026-01-01T00:00', '2026-01-01T01:00', '2026-01-01T02:00'],
      [1, 2, 3],
      [0.1, 0.2, 0.3],
    );
    const r = nearestAerosolReading(resp, new Date('2026-01-01T01:00:00Z'));
    expect(r).toEqual({ aerosolOpticalDepth: 0.2, dust: 2, time: '2026-01-01T01:00' });
  });

  it('rounds to whichever of two straddling hours is closer', () => {
    const resp = makeResponse(['2026-01-01T00:00', '2026-01-01T01:00'], [10, 20], [0.1, 0.9]);

    const closerToLate = nearestAerosolReading(resp, new Date('2026-01-01T00:50:00Z'));
    expect(closerToLate?.time).toBe('2026-01-01T01:00');

    const closerToEarly = nearestAerosolReading(resp, new Date('2026-01-01T00:10:00Z'));
    expect(closerToEarly?.time).toBe('2026-01-01T00:00');
  });

  it('returns null for an empty response', () => {
    expect(nearestAerosolReading(makeResponse([], [], []))).toBe(null);
  });

  it('returns null when the hourly arrays have mismatched lengths', () => {
    const resp = makeResponse(['2026-01-01T00:00', '2026-01-01T01:00'], [1], [0.1, 0.2]);
    expect(nearestAerosolReading(resp)).toBe(null);
  });
});
