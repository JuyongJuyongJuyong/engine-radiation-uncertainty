import { describe, expect, it } from 'vitest';
import {
  dayOfYear,
  solarDeclination,
  equationOfTime,
  hourAngle,
  solarPosition,
} from './solarGeometry';

/**
 * The exact UTC instant of local solar noon (hour angle = 0) for the
 * calendar day of `dayUtcMidnight`, at the given longitude. Used
 * only by these tests, to avoid the classic mistake of assuming
 * solar noon = UTC 12:00 at lng=0 (it isn't, except on the ~4 days a
 * year the equation of time crosses zero).
 */
function solarNoonUTC(dayUtcMidnight: Date, lng: number): Date {
  const n = dayOfYear(dayUtcMidnight);
  const eot = equationOfTime(n);
  const utcHours = 12 - lng / 15 - eot / 60;
  return new Date(dayUtcMidnight.getTime() + utcHours * 3600 * 1000);
}

const marchEquinoxDay = new Date(Date.UTC(2024, 2, 20, 0, 0, 0));
const juneSolsticeDay = new Date(Date.UTC(2024, 5, 21, 0, 0, 0));
const decSolsticeDay = new Date(Date.UTC(2024, 11, 21, 0, 0, 0));

describe('dayOfYear', () => {
  it('Jan 1 UTC is day 1', () => {
    expect(dayOfYear(new Date(Date.UTC(2024, 0, 1, 0, 0, 0)))).toBe(1);
  });

  it('does not leak a fractional day from the time-of-day component', () => {
    expect(dayOfYear(new Date(Date.UTC(2024, 0, 1, 23, 59, 0)))).toBe(1);
  });

  it('Dec 31 is day 366 in a leap year, 365 otherwise', () => {
    expect(dayOfYear(new Date(Date.UTC(2024, 11, 31, 12, 0, 0)))).toBe(366);
    expect(dayOfYear(new Date(Date.UTC(2023, 11, 31, 12, 0, 0)))).toBe(365);
  });
});

describe('solarDeclination (Cooper\'s equation)', () => {
  it('stays within +/-23.45 degrees for every day of the year', () => {
    for (let n = 1; n <= 366; n++) {
      const d = solarDeclination(n);
      expect(d).toBeGreaterThanOrEqual(-23.46);
      expect(d).toBeLessThanOrEqual(23.46);
    }
  });

  it('peaks at +23.45 near the June solstice and -23.45 near the December solstice', () => {
    expect(solarDeclination(172)).toBeCloseTo(23.45, 0);
    expect(solarDeclination(355)).toBeCloseTo(-23.45, 0);
  });

  it('crosses zero near the equinoxes', () => {
    expect(Math.abs(solarDeclination(80))).toBeLessThan(1.5);
    expect(Math.abs(solarDeclination(266))).toBeLessThan(1.5);
  });
});

describe('equationOfTime', () => {
  it('stays within the known physical range of about -14 to +16 minutes', () => {
    for (let n = 1; n <= 366; n++) {
      const e = equationOfTime(n);
      expect(e).toBeGreaterThanOrEqual(-20);
      expect(e).toBeLessThanOrEqual(20);
    }
  });

  it('is strongly negative around mid-February (known minimum ~ -14 min near Feb 11)', () => {
    expect(equationOfTime(42)).toBeLessThan(-10);
  });

  it('is strongly positive around early November (known maximum ~ +16 min near Nov 3)', () => {
    expect(equationOfTime(307)).toBeGreaterThan(10);
  });
});

describe('hourAngle', () => {
  it('is ~0 at true solar noon (solved via the equation of time), for lng=0', () => {
    const noon = solarNoonUTC(marchEquinoxDay, 0);
    expect(hourAngle(noon, 0)).toBeCloseTo(0, 1);
  });

  it('is ~0 at true solar noon for a non-zero longitude', () => {
    const noon = solarNoonUTC(marchEquinoxDay, 15);
    expect(hourAngle(noon, 15)).toBeCloseTo(0, 1);
  });

  it('moves 15 degrees per hour away from solar noon', () => {
    const noon = solarNoonUTC(marchEquinoxDay, 0);
    const sixHoursBefore = new Date(noon.getTime() - 6 * 3600 * 1000);
    const sixHoursAfter = new Date(noon.getTime() + 6 * 3600 * 1000);
    expect(hourAngle(sixHoursBefore, 0)).toBeCloseTo(-90, 0);
    expect(hourAngle(sixHoursAfter, 0)).toBeCloseTo(90, 0);
  });
});

