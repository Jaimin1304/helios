import {
  BufferGeometry, BufferAttribute, Points, ShaderMaterial, Color, Vector3,
} from 'three';
import { KM_TO_UNITS } from '../config.js';
import { smoothstep } from './noise.js';
import { getMarkerTexture } from './textures.js';

/**
 * The five Lagrange points of the two-body system each body forms with its primary,
 * tracked live.
 *
 * The three collinear points L1/L2/L3 depend only on the mass ratio mu = m2/(m1+m2), so they
 * are constants: solve them once at table build time, then each frame apply the current
 * primary-to-secondary direction and distance. The triangular points are simpler still, since
 * L4 and L5 form equilateral triangles with the two bodies and sit 60 degrees ahead of and
 * behind the secondary on its orbit.
 *
 * L1/L2/L3 are unstable saddle points, while L4/L5 are stable for mu < 0.0385, which is where
 * Jupiter's Trojans collect. The two families are coloured differently for that reason.
 */

const MARKER_PX = 11;
/** Below this on-screen orbit radius the group is hidden, since all five points would pile
 *  up on the primary */
const MIN_ORBIT_PX = 90;
const COLOR_COLLINEAR = '#7fb2d9'; // L1/L2/L3, unstable
const COLOR_TRIANGULAR = '#e6bd63'; // L4/L5, stable
const LABEL_MIN_GAP_PX = 40;
const NAMES = ['L1', 'L2', 'L3', 'L4', 'L5'];
const COS60 = 0.5;
const SIN60 = Math.sqrt(3) / 2;

/**
 * Solve the three collinear points using the dimensionless form in the rotating frame, where
 * the bodies are one unit apart with the primary at -mu and the secondary at 1-mu.
 *   f(x) = x - (1-μ)·(x+μ)/|x+μ|³ - μ·(x-1+μ)/|x-1+μ|³ = 0
 * The three roots lie in (-mu, 1-mu), (1-mu, +inf) and (-inf, -mu), and f changes sign across
 * each interval, so plain bisection works. It is slower than Newton but converges
 * unconditionally, and it runs only once at build time.
 * @returns {number[]} distances measured from the PRIMARY, in units of the separation (L3 is negative)
 */
