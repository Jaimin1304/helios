import {
  BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, Color, Group,
} from 'three';
import { AU_KM, KM_TO_UNITS, FAR_UNITS, FOV, DEG } from '../config.js';

/**
 * 以太阳为原点的黄道面坐标系（黄道面就是场景的 z = 0 平面）。
 *
 * 真实比例下格距不可能固定：从卫星轨道到柯伊伯带跨了 6 个数量级。
 * 所以几何体一律建在「整数格」的归一化坐标上（±HALF 格），每帧只按当前
 * 视野尺度挑一个 1-2-5 进制的格距 unit，然后整体 scale(unit)——
 * 格距和覆盖范围同时缩放，一份几何体走遍所有尺度。
 */
const HALF = 50; // 每个方向 ±50 格
const MAJOR = 10; // 每 10 格一根主线
const CIRCLE_SEGMENTS = 240;
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

/** 取 1-2-5 进制的"整数感"步长 */
function niceStep(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m < 2 ? 1 : m < 5 ? 2 : 5) * p;
}

export function formatUnit(km) {
  if (km >= 0.005 * AU_KM) {
    const au = km / AU_KM;
    return `${au >= 1 ? au.toFixed(au < 10 ? 1 : 0) : au.toFixed(3)} AU`;
  }
  if (km >= 1e6) return `${(km / 1e6).toFixed(0)} 百万 km`;
  if (km >= 1000) return `${(km / 1000).toFixed(0)} 千 km`;
  return `${km.toFixed(0)} km`;
}

export class EclipticGrid {
  constructor(scene) {
    this.mode = 'off'; // off | rect | polar
    this.unitKm = AU_KM;

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
  }

  /** 关 → 方格 → 极坐标 → 关 */
  cycle() {
    this.mode = this.mode === 'off' ? 'rect' : this.mode === 'rect' ? 'polar' : 'off';
    const on = this.mode !== 'off';
    for (const o of this.rect) o.visible = this.mode === 'rect';
    for (const o of this.polar) o.visible = this.mode === 'polar';
    for (const o of this.axes) o.visible = on;
    return this.mode;
  }

  /**
   * @param {import('three').Vector3} sunRel 太阳相对相机的位置（场景单位）
   * @param {number} viewScaleKm 当前视野尺度（相机到枢轴的距离，km）
   * @param {number} sunDistKm   相机到太阳的距离，km
   * @param {number} viewportH   视口高度（像素）
   */
  update(sunRel, viewScaleKm, sunDistKm, viewportH) {
    if (this.mode === 'off') return;

    // 目标：一格约 110 px。同时不让格子小到整张网格缩成太阳边上的一个点，
    // 所以再用"到太阳的距离 / 400"兜底。
    const kmPerPx = (2 * viewScaleKm * Math.tan((FOV * DEG) / 2)) / viewportH;
    let unit = niceStep(Math.max(kmPerPx * 110, sunDistKm / 400, 1));
    // 整张网格必须留在远裁面里，否则边缘会被裁出一道直边
    const maxUnitKm = (FAR_UNITS * 0.45) / HALF / KM_TO_UNITS;
    if (unit > maxUnitKm) unit = niceStep(maxUnitKm / 2);
    this.unitKm = unit;

    this.group.position.copy(sunRel);
    this.group.scale.setScalar(unit * KM_TO_UNITS);

    // 格子在屏幕上太小就淡出，免得糊成一片
    const cellPx = unit / Math.max(kmPerPx, 1e-9);
    const fade = Math.min(1, Math.max(0, (cellPx - 4) / 20));
    this.matMinor.opacity = 0.16 * fade;
    this.matMajor.opacity = 0.34 * fade;
    this.matAxisX.opacity = 0.55 * fade;
    this.matAxisY.opacity = 0.55 * fade;
  }
}
