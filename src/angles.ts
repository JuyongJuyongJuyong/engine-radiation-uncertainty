/**
 * Small shared degree/radian helpers. Pulled out once a third module
 * (perezTransposition.ts) needed the same "trig function of a degree
 * value" pattern already used inline in solarGeometry.ts and
 * erbsCorrelation.ts, so it has one tested definition instead of a
 * third hand-rolled copy.
 */

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function cosDeg(deg: number): number {
  return Math.cos(degToRad(deg));
}

export function sinDeg(deg: number): number {
  return Math.sin(degToRad(deg));
}
