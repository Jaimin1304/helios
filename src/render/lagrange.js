import {
  BufferGeometry, BufferAttribute, Points, ShaderMaterial, Color, Vector3,
} from 'three';
import { KM_TO_UNITS } from '../config.js';
import { smoothstep } from './noise.js';
import { getMarkerTexture } from './textures.js';

/**
 * 每个天体与其母天体构成的两体系统的五个拉格朗日点，实时跟随。
 *
 * 三个共线点 L1/L2/L3 的位置只取决于质量比 μ = m₂/(m₁+m₂)，是常量，
 * 建表时解一次即可；每帧只需把「母天体→子天体」这个方向和距离套上去。
 * 两个三角点 L4/L5 更简单——它们与两个天体构成等边三角形，恒在轨道前后 60°。
 *
 * L1/L2/L3 是不稳定平衡（鞍点），L4/L5 在 μ < 0.0385 时稳定（木星的特洛伊群
 * 就聚在那里），所以两类用不同颜色区分。
 */

const MARKER_PX = 11;
/** 轨道屏幕半径小于该值就不显示：否则五个点会全糊在母天体上 */
const MIN_ORBIT_PX = 90;
const COLOR_COLLINEAR = '#7fb2d9'; // L1/L2/L3 不稳定
const COLOR_TRIANGULAR = '#e6bd63'; // L4/L5 稳定
const LABEL_MIN_GAP_PX = 40;
const NAMES = ['L1', 'L2', 'L3', 'L4', 'L5'];
const COS60 = 0.5;
const SIN60 = Math.sqrt(3) / 2;

/**
 * 解三个共线点。用旋转坐标系里的无量纲形式：两天体相距 1，主星在 -μ、次星在 1-μ，
 *   f(x) = x - (1-μ)·(x+μ)/|x+μ|³ - μ·(x-1+μ)/|x-1+μ|³ = 0
 * 三个根分别落在 (-μ, 1-μ)、(1-μ, +∞)、(-∞, -μ) 三段里，每段两端 f 的符号相反，
 * 所以直接二分——比牛顿法慢但绝对收敛，而且只在建表时算一次。
 * @returns {number[]} 从**主星**量起的距离，以两天体间距为单位（L3 为负）
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
    bisect(-mu + eps, 1 - mu - eps) + mu, // L1 在两者之间
    bisect(1 - mu + eps, 3) + mu, // L2 在次星外侧
    bisect(-3, -mu - eps) + mu, // L3 在主星另一侧
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

    for (const body of bodies) {
      const parent = body.parent;
      if (!body.orbit || !parent || !body.def.gm || !parent.def.gm) continue;
      const mu = body.def.gm / (parent.def.gm + body.def.gm);
      this.systems.push({
        body,
        parent,
        mu,
        s: collinearPoints(mu),
        // 轨道法向（沿运动方向的右手法则），用来把 L4/L5 转到轨道前后 60°
        normal: new Vector3().crossVectors(body.orbit.P, body.orbit.Q).normalize(),
        els: NAMES.map((name, k) => {
          const el = document.createElement('div');
          el.className = 'lpoint';
          // 一个视野里可能同时有十几组，只写 'L4' 分不清是谁的，带上子天体名
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
   * @param {Vector3} camPosKm 相机位置（km，日心黄道系）
   * @param {(x:number,y:number,z:number)=>({x:number,y:number,visible:boolean})} project
   * @param {number} focalPx 像素焦距
   */
  update(camPosKm, project, focalPx, viewW, viewH) {
    if (!this.enabled) return;
    const placed = [];
    let systemsShown = 0;

    for (let si = 0; si < this.systems.length; si++) {
      const sys = this.systems[si];
      const r = sys.body.local.length();
      DIR.copy(sys.body.local).divideScalar(r);

      // 轨道在屏幕上太小的话五个点会全叠在母天体上，没有意义
      const parentDist = Math.max(sys.parent.position.distanceTo(camPosKm), 1);
      const alpha = smoothstep(MIN_ORBIT_PX, MIN_ORBIT_PX * 1.6, (r / parentDist) * focalPx);
      if (alpha > 0.01) systemsShown++;

      for (let k = 0; k < 5; k++) {
        if (k < 3) {
          ABS.copy(DIR).multiplyScalar(r * sys.s[k]);
        } else {
          // L4/L5：把 母星→子星 的方向绕轨道法向转 ±60°（罗德里格斯公式，
          // 法向与该方向垂直所以第三项为零），长度仍是 r —— 等边三角形
          CROSS.crossVectors(sys.normal, DIR);
          const sign = k === 3 ? 1 : -1; // L4 领先、L5 落后
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

        // 标签
        const p = alpha > 0.01 ? project(ABS.x, ABS.y, ABS.z) : null;
        if (!p || !p.visible || p.x < 2 || p.x > viewW - 24 || p.y < 2 || p.y > viewH - 12) {
          this.#hide(sys, k);
          continue;
        }
        let clash = false;
        for (const q of placed) {
          if (Math.hypot(p.x - q.x, p.y - q.y) < LABEL_MIN_GAP_PX) { clash = true; break; }
        }
        if (clash) {
          this.#hide(sys, k);
          continue;
        }
        placed.push(p);
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
