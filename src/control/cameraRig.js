import { Vector3 } from 'three';
import {
  AU_KM, DEG, FOV, FREE_DIST_MAX, FREE_DIST_MIN, FOCUS_MIN_DIST_FACTOR, FLIGHT_AIM_LOCK,
} from '../config.js';

const MAX_PITCH = 89.5 * DEG;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (t) => t * t * (3 - 2 * t);
const FLY_TMP = new Vector3();

/**
 * 双精度相机机位。**所有状态都以 km 存**，渲染层再做浮动原点转换。
 *
 * 两种模式：
 *  - free  : 枢轴是空间中的一个点。中键平移；右键按下时先把枢轴吸附到
 *            "视口中心射线 ∩ 黄道面"，再绕它转（Blender 风格的转台）。
 *  - focus : 枢轴每帧跟随某个天体。右键绕天体转，滚轮拉近拉远。
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

  // ---------- 基向量 ----------
  direction(out = new Vector3()) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return out.set(cp * Math.cos(this.yaw), cp * Math.sin(this.yaw), sp);
  }

  /** 相机位置（km，日心黄道系） */
  position(out = this._pos) {
    this.direction(out);
    return out.multiplyScalar(this.dist).add(this.pivot);
  }

  /** 视线方向（单位向量，由相机指向枢轴） */
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

  // ---------- 交互 ----------
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
    // 保持 yaw 在 [-π, π)，避免长时间拖拽后浮点变大
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
   * 把枢轴吸附到「视口中心正交射线 ∩ 黄道面(z=0)」。
   * 相机位置保持不动，只改变枢轴与距离（视线方向不变，故 yaw/pitch 不用重算）。
   */
  snapPivotToEcliptic() {
    if (this.mode !== 'free') return false;
    const cam = this.position(new Vector3());
    const dir = this.forward(new Vector3());
    if (Math.abs(dir.z) < 1e-7) return false;
    const t = -cam.z / dir.z;
    if (!(t > FREE_DIST_MIN) || t > FREE_DIST_MAX) return false; // 交点在身后或远到没意义
    this.pivot.copy(cam).addScaledVector(dir, t);
    this.dist = t;
    return true;
  }

  /**
   * 计算一个"好看"的到位机位：停在天体的向阳侧、偏开一点，
   * 于是抵达时看到的是明暗界线漂亮的凸相，而不是漆黑的夜半球。
   */
  arrivalAngles(body) {
    const p = body.position;
    const r = Math.hypot(p.x, p.y);
    if (r < 1) return { yaw: this.yaw, pitch: this.pitch }; // 太阳自己
    return { yaw: Math.atan2(-p.y, -p.x) + 34 * DEG, pitch: 17 * DEG };
  }

  /** 由「相机位置 + 枢轴」反推 dist/yaw/pitch */
  setFromCameraAndPivot(cam, pivot) {
    const dx = cam.x - pivot.x, dy = cam.y - pivot.y, dz = cam.z - pivot.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-9) return; // 退化，保持上一帧朝向
    this.dist = len;
    this.yaw = Math.atan2(dy, dx);
    this.pitch = clamp(Math.asin(dz / len), -MAX_PITCH, MAX_PITCH);
  }

  /** 飞抵并聚焦某个天体 */
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

    // 终点机位：天体向阳侧、距离 targetDist 处。
    // 存成"相对天体的偏移"而不是绝对坐标——时间在流逝，天体一直在动，
    // 存绝对坐标的话飞到时早就偏出去了（1440× 下地球 2 秒能跑 14 万 km）。
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

  /** 解除聚焦，回到自由模式（保持当前机位） */
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

      // 机位沿 camStart→camEnd 的**直线**推进；但「离目标还有多远」按指数收缩，
      // 于是跨 30 AU 和跨 3 万公里的观感速度差不多，也不会在终点前一瞬间糊过去。
      const total = f.L + f.d1;
      const rem = total * Math.pow(f.d1 / total, s) - f.d1;
      const frac = f.L > 1e-9 ? 1 - rem / f.L : 1;
      f.camEnd.copy(f.body.position).add(f.camEndOffset); // 终点跟着天体走
      FLY_TMP.copy(f.camStart).lerp(f.camEnd, frac);

      // 枢轴在起飞的头一小段就滑到目标天体上，之后全程锁定它——
      // 于是"飞行途中镜头一直看着目标"，而不是快到了才转过去。
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
      this.pivot.copy(this.focus.position); // 天体在动时相机跟着走
      const min = this.focus.radius * FOCUS_MIN_DIST_FACTOR;
      if (this.dist < min) this.dist = min;
    }
  }
}
