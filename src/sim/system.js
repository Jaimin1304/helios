import { Vector3, Matrix3 } from 'three';
import { BODIES, THEME_DEFAULT } from '../data/bodies.js';
import { bodyName } from '../i18n.js';
import { compileOrbit, equatorFrame, iauNodeOffset, orbitPosition } from './kepler.js';
import { DAY_MS, DEG, J2000_MS } from '../config.js';

const TWO_PI = Math.PI * 2;

/**
 * Runtime body. position is heliocentric ecliptic km in double precision, which THREE.Vector3
 * provides since its components are float64.
 */
class Body {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = bodyName(def); // Chinese or English name, following the interface language
    this.kind = def.kind;
    this.radius = def.radius;
    this.theme = def.theme ?? THEME_DEFAULT;
    this.parent = null;
    this.children = [];
    this.orbit = null; // result of compileOrbit
    this.frame = null; // own equatorial frame to ecliptic (Matrix3)
    this.position = new Vector3(); // absolute position (km)
    this.local = new Vector3(); // position relative to the primary (km)
    /** Rotation: spin = spinW0 + spinRate * t, in radians about the body's own +Z */
    this.spinW0 = 0;
    this.spinRate = 0;
    this.spin = 0;
    /** Screen data written by the render layer each frame */
    this.screen = { visible: false, occluded: false, x: 0, y: 0, px: 0, dist: 0 };
  }

  /** Distance to the Sun in km. The Sun always sits at the origin. */
  get sunDistance() {
    return this.position.length();
  }

  /**
   * Equatorial radius. The table stores the mean (volumetric) radius R = Re * (1-f)^(1/3),
   * so inverting that expression recovers Re to better than 0.01% against published values
   * (Earth 6378.1, Jupiter 71487, Uranus 25559). Both the oblate spheroid geometry and the
   * surface gravity need it.
   */
  get equatorialRadius() {
    const f = this.def.flattening || 0;
    return f > 0 ? this.radius / Math.cbrt(1 - f) : this.radius;
  }

  /**
   * Surface gravity g = GM/Re^2 in m/s^2, or null when no mass is available. Convention is
   * the equatorial gravitational acceleration excluding rotational centrifugal effects,
   * which is what published figures use.
   */
  get surfaceGravity() {
    if (!this.def.gm) return null;
    const r = this.equatorialRadius;
    return (this.def.gm / (r * r)) * 1000;
  }

  /** Sidereal rotation period in days, absolute value; null when the body does not rotate */
  get rotationDays() {
    return this.spinRate ? Math.abs((Math.PI * 2) / this.spinRate) : null;
  }

  /** Whether rotation is retrograde with respect to the ecliptic north pole. A positive spin
   *  rate about a southward axis still counts as retrograde. */
  get retrograde() {
    if (!this.spinRate) return false;
    const axisZ = this.frame ? this.frame.elements[8] : 1; // z component of the frame's third column
    return this.spinRate * axisZ < 0;
  }

  /** Whether the body is tidally locked, meaning rotation and orbital period agree */
  get synchronous() {
    if (!this.orbit || !this.rotationDays) return false;
    return Math.abs(this.rotationDays - this.orbit.period) < this.orbit.period * 1e-6;
  }
}

export class SolarSystem {
  constructor() {
    /** @type {Map<string, Body>} */
    this.byId = new Map();
    /** @type {Body[]} sorted so that a primary always precedes its satellites */
    this.bodies = [];
    this.root = null;
    this.timeDays = 0;

    for (const def of BODIES) {
      const b = new Body(def);
      if (def.pole) b.frame = equatorFrame(def.pole[0], def.pole[1]);
      this.byId.set(def.id, b);
    }

    for (const def of BODIES) {
      const b = this.byId.get(def.id);
      if (!def.parent) {
        this.root = b;
        continue;
      }
      const p = this.byId.get(def.parent);
      if (!p) throw new Error(`unknown primary: ${def.parent}`);
      b.parent = p;
      p.children.push(b);
      // Satellite elements default to the primary's equatorial frame; frame:'ecliptic' opts out
      const useEquator = def.orbit.frame !== 'ecliptic' && p.frame && def.parent !== 'sun';
      b.orbit = compileOrbit(def.orbit, useEquator ? p.frame : null);
      // Regular satellites without their own pole data borrow the primary's spin axis, which
      // is a good approximation since they orbit near its equator and are tidally locked
      if (!b.frame && p.frame) b.frame = p.frame;
    }

    // Topological order, so a primary is always listed before its satellites
    const walk = (b) => {
      this.bodies.push(b);
      for (const c of b.children) walk(c);
    };
    walk(this.root);
  }