function collinearPoints(mu) {
  const f = (x) => {
    const a = x + mu;
    const b = x - 1 + mu;
    return x - ((1 - mu) * a) / Math.abs(a) ** 3 - (mu * b) / Math.abs(b) ** 3;
  };
  const bisect = (lo, hi) => {
    let flo = f(lo);
    for (let k = 0; k < 100; k++) {
      const mid = (lo + hi) / 2;
      const fm = f(mid);
      if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const eps = 1e-12;
  return [
    bisect(-mu + eps, 1 - mu - eps) + mu, // L1, between the two bodies
    bisect(1 - mu + eps, 3) + mu, // L2, beyond the secondary
    bisect(-3, -mu - eps) + mu, // L3, on the far side of the primary
  ];
}

const VERT = /* glsl */`
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uSize;
  varying float vAlpha;
  varying vec3 vColor;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize;
    vAlpha = aAlpha;
    vColor = aColor;
    #include <logdepthbuf_vertex>
  }
`;

const FRAG = /* glsl */`
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    if (vAlpha < 0.01) discard;
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(vColor, texture2D(uMap, gl_PointCoord).a * vAlpha);
  }
`;

export class LagrangePoints {
  constructor(scene, labelContainer, bodies, pixelRatio) {
    this.enabled = false;
    this.systems = [];
    this.shownCount = 0;
    this.placedLabels = [];

    for (const body of bodies) {
      const parent = body.parent;
      if (!body.orbit || !parent || !body.def.gm || !parent.def.gm) continue;
      const mu = body.def.gm / (parent.def.gm + body.def.gm);
      this.systems.push({
        body,
        parent,
        mu,
        s: collinearPoints(mu),
        // Orbit normal, right-handed along the motion, used to swing L4/L5 60 degrees either way
        normal: new Vector3().crossVectors(body.orbit.P, body.orbit.Q).normalize(),
        els: NAMES.map((name, k) => {
          const el = document.createElement('div');
          el.className = 'lpoint';
          // A dozen groups can share one view, and a bare 'L4' gives no clue whose it is,
          // so the label carries the secondary's name
          el.textContent = `${body.name} ${name}`;
          el.style.color = k < 3 ? COLOR_COLLINEAR : COLOR_TRIANGULAR;
          el.style.display = 'none';
          labelContainer.appendChild(el);
          return el;
        }),
        shown: [false, false, false, false, false],
      });
    }

    const n = this.systems.length * 5;
    this.positions = new Float32Array(n * 3);
    this.alphas = new Float32Array(n);
    const colors = new Float32Array(n * 3);
    const cc = new Color(COLOR_COLLINEAR);
    const ct = new Color(COLOR_TRIANGULAR);
    for (let i = 0; i < n; i++) {
      const c = i % 5 < 3 ? cc : ct;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.positions, 3));
    geo.setAttribute('aAlpha', new BufferAttribute(this.alphas, 1));
    geo.setAttribute('aColor', new BufferAttribute(colors, 3));
    this.geometry = geo;

    this.points = new Points(geo, new ShaderMaterial({
      uniforms: {
        uMap: { value: getMarkerTexture() },
        uSize: { value: MARKER_PX * pixelRatio },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
    scene.add(this.points);
  }

  setEnabled(v) {
    this.enabled = v;
    this.points.visible = v;
    if (!v) {
      for (const sys of this.systems) {
        for (let k = 0; k < 5; k++) this.#hide(sys, k);
      }
      this.shownCount = 0;
    }
    return v;
  }

  #hide(sys, k) {
    if (sys.shown[k]) {
      sys.els[k].style.display = 'none';
      sys.shown[k] = false;
    }
  }

  /**
   * @param {Vector3} camPosKm camera position in km, heliocentric ecliptic
   * @param {(x:number,y:number,z:number)=>({x:number,y:number,visible:boolean})} project
   * @param {number} focalPx focal length in pixels
   */
  update(camPosKm, project, focalPx, viewW, viewH) {
    if (!this.enabled) return;
    this.placedLabels.length = 0;
    let systemsShown = 0;

    for (let si = 0; si < this.systems.length; si++) {
      const sys = this.systems[si];
      const r = sys.body.local.length();
      DIR.copy(sys.body.local).divideScalar(r);

      // When the orbit is small on screen all five points overlap the primary and mean nothing
      const parentDist = Math.max(sys.parent.position.distanceTo(camPosKm), 1);
      const alpha = smoothstep(MIN_ORBIT_PX, MIN_ORBIT_PX * 1.6, (r / parentDist) * focalPx);
      if (alpha > 0.01) systemsShown++;

      for (let k = 0; k < 5; k++) {
        if (k < 3) {
          ABS.copy(DIR).multiplyScalar(r * sys.s[k]);
        } else {
          // L4/L5: rotate the primary-to-secondary direction 60 degrees about the orbit normal.
          // This is Rodrigues' formula, whose third term vanishes because the normal is
          // perpendicular to that direction. The length stays r, giving an equilateral triangle.
          CROSS.crossVectors(sys.normal, DIR);
          const sign = k === 3 ? 1 : -1; // L4 leads, L5 trails
          ABS.copy(DIR).multiplyScalar(COS60).addScaledVector(CROSS, sign * SIN60)
            .multiplyScalar(r);
        }
        ABS.add(sys.parent.position);

        const idx = si * 5 + k;
        REL.copy(ABS).sub(camPosKm).multiplyScalar(KM_TO_UNITS);
        this.positions[idx * 3] = REL.x;
        this.positions[idx * 3 + 1] = REL.y;
        this.positions[idx * 3 + 2] = REL.z;
        this.alphas[idx] = alpha;

        // Label
        const p = alpha > 0.01 ? project(ABS.x, ABS.y, ABS.z) : null;
        if (!p || !p.visible || p.x < 2 || p.x > viewW - 24 || p.y < 2 || p.y > viewH - 12) {
          this.#hide(sys, k);
          continue;
        }
        let clash = false;
        for (const q of this.placedLabels) {
          if (Math.hypot(p.x - q.x, p.y - q.y) < LABEL_MIN_GAP_PX) { clash = true; break; }
        }
        if (clash) {
          this.#hide(sys, k);
          continue;
        }
        this.placedLabels.push(p);
        sys.els[k].style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
        if (!sys.shown[k]) {
          sys.els[k].style.display = 'block';
          sys.shown[k] = true;
        }
      }
    }

    this.shownCount = systemsShown;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }
}

const DIR = new Vector3();
const CROSS = new Vector3();
const ABS = new Vector3();
const REL = new Vector3();
