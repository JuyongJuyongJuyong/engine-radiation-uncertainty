import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNasaPowerAnnualGhi } from './nasaPower';

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers: { 'content-type': 'application/json' },
  });
}

function climatologyBody(annOverride?: number) {
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
          ANN: annOverride ?? 3.9007,
        },
      },
    },
  };
}

describe('fetchNasaPowerAnnualGhi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the climatology endpoint with the documented parameters', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = url;
      return jsonResponse(climatologyBody());
    });

    await fetchNasaPowerAnnualGhi({ lat: 37.5665, lng: 126.978 });

    expect(capturedUrl).toContain('https://power.larc.nasa.gov/api/temporal/climatology/point');
    expect(capturedUrl).toContain('parameters=ALLSKY_SFC_SW_DWN');
    expect(capturedUrl).toContain('community=RE');
    expect(capturedUrl).toContain('latitude=37.5665');
    expect(capturedUrl).toContain('longitude=126.978');
    expect(capturedUrl).toContain('format=JSON');
  });

  it('converts the ANN daily-average value to an annual total via x365.25', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(climatologyBody(3.9007)));
    const result = await fetchNasaPowerAnnualGhi({ lat: 37.5665, lng: 126.978 });
    expect(Math.abs(result.annualGhiKwhPerM2 - 3.9007 * 365.25)).toBeLessThan(1e-9);
  });

  it('passes through the twelve monthly averages', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(climatologyBody()));
    const result = await fetchNasaPowerAnnualGhi({ lat: 37.5665, lng: 126.978 });
    expect(result.monthlyAvgKwhPerM2PerDay.JAN).toBe(2.4204);
    expect(result.monthlyAvgKwhPerM2PerDay.JUL).toBe(4.2082);
  });

  it('throws a descriptive error on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('', { status: 500, statusText: 'Internal Server Error' }),
    );
    await expect(fetchNasaPowerAnnualGhi({ lat: 0, lng: 0 })).rejects.toThrow('500');
  });

  it('throws when the response is missing the expected parameter shape', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ properties: { parameter: {} } }));
    await expect(fetchNasaPowerAnnualGhi({ lat: 0, lng: 0 })).rejects.toThrow();
  });

  it('throws when ANN is the -999 fill-value sentinel', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(climatologyBody(-999)));
    await expect(fetchNasaPowerAnnualGhi({ lat: 0, lng: 0 })).rejects.toThrow();
  });

  it('throws when ANN is negative or non-finite', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(climatologyBody(-5)));
    await expect(fetchNasaPowerAnnualGhi({ lat: 0, lng: 0 })).rejects.toThrow();
  });
});