  /** Set the simulation instant from a real date */
  setDate(date) {
    this.timeDays = (date.getTime() - J2000_MS) / DAY_MS;
    this.update();
    this.initSpin();
  }

  /** The real UTC time corresponding to the current simulation instant */
  get date() {
    return new Date(J2000_MS + this.timeDays * DAY_MS);
  }

  /** Advance simulated time, in days */
  advance(days) {
    if (!days) return;
    this.timeDays += days;
    this.update();
  }

  /**
   * Work out each body's rotation parameters once, at table build time, from three sources
   * in descending order of confidence. First, the IAU prime meridian W0 + Wdot converted into
   * this project's equatorial frame. Second, tidally locked satellites, whose spin rate comes
   * from the orbit and whose phase is solved so that the same face stays towards the primary;
   * retrograde moons such as Triton and Phoebe fall out of this correctly. Third, anything
   * left over uses rotHours with an uncalibrated epoch phase.
   */
  initSpin() {
    const t = this.timeDays;
    for (const b of this.bodies) {
      const def = b.def;
      if (def.iauW) {
        const offset = def.pole ? iauNodeOffset(def.pole[0], def.pole[1]) : 0;
        b.spinRate = def.iauW[1] * DEG;
        b.spinW0 = offset + def.iauW[0] * DEG;
      } else if (b.orbit && b.parent !== this.root) {
        // Tidal locking uses the orbital MEAN motion. The instantaneous angular rate is wrong
        // here: true anomaly advances unevenly on an eccentric orbit and more unevenly still
        // once a high-inclination orbit is projected onto the equator, which leaves a
        // systematic error of a few percent. Mean motion also lets libration emerge on its
        // own, which is the real behaviour. Direction comes from the orbital angular momentum
        // projected onto the spin axis, so retrograde moons spin backwards automatically.
        const n = TWO_PI / b.orbit.period;
        TMP_B.crossVectors(b.orbit.P, b.orbit.Q); // orbit normal, right-handed along the motion
        if (b.frame) {
          const e = b.frame.elements;
          TMP_C.set(e[6], e[7], e[8]); // third column of the frame = spin axis
        } else {
          TMP_C.set(0, 0, 1);
        }
        b.spinRate = TMP_B.dot(TMP_C) >= 0 ? n : -n;
        b.spinW0 = this.#parentDirAngle(b, t) - b.spinRate * t;
      } else if (def.rotHours) {
        b.spinRate = (TWO_PI * 24) / def.rotHours;
        b.spinW0 = 0;
      }
    }
    this.updateSpin();
  }

  /** Azimuth of the body-to-primary direction in the body's own equatorial frame at time t */
  #parentDirAngle(b, t) {
    orbitPosition(b.orbit, t, TMP_A).negate();
    if (b.frame) TMP_A.applyMatrix3(TMP_M.copy(b.frame).transpose());
    return Math.atan2(TMP_A.y, TMP_A.x);
  }

  updateSpin() {
    for (const b of this.bodies) {
      b.spin = b.spinW0 + b.spinRate * this.timeDays;
    }
  }

  /** Propagate every body's position and rotation to the current timeDays */
  update() {
    const t = this.timeDays;
    for (const b of this.bodies) {
      if (!b.orbit) {
        b.position.set(0, 0, 0); // the Sun is pinned at the origin, ignoring barycentre wobble
        continue;
      }
      orbitPosition(b.orbit, t, b.local);
      b.position.copy(b.parent.position).add(b.local);
    }
    this.updateSpin();
  }
}

const TMP_A = new Vector3();
const TMP_B = new Vector3();
const TMP_C = new Vector3();
const TMP_M = new Matrix3();
