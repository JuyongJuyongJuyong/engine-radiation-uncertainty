/**
 * Client for NASA POWER's climatology endpoint -- one of the (at least
 * two, per CLAUDE.md) free irradiance sources this engine ensembles.
 *
 * Docs: https://power.larc.nasa.gov/docs/services/api/
 * Endpoint (verified against the live API, not just docs prose --
 * WebFetch's summarizer dropped the concrete URL/params the first two
 * times it was asked, the same failure mode hit while sourcing the Perez
 * coefficients in step 3, so this was confirmed with a real request):
 * https://power.larc.nasa.gov/api/temporal/climatology/point
 *   ?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=..&latitude=..&format=JSON
 *
 * ALLSKY_SFC_SW_DWN is all-sky surface downward shortwave radiation, i.e.
 * GHI, in kWh/m^2/day, as a multi-decadal (~20yr) climatological monthly
 * + annual ("ANN") average. No API key, no documented rate limit (the
 * team asks for fair use), free for this project's zero-cost constraint.
 *
 * CORS: verified with a real cross-origin browser fetch (example.com ->
 * power.larc.nasa.gov) -- succeeded and returned readable JSON, unlike
 * PVGIS (see irradianceEnsemble.ts's sibling research: PVGIS's MRcalc and
 * seriescalc endpoints both fail cross-origin fetch from a browser on
 * v5_2 and v5_3, confirmed against an Open-Meteo control that succeeded
 * from the same page), which is why PVGIS is not one of this engine's two
 * sources despite CLAUDE.md flagging it as the Tier 1/NSRDB-grade choice.
 */

const NASA_POWER_CLIMATOLOGY_BASE = 'https://power.larc.nasa.gov/api/temporal/climatology/point';

/** NASA POWER's documented fill value for missing data. */
const NASA_POWER_FILL_VALUE = -999;

export interface NasaPowerAnnualGhiInput {
  lat: number;
  lng: number;
}

export interface NasaPowerAnnualGhiOutput {
  /** ANN climatological daily average x 365.25, kWh/m^2/year. */
  annualGhiKwhPerM2: number;
  /** The twelve climatological monthly averages, kWh/m^2/day, keyed JAN..DEC. */
  monthlyAvgKwhPerM2PerDay: Record<string, number>;
}

interface NasaPowerClimatologyResponse {
  properties: {
    parameter: {
      ALLSKY_SFC_SW_DWN?: Record<string, number>;
    };
  };
}

export async function fetchNasaPowerAnnualGhi(
  input: NasaPowerAnnualGhiInput,
): Promise<NasaPowerAnnualGhiOutput> {
  const params = new URLSearchParams({
    parameters: 'ALLSKY_SFC_SW_DWN',
    community: 'RE',
    longitude: String(input.lng),
    latitude: String(input.lat),
    format: 'JSON',
  });
  const url = `${NASA_POWER_CLIMATOLOGY_BASE}?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`NASA POWER API request failed: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as NasaPowerClimatologyResponse;
  const byMonth = body.properties?.parameter?.ALLSKY_SFC_SW_DWN;
  if (!byMonth) {
    throw new Error('NASA POWER response is missing properties.parameter.ALLSKY_SFC_SW_DWN');
  }

  const ann = byMonth.ANN;
  if (typeof ann !== 'number' || !Number.isFinite(ann) || ann === NASA_POWER_FILL_VALUE || ann < 0) {
    throw new Error(`NASA POWER returned an unusable annual (ANN) value: ${String(ann)}`);
  }

  const monthlyAvgKwhPerM2PerDay: Record<string, number> = {};
  for (const month of ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']) {
    const value = byMonth[month];
    if (typeof value === 'number' && Number.isFinite(value) && value !== NASA_POWER_FILL_VALUE) {
      monthlyAvgKwhPerM2PerDay[month] = value;
    }
  }

  return {
    annualGhiKwhPerM2: ann * 365.25,
    monthlyAvgKwhPerM2PerDay,
  };
}
