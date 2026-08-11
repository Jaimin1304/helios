import { Vector3, Matrix3 } from 'three';
import { DEG, OBLIQUITY } from '../config.js';

/**
 * 解开普勒方程 M = E - e·sinE，牛顿迭代（高偏心率用更稳的初值）。
 * @param {number} M 平近点角(rad) @param {number} e 偏心率
 */
export function solveKepler(M, e) {
  // 归一化到 [-π, π)
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
 * 由 IAU 北极指向（赤道系 RA/Dec，度）构造"母天体赤道系 → 黄道系"的旋转矩阵。
 * 列向量：X = 赤道对黄道的升交点方向，Z = 自转极，Y = Z×X。
 */
/**
 * IAU 的自转基准子午线 W 是从「天体赤道对 **ICRF 赤道** 的升交点」量起的，
 * 而 equatorFrame() 的 X 轴是「对**黄道**的升交点」。两者都在天体赤道面内，
 * 相差一个绕自转轴的常量角，这里把它算出来。
 * @returns {number} 从黄道升交点转到 ICRF 升交点的有向角（弧度，绕自转轴正向）
 */
export function iauNodeOffset(poleRaDeg, poleDecDeg) {
  const ra = poleRaDeg * DEG;
  const dec = poleDecDeg * DEG;
  const pole = new Vector3(
    Math.cos(dec) * Math.cos(ra),
    Math.cos(dec) * Math.sin(ra),
    Math.sin(dec),
  );
  // ICRF 赤道上的升交点：ẑ_eq × pole，仍在赤道系里
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
  // 赤道系笛卡尔
  const xe = Math.cos(dec) * Math.cos(ra);
  const ye = Math.cos(dec) * Math.sin(ra);
  const ze = Math.sin(dec);
  // 绕 X 轴转 -ε：赤道系 → 黄道系
  const Z = new Vector3(
    xe,
    ye * Math.cos(OBLIQUITY) + ze * Math.sin(OBLIQUITY),
    -ye * Math.sin(OBLIQUITY) + ze * Math.cos(OBLIQUITY),
  ).normalize();

  // 升交点 = ẑ_ecl × Z
  let X = new Vector3(-Z.y, Z.x, 0);
  if (X.lengthSq() < 1e-12) X.set(1, 0, 0); // 极点与黄极重合的退化情况
  X.normalize();
  const Y = new Vector3().crossVectors(Z, X).normalize();

  return new Matrix3().set(X.x, Y.x, Z.x, X.y, Y.y, Z.y, X.z, Y.z, Z.z);
}

/**
 * 预编译一条轨道：把 (Ω, i, ω) 和可选的母天体赤道系合成两个基向量 P、Q，
 * 之后每帧只需 pos = P·x + Q·y（x,y 为轨道平面内坐标）。
 *
 * @param {object} el {a(km), e, i(deg), node(deg,Ω), peri(deg,ω), M0(deg), period(days)}
 * @param {Matrix3|null} frame 母天体赤道系→黄道系；null 表示根数已在黄道系
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
    n: (2 * Math.PI) / el.period, // 平均角速度 rad/day
    period: el.period,
    P,
    Q,
  };
}

/**
 * 求轨道在历元后 t 天的位置（相对母天体，km，黄道系）。
 * 结果写入 out（THREE.Vector3，内部是 float64，可放心当双精度用）。
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

/** 轨道在历元后 t 天的偏近点角 */
export function eccentricAnomalyAt(orbit, tDays) {
  return solveKepler(orbit.M0 + orbit.n * tDays, orbit.e);
}

/**
 * 采样整条轨道椭圆，用于画轨道线。
 *
 * 两个关键处理，都是为了让轨道线**正好穿过天体**：
 *  1. 采样相位从 E0 起步 —— 512 段折线是内接多边形，弦的矢高约 1.88e-5·a，
 *     在海王星轨道上就是 8 万多公里（3 倍海王星半径），肉眼可见地"擦肩而过"。
 *     把第 0 个顶点钉在天体当前位置上，误差就从该点起按二次增长，
 *     等到大到看得见时早就跑出画面了。
 *  2. 以 origin（天体当前的母天体相对位置）为几何原点 —— 否则顶点坐标高达
 *     4.5e6 场景单位，float32 只剩 ~450 km 精度，锚点会带着偏移。
 *
 * @returns {Float32Array} 顶点（km，相对 origin）
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
