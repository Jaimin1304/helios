import { Vector3 } from 'three';
import {
  AU_KM, DEG, FOV, FREE_DIST_MAX, FREE_DIST_MIN, FOCUS_MIN_DIST_FACTOR, FLIGHT_AIM_LOCK,
} from '../config.js';

const MAX_PITCH = 89.5 * DEG;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (t) => t * t * (3 - 2 * t);
const FLY_TMP = new Vector3();

/**
 * Double-precision camera rig. Every piece of state is stored in km, and the render layer
 * converts it through the floating origin.
 *
 * Two modes. In free mode the pivot is a point in space: the middle button pans it, and the
 * moment the right button goes down the pivot snaps to where the view-centre ray meets the
 * ecliptic, giving a Blender-style turntable. In focus mode the pivot follows a body every
 * frame, with the right button orbiting it and the wheel dollying in and out.
 */
export class CameraRig {
  constructor() {
    this.mode = 'free'; // free | focus | flying
    this.pivot = new Vector3(0, 0, 0);
    this.dist = 6 * AU_KM;
    this.yaw = 35 * DEG;
    this.pitch = 24 * DEG;
    this.focus = null;
    this.flight = null;

    this._pos = new Vector3();
    this._right = new Vector3();
    this._up = new Vector3();
    this._fwd = new Vector3();
  }

