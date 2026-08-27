import { Vector3, Matrix3 } from 'three';
import { DEG, OBLIQUITY } from '../config.js';

/**
 * Solve Kepler's equation M = E - e*sinE by Newton iteration, with a sturdier initial guess
 * at high eccentricity.
 * @param {number} M mean anomaly in radians @param {number} e eccentricity
 */
export function solveKepler(M, e) {
  // Normalise into [-pi, pi)
  M = ((M + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  let E = e < 0.8 ? M + e * Math.sin(M) : Math.PI * Math.sign(M || 1);
  for (let k = 0; k < 24; k++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const d = f / fp;
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

/**
 * Build the rotation from a primary's equatorial frame to the ecliptic, given its IAU north
 * pole as equatorial RA/Dec in degrees. The columns are X towards the ascending node of the
 * equator on the ecliptic, Z along the spin pole, and Y = Z cross X.
 */
/**
 * The IAU prime meridian W is measured from the ascending node of the body's equator on the
 * ICRF EQUATOR, while the X axis from equatorFrame() points at the ascending node on the
 * ECLIPTIC. Both lie in the body's equatorial plane and differ by a constant angle about the
 * spin axis, which this function computes.
 * @returns {number} signed angle from the ecliptic node to the ICRF node, in radians, positive about the spin axis
 */
export function iauNodeOffset(poleRaDeg, poleDecDeg) {
  const ra = poleRaDeg * DEG;
  const dec = poleDecDeg * DEG;
  const pole = new Vector3(
    Math.cos(dec) * Math.cos(ra),
    Math.cos(dec) * Math.sin(ra),
    Math.sin(dec),
  );
  // Ascending node on the ICRF equator: z_eq cross pole, still in equatorial coordinates
  const nodeEq = new Vector3(-pole.y, pole.x, 0);
  if (nodeEq.lengthSq() < 1e-12) return 0;
  nodeEq.normalize();

  const toEcl = (v) => new Vector3(
    v.x,
    v.y * Math.cos(OBLIQUITY) + v.z * Math.sin(OBLIQUITY),
    -v.y * Math.sin(OBLIQUITY) + v.z * Math.cos(OBLIQUITY),
  );
  const Z = toEcl(pole).normalize();
  const nIau = toEcl(nodeEq).normalize();

  let X = new Vector3(-Z.y, Z.x, 0);
  if (X.lengthSq() < 1e-12) X.set(1, 0, 0);
  X.normalize();

  const cross = new Vector3().crossVectors(X, nIau);
  return Math.atan2(cross.dot(Z), X.dot(nIau));
}

export function equatorFrame(poleRaDeg, poleDecDeg) {
  const ra = poleRaDeg * DEG;
  const dec = poleDecDeg * DEG;
  // Cartesian in equatorial coordinates
  const xe = Math.cos(dec) * Math.cos(ra);
  const ye = Math.cos(dec) * Math.sin(ra);
  const ze = Math.sin(dec);
  // Rotate by -obliquity about X: equatorial to ecliptic
  const Z = new Vector3(
    xe,
    ye * Math.cos(OBLIQUITY) + ze * Math.sin(OBLIQUITY),
    -ye * Math.sin(OBLIQUITY) + ze * Math.cos(OBLIQUITY),
  ).normalize();

  // Ascending node = z_ecl cross Z
  let X = new Vector3(-Z.y, Z.x, 0);
  if (X.lengthSq() < 1e-12) X.set(1, 0, 0); // degenerate case: the pole coincides with the ecliptic pole
  X.normalize();
  const Y = new Vector3().crossVectors(Z, X).normalize();

  return new Matrix3().set(X.x, Y.x, Z.x, X.y, Y.y, Z.y, X.z, Y.z, Z.z);
}

/**
 * Precompile an orbit, folding (node, i, peri) and an optional primary equatorial frame into
 * two basis vectors P and Q. Each frame then only needs pos = P*x + Q*y, where x and y are
 * coordinates in the orbital plane.
 *
 * @param {object} el {a(km), e, i(deg), node(deg,Ω), peri(deg,ω), M0(deg), period(days)}
 * @param {Matrix3|null} frame primary equatorial frame to ecliptic; null means the elements are already ecliptic
 */
export function compileOrbit(el, frame = null) {
  const i = el.i * DEG;
  const node = el.node * DEG;
  const peri = el.peri * DEG;
  const cn = Math.cos(node), sn = Math.sin(node);
  const cw = Math.cos(peri), sw = Math.sin(peri);
  const ci = Math.cos(i), si = Math.sin(i);

  const P = new Vector3(cn * cw - sn * sw * ci, sn * cw + cn * sw * ci, sw * si);
  const Q = new Vector3(-cn * sw - sn * cw * ci, -sn * sw + cn * cw * ci, cw * si);
  if (frame) {
    P.applyMatrix3(frame);
    Q.applyMatrix3(frame);
  }

  return {
    a: el.a,
    e: el.e,
    b: el.a * Math.sqrt(Math.max(0, 1 - el.e * el.e)),
    M0: el.M0 * DEG,
    n: (2 * Math.PI) / el.period, // mean motion, rad/day
    period: el.period,
    P,
    Q,
  };
}

/**
 * Position on the orbit t days after epoch, relative to the primary, in ecliptic km.
 * The result is written into out; THREE.Vector3 stores float64, so it is safely double precision.
 */
export function orbitPosition(orbit, tDays, out) {
  const E = solveKepler(orbit.M0 + orbit.n * tDays, orbit.e);
  const x = orbit.a * (Math.cos(E) - orbit.e);
  const y = orbit.b * Math.sin(E);
  out.set(
    orbit.P.x * x + orbit.Q.x * y,
    orbit.P.y * x + orbit.Q.y * y,
    orbit.P.z * x + orbit.Q.z * y,
  );
  return out;
}

/** Eccentric anomaly on the orbit t days after epoch */
export function eccentricAnomalyAt(orbit, tDays) {
  return solveKepler(orbit.M0 + orbit.n * tDays, orbit.e);
}

/**
 * Sample the whole orbital ellipse for drawing an orbit line.
 *
 * Two details matter, both so the line passes EXACTLY through the body. First, sampling starts
 * at E0. A 512-segment polyline is an inscribed polygon whose chord sagitta is about 1.88e-5*a,
 * which on Neptune's orbit is over 80,000 km, roughly three Neptune radii, and the line visibly
 * misses the planet. Pinning vertex zero to the body's current position makes the error grow
 * quadratically from there, and by the time it is large enough to see it has left the frame.
 * Second, origin (the body's current position relative to its primary) becomes the geometry
 * origin. Without it the vertex coordinates reach 4.5e6 scene units, where float32 resolves
 * only about 450 km and the anchor carries a visible offset.
 *
 * @returns {Float32Array} vertices in km, relative to origin
 */
export function sampleOrbit(orbit, segments, E0 = 0, origin = null) {
  const ox = origin ? origin.x : 0;
  const oy = origin ? origin.y : 0;
  const oz = origin ? origin.z : 0;
  const pts = new Float32Array(segments * 3);
  for (let k = 0; k < segments; k++) {
    const E = E0 + (k / segments) * 2 * Math.PI;
    const x = orbit.a * (Math.cos(E) - orbit.e);
    const y = orbit.b * Math.sin(E);
    pts[k * 3] = orbit.P.x * x + orbit.Q.x * y - ox;
    pts[k * 3 + 1] = orbit.P.y * x + orbit.Q.y * y - oy;
    pts[k * 3 + 2] = orbit.P.z * x + orbit.Q.z * y - oz;
  }
  return pts;
}
