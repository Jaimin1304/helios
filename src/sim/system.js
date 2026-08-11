import { Vector3, Matrix3 } from 'three';
import { BODIES, THEME_DEFAULT } from '../data/bodies.js';
import { compileOrbit, equatorFrame, iauNodeOffset, orbitPosition } from './kepler.js';
import { DAY_MS, DEG, J2000_MS } from '../config.js';

const TWO_PI = Math.PI * 2;

/**
 * 运行时天体。position 为**日心黄道系 km**，双精度（THREE.Vector3 内部是 float64）。
 */
class Body {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.kind = def.kind;
    this.radius = def.radius;
    this.theme = def.theme ?? THEME_DEFAULT;
    this.parent = null;
    this.children = [];
    this.orbit = null; // compileOrbit 的结果
    this.frame = null; // 自身赤道系 → 黄道系（Matrix3）
    this.position = new Vector3(); // 绝对位置 (km)
    this.local = new Vector3(); // 相对母天体 (km)
    /** 自转：spin = spinW0 + spinRate·t（弧度，绕自身 +Z 轴） */
    this.spinW0 = 0;
    this.spinRate = 0;
    this.spin = 0;
    /** 每帧由渲染层填写的屏幕信息 */
    this.screen = { visible: false, occluded: false, x: 0, y: 0, px: 0, dist: 0 };
  }

  /** 到太阳的距离(km) —— 太阳恒在原点 */
  get sunDistance() {
    return this.position.length();
  }

  /**
   * 赤道半径。数据表里存的是平均（体积）半径 R = Re·(1−f)^(1/3)，反解即可，
   * 实测与实际赤道半径误差 <0.01%（地球 6378.1、木星 71487、天王星 25559…）。
   * 扁球体渲染和表面重力都要用它。
   */
  get equatorialRadius() {
    const f = this.def.flattening || 0;
    return f > 0 ? this.radius / Math.cbrt(1 - f) : this.radius;
  }

  /**
   * 表面重力 g = GM/Re²（m/s²）；没有质量数据时返回 null。
   * 按通用惯例取**赤道**处的引力加速度（不含自转离心力），这样和各类资料对得上。
   */
  get surfaceGravity() {
    if (!this.def.gm) return null;
    const r = this.equatorialRadius;
    return (this.def.gm / (r * r)) * 1000;
  }

  /** 恒星自转周期（天，取绝对值）；不自转返回 null */
  get rotationDays() {
    return this.spinRate ? Math.abs((Math.PI * 2) / this.spinRate) : null;
  }

  /** 自转方向相对**黄道北极**是否为逆行（自转轴朝南时正的自转率也是逆行） */
  get retrograde() {
    if (!this.spinRate) return false;
    const axisZ = this.frame ? this.frame.elements[8] : 1; // 赤道系第三列的 z 分量
    return this.spinRate * axisZ < 0;
  }

  /** 是否潮汐锁定（自转周期与公转周期一致） */
  get synchronous() {
    if (!this.orbit || !this.rotationDays) return false;
    return Math.abs(this.rotationDays - this.orbit.period) < this.orbit.period * 1e-6;
  }
}

export class SolarSystem {
  constructor() {
    /** @type {Map<string, Body>} */
    this.byId = new Map();
    /** @type {Body[]} 已按"母天体先于子天体"排序 */
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
      if (!p) throw new Error(`未知母天体: ${def.parent}`);
      b.parent = p;
      p.children.push(b);
      // 卫星根数默认写在母天体赤道系里；显式 frame:'ecliptic' 的走黄道系
      const useEquator = def.orbit.frame !== 'ecliptic' && p.frame && def.parent !== 'sun';
      b.orbit = compileOrbit(def.orbit, useEquator ? p.frame : null);
      // 没有自身极点数据的规则卫星：自转轴近似取母天体的极轴（它们本来就大致
      // 在母天体赤道面内公转并被潮汐锁定）
      if (!b.frame && p.frame) b.frame = p.frame;
    }

    // 拓扑序（母天体一定排在子天体前面）
    const walk = (b) => {
      this.bodies.push(b);
      for (const c of b.children) walk(c);
    };
    walk(this.root);
  }

  /** 用真实日期设定仿真时刻 */
  setDate(date) {
    this.timeDays = (date.getTime() - J2000_MS) / DAY_MS;
    this.update();
    this.initSpin();
  }

  /** 当前仿真时刻对应的真实 UTC 时间 */
  get date() {
    return new Date(J2000_MS + this.timeDays * DAY_MS);
  }

  /** 推进仿真时间（天） */
  advance(days) {
    if (!days) return;
    this.timeDays += days;
    this.update();
  }

  /**
   * 建表时确定每个天体的自转参数。三种来源，按可信度排序：
   *  1. IAU 自转基准子午线（W0 + Wdot），换算到本工程的赤道系；
   *  2. 潮汐锁定的卫星：自转率由「指向母天体的方向在自身赤道系里的角速度」反解，
   *     这样逆行卫星（海卫一、土卫九）自动得到逆向自转，相位也天然对齐成同步自转；
   *  3. 只有自转周期的：按周期给速率，历元相位取 0（未校准）。
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
        // 潮汐锁定：自转速率 = 轨道**平均**运动（不是瞬时角速度——偏心轨道的
        // 真近点角速率不均匀，高倾角轨道投影到赤道面后更不均匀，用瞬时值会
        // 系统性偏差百分之几）。这样天平动也会自然浮现，正是真实行为。
        // 方向由轨道角动量在自转轴上的投影决定，逆行卫星自动得到逆向自转。
        const n = TWO_PI / b.orbit.period;
        TMP_B.crossVectors(b.orbit.P, b.orbit.Q); // 轨道法向（沿运动方向右手法则）
        if (b.frame) {
          const e = b.frame.elements;
          TMP_C.set(e[6], e[7], e[8]); // 赤道系第三列 = 自转轴
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

  /** 某时刻「天体→母天体」的方向在自身赤道系里的方位角 */
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

  /** 按当前 timeDays 传播所有天体位置与自转 */
  update() {
    const t = this.timeDays;
    for (const b of this.bodies) {
      if (!b.orbit) {
        b.position.set(0, 0, 0); // 太阳固定在原点（忽略质心摆动）
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