  // ---------- Basis vectors ----------
  direction(out = new Vector3()) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return out.set(cp * Math.cos(this.yaw), cp * Math.sin(this.yaw), sp);
  }

  /** Camera position in km, heliocentric ecliptic */
  position(out = this._pos) {
    this.direction(out);
    return out.multiplyScalar(this.dist).add(this.pivot);
  }

  /** View direction, a unit vector pointing from the camera towards the pivot */
  forward(out = this._fwd) {
    return this.direction(out).negate();
  }

  right(out = this._right) {
    return out.set(-Math.sin(this.yaw), Math.cos(this.yaw), 0);
  }

  upVector(out = this._up) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return out.set(-sp * Math.cos(this.yaw), -sp * Math.sin(this.yaw), cp);
  }

  get busy() {
    return this.mode === 'flying';
  }

  // ---------- Interaction ----------
  pan(dx, dy, viewportHeight) {
    if (this.mode !== 'free') return;
    const k = (2 * this.dist * Math.tan((FOV * DEG) / 2)) / viewportHeight;
    this.pivot.addScaledVector(this.right(), -dx * k);
    this.pivot.addScaledVector(this.upVector(), dy * k);
  }

  orbit(dx, dy) {
    const k = 0.0052;
    this.yaw -= dx * k;
    this.pitch = clamp(this.pitch + dy * k, -MAX_PITCH, MAX_PITCH);
    // Keep yaw inside [-pi, pi) so a long drag cannot inflate the float
    if (this.yaw > Math.PI) this.yaw -= 2 * Math.PI;
    else if (this.yaw < -Math.PI) this.yaw += 2 * Math.PI;
  }

  zoom(delta) {
    const next = this.dist * Math.exp(delta * 0.0013);
    const min = this.mode === 'focus' && this.focus
      ? this.focus.radius * FOCUS_MIN_DIST_FACTOR
      : FREE_DIST_MIN;
    this.dist = clamp(next, min, FREE_DIST_MAX);
  }

  /**
   * Snap the pivot to where the view-centre ray meets the ecliptic plane (z = 0).
   * The camera itself does not move: only the pivot and distance change, and since the view
   * direction is unchanged, yaw and pitch need no recomputation.
   */
  snapPivotToEcliptic() {
    if (this.mode !== 'free') return false;
    const cam = this.position(new Vector3());
    const dir = this.forward(new Vector3());
    if (Math.abs(dir.z) < 1e-7) return false;
    const t = -cam.z / dir.z;
    if (!(t > FREE_DIST_MIN) || t > FREE_DIST_MAX) return false; // behind the camera, or uselessly far
    this.pivot.copy(cam).addScaledVector(dir, t);
    this.dist = t;
    return true;
  }

  /**
   * Pick a flattering arrival pose: park slightly off to the sunlit side of the body so that
   * what greets you on arrival is a gibbous phase with a clean terminator rather than an
   * unlit hemisphere.
   */
  arrivalAngles(body) {
    const p = body.position;
    const r = Math.hypot(p.x, p.y);
    if (r < 1) return { yaw: this.yaw, pitch: this.pitch }; // the Sun itself
    return { yaw: Math.atan2(-p.y, -p.x) + 34 * DEG, pitch: 17 * DEG };
  }

  /** Recover dist/yaw/pitch from a camera position and pivot */
  setFromCameraAndPivot(cam, pivot) {
    const dx = cam.x - pivot.x, dy = cam.y - pivot.y, dz = cam.z - pivot.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-9) return; // degenerate; keep last frame's orientation
    this.dist = len;
    this.yaw = Math.atan2(dy, dx);
    this.pitch = clamp(Math.asin(dz / len), -MAX_PITCH, MAX_PITCH);
  }

  /** Fly to a body and focus on it */
  flyTo(body, instant = false) {
    const targetDist = Math.max(body.radius * 4.2, body.radius + 12);
    const aim = this.arrivalAngles(body);
    if (instant) {
      this.mode = 'focus';
      this.focus = body;
      this.pivot.copy(body.position);
      this.dist = targetDist;
      this.yaw = aim.yaw;
      this.pitch = aim.pitch;
      this.flight = null;
      return;
    }

    // Destination pose: sunlit side of the body, targetDist away. It is stored as an offset
    // relative to the body rather than an absolute position, because time keeps running and
    // the body keeps moving. At 1440x, Earth covers 140,000 km in the two seconds a flight
    // takes, which is several times the arrival distance.
    const cp = Math.cos(aim.pitch);
    const camEndOffset = new Vector3(
      cp * Math.cos(aim.yaw), cp * Math.sin(aim.yaw), Math.sin(aim.pitch),
    ).multiplyScalar(targetDist);
    const camStart = this.position(new Vector3());
    const L = camStart.distanceTo(FLY_TMP.copy(body.position).add(camEndOffset));

    this.flight = {
      body,
      camStart,
      camEndOffset,
      camEnd: new Vector3(),
      L,
      d1: Math.max(targetDist, 1),
      pivot0: this.pivot.clone(),
      t: 0,
      dur: clamp(0.9 + 0.24 * Math.log1p(L / Math.max(targetDist, 1)), 1.0, 3.2),
    };
    this.mode = 'flying';
    this.focus = null;
  }

  /** Release focus and return to free mode, keeping the current pose */
  release() {
    if (this.mode === 'free') return false;
    this.flight = null;
    this.focus = null;
    this.mode = 'free';
    return true;
  }

  update(dt) {
    if (this.mode === 'flying' && this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.dur);
      const s = smoothstep(f.t);

      // The camera advances along the straight line from camStart to camEnd, while the
      // remaining distance to the target shrinks exponentially. A 30 AU hop and a 30,000 km
      // hop therefore feel about the same, and neither smears past the target at the end.
      const total = f.L + f.d1;
      const rem = total * Math.pow(f.d1 / total, s) - f.d1;
      const frac = f.L > 1e-9 ? 1 - rem / f.L : 1;
      f.camEnd.copy(f.body.position).add(f.camEndOffset); // the destination tracks the body
      FLY_TMP.copy(f.camStart).lerp(f.camEnd, frac);

      // The pivot slides onto the target during the first stretch of the flight and stays
      // locked there, so the camera watches the target the whole way in rather than
      // swinging round to face it on arrival.
      const aim = FLIGHT_AIM_LOCK > 0
        ? smoothstep(Math.min(1, f.t / FLIGHT_AIM_LOCK))
        : 1;
      this.pivot.copy(f.pivot0).lerp(f.body.position, aim);
      this.setFromCameraAndPivot(FLY_TMP, this.pivot);
      if (f.t >= 1) {
        this.mode = 'focus';
        this.focus = f.body;
        this.flight = null;
      }
    } else if (this.mode === 'focus' && this.focus) {
      this.pivot.copy(this.focus.position); // follow the body as it moves
      const min = this.focus.radius * FOCUS_MIN_DIST_FACTOR;
      if (this.dist < min) this.dist = min;
    }
  }
}
