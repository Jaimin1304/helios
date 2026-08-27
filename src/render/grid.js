import {
  BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, Color, Group,
} from 'three';
import { AU_KM, KM_TO_UNITS, FOV, DEG } from '../config.js';
import { T } from '../i18n.js';

/**
 * Ecliptic coordinate frame centred on the Sun. The ecliptic plane is the scene's z = 0 plane.
 *
 * A fixed cell size is impossible at true scale, since satellite orbits and the Kuiper belt
 * are six orders of magnitude apart. The geometry is therefore built in normalised whole-cell
 * coordinates spanning +/-HALF cells, and each frame picks a cell size from the current view
 * scale and applies it as a uniform scale. Cell size and coverage grow together, so one piece
 * of geometry serves every scale.
 */
/** The cell is fixed at 1 AU, the only length in the solar system with physical meaning,
 *  which is what makes the readings worth anything */
const HALF = 50; // +/-50 AU each way, out past the edge of the Kuiper belt
const MAJOR = 10; // a major line every 10 AU
const CIRCLE_SEGMENTS = 240;
/** Minimum on-screen gap between adjacent tick labels */
const TICK_MIN_GAP_PX = 34;
const SPOKES = 24; // one polar spoke every 15 degrees

const COLOR_MINOR = '#4a6b8c';
const COLOR_MAJOR = '#7ea6cc';
const COLOR_AXIS_X = '#c96a5a'; // towards the vernal equinox
const COLOR_AXIS_Y = '#6ac98a';

function lineMaterial(color, opacity) {
  return new LineBasicMaterial({
    color: new Color(color),
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
  });
}

function segments(points, material) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(points, 3));
  const line = new LineSegments(geo, material);
  line.frustumCulled = false;
  line.renderOrder = -5; // drawn before the bodies, though depth testing still lets planets hide it
  return line;
}

/**
 * Split a long line into steps short segments.
 *
 * This subdivision is required rather than merely tidy. A single segment spanning 100 cells
 * runs from just in front of the camera out to tens of AU at grazing angles, covering several
 * orders of magnitude in depth. Rasteriser and clipping precision eat the near end of such an
 * oversized primitive, and in practice the whole foreground vanished, leaving one band near the
 * horizon. Logarithmic depth interpolation is also only accurate over short primitives.
 * Chopping the line keeps every segment's depth range small.
 */
function pushLine(pts, x0, y0, x1, y1, steps) {
  for (let s = 0; s < steps; s++) {
    const t0 = s / steps;
    const t1 = (s + 1) / steps;
    pts.push(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0, 0);
    pts.push(x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1, 0);
  }
}

/** Rectangular grid: two families of lines parallel to the X and Y axes */
function buildRect(major) {
  const pts = [];
  for (let i = -HALF; i <= HALF; i++) {
    if (i === 0) continue; // the zero lines belong to the axes
    if ((i % MAJOR === 0) !== major) continue;
    pushLine(pts, -HALF, i, HALF, i, HALF * 2);
    pushLine(pts, i, -HALF, i, HALF, HALF * 2);
  }
  return pts;
}

/** Polar grid: concentric circles plus spokes */
function buildPolar(major) {
  const pts = [];
  for (let r = 1; r <= HALF; r++) {
    if ((r % MAJOR === 0) !== major) continue;
    for (let k = 0; k < CIRCLE_SEGMENTS; k++) {
      const a0 = (k / CIRCLE_SEGMENTS) * 2 * Math.PI;
      const a1 = ((k + 1) / CIRCLE_SEGMENTS) * 2 * Math.PI;
      pts.push(r * Math.cos(a0), r * Math.sin(a0), 0, r * Math.cos(a1), r * Math.sin(a1), 0);
    }
  }
  if (major) {
    for (let k = 0; k < SPOKES; k++) {
      const a = (k / SPOKES) * 2 * Math.PI;
      pushLine(pts, 0, 0, HALF * Math.cos(a), HALF * Math.sin(a), HALF);
    }
  }
  return pts;
}

export function formatUnit(km) {
  if (km >= 0.005 * AU_KM) {
    const au = km / AU_KM;
    return `${au >= 1 ? au.toFixed(au < 10 ? 1 : 0) : au.toFixed(3)} AU`;
  }
  if (km >= 1e6) return T.millionKm((km / 1e6).toFixed(0));
  if (km >= 1000) return T.thousandKm((km / 1000).toFixed(0));
  return `${km.toFixed(0)} km`;
}

