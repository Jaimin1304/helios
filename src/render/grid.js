import {
  BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, Color, Group,
} from 'three';
import { AU_KM, KM_TO_UNITS, FOV, DEG } from '../config.js';
import { T } from '../i18n.js';

/**
 * 以太阳为原点的黄道面坐标系（黄道面就是场景的 z = 0 平面）。
 *
 * 真实比例下格距不可能固定：从卫星轨道到柯伊伯带跨了 6 个数量级。
 * 所以几何体一律建在「整数格」的归一化坐标上（±HALF 格），每帧只按当前
 * 视野尺度挑一个 1-2-5 进制的格距 unit，然后整体 scale(unit)——
 * 格距和覆盖范围同时缩放，一份几何体走遍所有尺度。
 */
/** 格距固定为 1 AU：太阳系里唯一有物理意义的长度单位，读数才有意义 */
const HALF = 50; // 每个方向 ±50 AU（覆盖到柯伊伯带外缘）
const MAJOR = 10; // 每 10 AU 一根主线
const CIRCLE_SEGMENTS = 240;
/** 相邻刻度标签的最小屏幕间距 */
const TICK_MIN_GAP_PX = 34;
const SPOKES = 24; // 极坐标每 15° 一根

const COLOR_MINOR = '#4a6b8c';
const COLOR_MAJOR = '#7ea6cc';
const COLOR_AXIS_X = '#c96a5a'; // 指向春分点
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
  line.renderOrder = -5; // 在天体之前画，深度测试仍然让行星挡住它
  return line;
}

/**
 * 把一条长线切成 steps 小段。
 *
 * 这不是可有可无的优化：一条横跨 100 格的线段在掠射视角下会从相机跟前一直
 * 伸到几十 AU 外，深度范围跨好几个数量级。这种超长图元会被光栅化/裁剪精度
 * 吃掉近端（实测近处整片消失，只剩地平线附近一条带），而对数深度缓冲的
 * 深度插值本来也只在短图元上才准。切碎之后每段的深度范围都很小。
 */
function pushLine(pts, x0, y0, x1, y1, steps) {
  for (let s = 0; s < steps; s++) {
    const t0 = s / steps;
    const t1 = (s + 1) / steps;
    pts.push(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0, 0);
    pts.push(x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1, 0);
  }
}

/** 直角网格：平行于 X/Y 轴的两族直线 */
function buildRect(major) {
  const pts = [];
  for (let i = -HALF; i <= HALF; i++) {
    if (i === 0) continue; // 0 线交给坐标轴
    if ((i % MAJOR === 0) !== major) continue;
    pushLine(pts, -HALF, i, HALF, i, HALF * 2);
    pushLine(pts, i, -HALF, i, HALF, HALF * 2);
  }
  return pts;
}

/** 极坐标：同心圆 + 辐条 */
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
    this.unitKm = AU_KM; // 恒为 1 AU
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
    // 两根坐标轴（春分点方向 / 黄经 90°），两种模式共用
    const axX = []; pushLine(axX, -HALF, 0, HALF, 0, HALF * 2);
    const axY = []; pushLine(axY, 0, -HALF, 0, HALF, HALF * 2);
    this.axes = [segments(axX, this.matAxisX), segments(axY, this.matAxisY)];

    for (const o of [...this.rect, ...this.polar, ...this.axes]) {
      o.visible = false;
      this.group.add(o);
    }

    // ---- 刻度（DOM 覆盖层）----
    // 沿两条坐标轴标注 AU 读数，标签颜色跟着轴走，一眼能对上是哪条轴。
    this.ticks = [];
    if (tickContainer) {
      for (let r = 1; r <= HALF; r++) {
        for (const [axis, color] of [['x', COLOR_AXIS_X], ['y', COLOR_AXIS_Y]]) {
          for (const sign of [1, -1]) { // 两个方向都标
            const el = document.createElement('div');
            el.className = 'gridtick';
            // 刻度只作距离参照，两个方向都用无符号读数
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

  /** 关 → 方格 → 极坐标 → 关 */
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
   * 刻度标签定位。传入把「黄道系 km」投到屏幕的回调，由主循环提供
   * （那边已经有相机基向量和像素焦距）。
   * @param {(x:number,y:number,z:number)=>({x:number,y:number,visible:boolean})} project
   */
  updateTicks(project, width, height) {
    if (this.mode === 'off' || !this.ticks.length) return;
    // 透视会把远处的刻度挤到一起，按屏幕间距再抽一次（四个半轴各自独立）
    const lastPlaced = { 'x1': null, 'x-1': null, 'y1': null, 'y-1': null };
    for (const t of this.ticks) {
      // 读数太密就抽稀：只显示步长的整数倍
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
   * @param {import('three').Vector3} sunRel 太阳相对相机的位置（场景单位）
   * @param {number} viewScaleKm 当前视野尺度（相机到枢轴的距离，km）
   * @param {number} sunDistKm   相机到太阳的距离，km
   * @param {number} viewportH   视口高度（像素）
   */
  update(sunRel, viewScaleKm, sunDistKm, viewportH) {
    if (this.mode === 'off') return;

    this.group.position.copy(sunRel);
    this.group.scale.setScalar(AU_KM * KM_TO_UNITS); // 一格恒为 1 AU

    // 一格在屏幕上占多少像素，决定细线的淡出和刻度的抽稀密度
    const kmPerPx = (2 * viewScaleKm * Math.tan((FOV * DEG) / 2)) / viewportH;
    const cellPx = AU_KM / Math.max(kmPerPx, 1e-9);

    const fade = Math.min(1, Math.max(0, (cellPx - 3) / 18));
    this.matMinor.opacity = 0.11 * fade;
    this.matMajor.opacity = 0.34 * Math.min(1, Math.max(0, (cellPx * MAJOR - 3) / 30));
    this.matAxisX.opacity = 0.6 * Math.min(1, Math.max(0, cellPx * MAJOR / 12));
    this.matAxisY.opacity = this.matAxisX.opacity;

    // 刻度抽稀：贴近时逐 AU 标，拉远后 5 AU、10 AU
    this.tickStep = cellPx > 55 ? 1 : cellPx > 13 ? 5 : 10;
  }
}