describe('solarPosition', () => {
  // Note on tolerances below: "equinox" here means the calendar day
  // (March 20 / Sept 23), not the exact astronomical instant, so
  // Cooper's-equation declination on that day is close to but not
  // exactly 0 — these checks use an explicit +/-1 degree tolerance
  // (verified numerically, worst case ~0.4 degrees off) rather than
  // toBeCloseTo's stricter digit-rounded tolerance, to state the
  // real margin honestly instead of relying on a borderline pass.
  it('equator + equinox + true solar noon: altitude ~= 90 (sun overhead)', () => {
    const pos = solarPosition(0, 0, solarNoonUTC(marchEquinoxDay, 0));
    expect(Math.abs(pos.altitude - 90)).toBeLessThan(1);
  });

  it('altitude at solar noon follows the identity 90 - |lat - declination|', () => {
    const noonMarch = solarNoonUTC(marchEquinoxDay, 0);
    expect(Math.abs(solarPosition(40, 0, noonMarch).altitude - 50)).toBeLessThan(1);

    const noonJune = solarNoonUTC(juneSolsticeDay, 0);
    expect(Math.abs(solarPosition(40, 0, noonJune).altitude - 73.45)).toBeLessThan(0.5);

    const noonDec = solarNoonUTC(decSolsticeDay, 0);
    expect(Math.abs(solarPosition(40, 0, noonDec).altitude - 26.55)).toBeLessThan(0.5);
  });

  it('azimuth is due South (180) at solar noon when latitude > declination', () => {
    const pos = solarPosition(40, 0, solarNoonUTC(marchEquinoxDay, 0));
    expect(Math.abs(pos.azimuth - 180)).toBeLessThan(0.5);
  });

  it('azimuth flips to due North (0/360) at solar noon when declination > latitude', () => {
    const pos = solarPosition(10, 0, solarNoonUTC(juneSolsticeDay, 0));
    const distFrom0or360 = Math.min(pos.azimuth, 360 - pos.azimuth);
    expect(distFrom0or360).toBeLessThan(1);
  });

  it('southern hemisphere: azimuth is due North at equinox solar noon, symmetric altitude with 40N', () => {
    const pos = solarPosition(-40, 0, solarNoonUTC(marchEquinoxDay, 0));
    const distFrom0or360 = Math.min(pos.azimuth, 360 - pos.azimuth);
    expect(distFrom0or360).toBeLessThan(1);
    expect(Math.abs(pos.altitude - 50)).toBeLessThan(1);
  });

  it('at the equinox, sunrise is due East and sunset is due West, at any latitude', () => {
    // Tolerance is 1.5 degrees, not tighter: a 1-minute scan step is
    // 0.25 degrees of hour angle, and azimuth moves faster than that
    // per unit hour-angle near the horizon at high latitude, plus
    // the same "not exactly the astronomical equinox" slack as
    // above (verified numerically, worst case ~0.9 degrees, at
    // lat=60).
    for (const lat of [-60, -20, 0, 20, 60]) {
      let sunriseAzimuth: number | null = null;
      let sunsetAzimuth: number | null = null;
      for (let h = 0; h < 24; h += 1 / 60) {
        const t = new Date(marchEquinoxDay.getTime() + h * 3600 * 1000);
        const pos = solarPosition(lat, 0, t);
        if (sunriseAzimuth === null && pos.altitude >= 0) sunriseAzimuth = pos.azimuth;
        if (pos.altitude >= 0) sunsetAzimuth = pos.azimuth; // keeps updating until the last daylight minute
      }
      expect(sunriseAzimuth).not.toBeNull();
      expect(sunsetAzimuth).not.toBeNull();
      expect(Math.abs(sunriseAzimuth! - 90)).toBeLessThan(1.5);
      expect(Math.abs(sunsetAzimuth! - 270)).toBeLessThan(1.5);
    }
  });

  it('midnight sun: at 75N on the June solstice, the sun never sets', () => {
    for (let h = 0; h < 24; h += 1) {
      const t = new Date(juneSolsticeDay.getTime() + h * 3600 * 1000);
      expect(solarPosition(75, 0, t).altitude).toBeGreaterThan(0);
    }
  });

  it('polar night: at 75N on the December solstice, the sun never rises', () => {
    for (let h = 0; h < 24; h += 1) {
      const t = new Date(decSolsticeDay.getTime() + h * 3600 * 1000);
      expect(solarPosition(75, 0, t).altitude).toBeLessThan(0);
    }
  });

  it('90 degrees of longitude shifts local solar noon by exactly 6 hours of UTC', () => {
    // Find the actual UTC hour of peak altitude by scanning, at each
    // longitude — a genuine end-to-end check of solarPosition's
    // longitude handling, rather than comparing solarNoonUTC (a
    // test-only helper) against itself.
    const findPeakAltitudeUtcHour = (lng: number) => {
      let best = { h: 0, alt: -999 };
      for (let h = 0; h < 24; h += 1 / 60) {
        const t = new Date(marchEquinoxDay.getTime() + h * 3600 * 1000);
        const pos = solarPosition(0, lng, t);
        if (pos.altitude > best.alt) best = { h, alt: pos.altitude };
      }
      return best.h;
    };
    const peak0 = findPeakAltitudeUtcHour(0);
    const peak90 = findPeakAltitudeUtcHour(90);
    expect(peak0 - peak90).toBeCloseTo(6, 1);
  });
});