export class EclipticGrid {
  constructor(scene, tickContainer) {
    this.mode = 'off'; // off | rect | polar
    this.unitKm = AU_KM; // always 1 AU
    this.tickStep = 10;

    this.group = new Group();
    this.group.frustumCulled = false;
    scene.add(this.group);

    this.matMinor = lineMaterial(COLOR_MINOR, 0);
    this.matMajor = lineMaterial(COLOR_MAJOR, 0);
    this.matAxisX = lineMaterial(COLOR_AXIS_X, 0);
    this.matAxisY = lineMaterial(COLOR_AXIS_Y, 0);

    this.rect = [segments(buildRect(false), this.matMinor), segments(buildRect(true), this.matMajor)];
    this.polar = [segments(buildPolar(false), this.matMinor), segments(buildPolar(true), this.matMajor)];
    // The two axes, towards the vernal equinox and ecliptic longitude 90, shared by both modes
    const axX = []; pushLine(axX, -HALF, 0, HALF, 0, HALF * 2);
    const axY = []; pushLine(axY, 0, -HALF, 0, HALF, HALF * 2);
    this.axes = [segments(axX, this.matAxisX), segments(axY, this.matAxisY)];

    for (const o of [...this.rect, ...this.polar, ...this.axes]) {
      o.visible = false;
      this.group.add(o);
    }

    // ---- Ticks, as a DOM overlay ----
    // AU readings run along both axes, and each label takes its axis colour so you can tell
    // at a glance which axis it belongs to.
    this.ticks = [];
    if (tickContainer) {
      for (let r = 1; r <= HALF; r++) {
        for (const [axis, color] of [['x', COLOR_AXIS_X], ['y', COLOR_AXIS_Y]]) {
          for (const sign of [1, -1]) { // label both directions
            const el = document.createElement('div');
            el.className = 'gridtick';
            // Ticks are a distance reference only, so both directions read unsigned
            el.textContent = `${r} AU`;
            el.style.color = color;
            el.style.display = 'none';
            tickContainer.appendChild(el);
            this.ticks.push({ el, r, axis, sign, shown: false });
          }
        }
      }
    }
  }

  setMode(mode) {
    this.mode = mode;
    const on = mode !== 'off';
    for (const o of this.rect) o.visible = mode === 'rect';
    for (const o of this.polar) o.visible = mode === 'polar';
    for (const o of this.axes) o.visible = on;
    if (!on) for (const t of this.ticks) this.#hideTick(t);
    return mode;
  }

  /** off -> rect -> polar -> off */
  cycle() {
    return this.setMode(this.mode === 'off' ? 'rect' : this.mode === 'rect' ? 'polar' : 'off');
  }

  #hideTick(t) {
    if (t.shown) {
      t.el.style.display = 'none';
      t.shown = false;
    }
  }

  /**
   * Position the tick labels. The caller supplies a projection from ecliptic km to screen,
   * since the main loop already has the camera basis and the focal length in pixels.
   * @param {(x:number,y:number,z:number)=>({x:number,y:number,visible:boolean})} project
   */
  updateTicks(project, width, height) {
    if (this.mode === 'off' || !this.ticks.length) return;
    // Perspective crowds distant ticks together, so thin them again by screen gap,
    // with each of the four half-axes handled independently
    const lastPlaced = { 'x1': null, 'x-1': null, 'y1': null, 'y-1': null };
    for (const t of this.ticks) {
      // Thin dense readings: show only multiples of the current step
      if (t.r % this.tickStep !== 0) {
        this.#hideTick(t);
        continue;
      }
      const d = t.r * AU_KM * t.sign;
      const p = project(t.axis === 'x' ? d : 0, t.axis === 'y' ? d : 0, 0);
      if (!p.visible || p.x < 4 || p.x > width - 40 || p.y < 4 || p.y > height - 12) {
        this.#hideTick(t);
        continue;
      }
      const key = t.axis + t.sign;
      const prev = lastPlaced[key];
      if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < TICK_MIN_GAP_PX) {
        this.#hideTick(t);
        continue;
      }
      lastPlaced[key] = p;
      t.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
      if (!t.shown) {
        t.el.style.display = 'block';
        t.shown = true;
      }
    }
  }

  /**
   * @param {import('three').Vector3} sunRel Sun position relative to the camera (scene units)
   * @param {number} viewScaleKm current view scale, the camera-to-pivot distance in km
   * @param {number} sunDistKm   camera-to-Sun distance in km
   * @param {number} viewportH   viewport height in pixels
   */
  update(sunRel, viewScaleKm, sunDistKm, viewportH) {
    if (this.mode === 'off') return;

    this.group.position.copy(sunRel);
    this.group.scale.setScalar(AU_KM * KM_TO_UNITS); // one cell is always 1 AU

    // How many pixels a cell covers drives both the minor-line fade and the tick thinning
    const kmPerPx = (2 * viewScaleKm * Math.tan((FOV * DEG) / 2)) / viewportH;
    const cellPx = AU_KM / Math.max(kmPerPx, 1e-9);

    const fade = Math.min(1, Math.max(0, (cellPx - 3) / 18));
    this.matMinor.opacity = 0.11 * fade;
    this.matMajor.opacity = 0.34 * Math.min(1, Math.max(0, (cellPx * MAJOR - 3) / 30));
    this.matAxisX.opacity = 0.6 * Math.min(1, Math.max(0, cellPx * MAJOR / 12));
    this.matAxisY.opacity = this.matAxisX.opacity;

    // Tick thinning: every AU up close, then 5 AU and 10 AU as the view pulls back
    this.tickStep = cellPx > 55 ? 1 : cellPx > 13 ? 5 : 10;
  }
}
