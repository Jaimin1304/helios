import {
  BufferGeometry, BufferAttribute, Points, ShaderMaterial, AdditiveBlending, Color, Vector3,
} from 'three';
import { AU_KM, DEG, KM_TO_UNITS } from '../config.js';
import { rng, seedOf, smoothstep } from './noise.js';

/**
 * 小行星带与柯伊伯带。
 *
 * 每个粒子都带着自己的一套真实轨道根数，**开普勒方程在顶点着色器里解**，
 * 所以它们是货真价实地在绕日公转（各自周期不同 → 会自然形成较差转动），
 * 而不是一张贴图或一个整体旋转的圆环。代价只有 2 个 draw call。
 *
 * 尺寸上真实的小行星在任何视距下都远小于一个像素，所以画成恒定 1 设备像素的
 * 光点（关掉尺寸衰减）——这既是最省的画法，也是物理上最诚实的画法。
 *
 * 不可交互：它们不是 Body，不参与拾取，也没有标签。
 */

/**
 * 点的尺寸必须取**整数设备像素**。
 *
 * GL 对 point 的光栅化规则是：以点位置为中心、边长 gl_PointSize 的正方形，
 * 覆盖到哪些像素的**中心**就生成哪些片元。所以边长取 1.6 时，正方形会随
 * 亚像素位置的漂移覆盖到 1、2 或 4 个像素中心——同一颗小行星的亮度会随它
 * 移动在 1~4 倍之间跳，这是走样闪烁，不是"闪烁的星星"。
 * 整数边长则恒定覆盖 n² 个像素，亮度稳定；1 是理论最小值，也最像真实的星点。
 *
 * 之所以不直接写死 1.0：gl_PointSize 的单位是**设备像素**，在 2 倍屏上
 * 1 设备像素只有半个 CSS 像素，整条带会明显变稀。取 round(dpr) 既保持整数，
 * 又让不同像素密度的屏幕看到差不多的观感。
 */
const pointSize = (dpr) => Math.max(1, Math.round(dpr));
/** 带的屏幕半径达到该像素数时取满不透明度，更小则按面积比衰减 */
const REF_SPAN_PX = 420;

/** 柯克伍德空隙：与木星的平均运动共振扫空的位置 [中心AU, 宽度, 深度] */
const KIRKWOOD = [
  [2.065, 0.012, 0.85], // 4:1
  [2.502, 0.020, 0.92], // 3:1
  [2.825, 0.015, 0.80], // 5:2
  [2.958, 0.012, 0.70], // 7:3
  [3.279, 0.020, 0.90], // 2:1
];

const BELTS = {
  main: {
    count: 60000,
    color: '#cfc3ad', // 小行星以碳质/硅酸盐为主，偏暖灰
    brightness: 1.05, // 1.6px 时期望覆盖 2.56 个片元，改 1px 后按比例补回
    aRange: [2.00, 3.35],
    meanAU: 2.75,
    /** 主带的径向数密度（含空隙），用于拒绝采样 */
    density(a) {
      let d = smoothstep(2.05, 2.35, a) * (1 - smoothstep(3.05, 3.30, a));
      d *= 0.55 + 0.45 * Math.exp(-((a - 2.85) ** 2) / 0.24);
      for (const [c, w, depth] of KIRKWOOD) {
        d *= 1 - depth * Math.exp(-((a - c) ** 2) / (2 * w * w));
      }
      return d;
    },
    /** 偏心率与倾角：主带实测平均 e≈0.14、i≈10° */
    shape(rand) {
      return {
        e: Math.min(0.34, 0.02 + Math.sqrt(-2 * Math.log(1 - rand() * 0.999)) * 0.085),
        inc: Math.min(32, Math.sqrt(-2 * Math.log(1 - rand() * 0.999)) * 7.2) * DEG,
      };
    },
  },
  kuiper: {
    count: 45000,
    color: '#c9a89a', // KBO 表面偏红
    brightness: 1.25,
    meanAU: 43,
    /** 柯伊伯带不是均匀圆环，按三个真实子群混合采样 */
    sample(rand) {
      const r = rand();
      if (r < 0.25) {
        // 冥族小天体：与海王星 3:2 共振，聚集在 39.4 AU，偏心率和倾角都更大
        return {
          a: 39.45 + (rand() - 0.5) * 0.7,
          e: 0.10 + rand() * 0.22,
          inc: Math.min(24, Math.sqrt(-2 * Math.log(1 - rand() * 0.999)) * 8.5) * DEG,
        };
      }
      if (r < 0.85) {
        // 冷经典带：42~47.5 AU，轨道近圆、几乎共面，外缘就是"柯伊伯断崖"
        return {
          a: 42.0 + rand() * 5.5,
          e: rand() * 0.09,
          inc: Math.sqrt(-2 * Math.log(1 - rand() * 0.999)) * 2.2 * DEG,
        };
      }
      // 热经典带：分布更宽、倾角更高
      return {
        a: 40.0 + rand() * 8.0,
        e: 0.04 + rand() * 0.20,
        inc: Math.min(34, 4 + Math.sqrt(-2 * Math.log(1 - rand() * 0.999)) * 11) * DEG,
      };
    },
  },
};

const VERT = /* glsl */`
  attribute vec3 aP;      // 近日点方向基
  attribute vec3 aQ;      // 轨道面内的正交基
  attribute vec2 aPhase;  // x = 历元平近点角, y = 亮度
  uniform float uTime;    // J2000 起的天数
  uniform float uSize;    // 点的尺寸，整数设备像素
  varying float vShade;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    // position 借用来存轨道量：x = 半长径(场景单位), y = 偏心率, z = 平均角速度(rad/day)
    float a = position.x;
    float e = position.y;
    float M = aPhase.x + position.z * uTime;

    // 解开普勒方程 M = E - e·sinE。e < 0.35，牛顿迭代 3 次足够收敛到像素以下。
    float E = M + e * sin(M);
    for (int k = 0; k < 3; k++) {
      E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
    }

    vec3 p = aP * (a * (cos(E) - e)) + aQ * (a * sqrt(1.0 - e * e) * sin(E));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize;
    vShade = aPhase.y;

    #include <logdepthbuf_vertex>
  }
`;

const FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vShade;

  #include <common>
  #include <logdepthbuf_pars_fragment>

  void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(uColor * vShade * uOpacity, 1.0);
  }
`;

function buildGeometry(spec, seed) {
  const rand = rng(seedOf(seed));
  const n = spec.count;
  const orbit = new Float32Array(n * 3);
  const pv = new Float32Array(n * 3);
  const qv = new Float32Array(n * 3);
  const phase = new Float32Array(n * 2);

  // 拒绝采样用的密度上界
  let peak = 0;
  if (spec.density) {
    for (let k = 0; k <= 200; k++) {
      const a = spec.aRange[0] + ((spec.aRange[1] - spec.aRange[0]) * k) / 200;
      peak = Math.max(peak, spec.density(a));
    }
  }

  for (let i = 0; i < n; i++) {
    let aAU, e, inc;
    if (spec.sample) {
      ({ a: aAU, e, inc } = spec.sample(rand));
    } else {
      do {
        aAU = spec.aRange[0] + rand() * (spec.aRange[1] - spec.aRange[0]);
      } while (rand() * peak > spec.density(aAU));
      ({ e, inc } = spec.shape(rand));
    }

    const node = rand() * Math.PI * 2;
    const peri = rand() * Math.PI * 2;
    const cn = Math.cos(node), sn = Math.sin(node);
    const cw = Math.cos(peri), sw = Math.sin(peri);
    const ci = Math.cos(inc), si = Math.sin(inc);

    pv[i * 3] = cn * cw - sn * sw * ci;
    pv[i * 3 + 1] = sn * cw + cn * sw * ci;
    pv[i * 3 + 2] = sw * si;
    qv[i * 3] = -cn * sw - sn * cw * ci;
    qv[i * 3 + 1] = -sn * sw + cn * cw * ci;
    qv[i * 3 + 2] = cw * si;

    orbit[i * 3] = aAU * AU_KM * KM_TO_UNITS;
    orbit[i * 3 + 1] = e;
    // 平均角速度：高斯引力常数形式 n = k·a^-1.5（rad/day，a 以 AU 计）
    orbit[i * 3 + 2] = 0.01720209895 / (aAU * Math.sqrt(aAU));

    phase[i * 2] = rand() * Math.PI * 2;
    // 亮度取幂律：绝大多数很暗，少数亮，观感上才有"颗粒感"而不是一片糊
    phase[i * 2 + 1] = 0.15 + rand() ** 2.6 * 0.85;
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(orbit, 3));
  geo.setAttribute('aP', new BufferAttribute(pv, 3));
  geo.setAttribute('aQ', new BufferAttribute(qv, 3));
  geo.setAttribute('aPhase', new BufferAttribute(phase, 2));
  return geo;
}

class Belt {
  constructor(spec, seed, scene, pixelRatio) {
    this.spec = spec;
    this.material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: pointSize(pixelRatio) },
        uColor: { value: new Color(spec.color).multiplyScalar(spec.brightness) },
        uOpacity: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true, // 行星要能挡住它们
      toneMapped: false,
    });
    this.points = new Points(buildGeometry(spec, seed), this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -2; // 在轨道线之前画
    scene.add(this.points);
  }

  /**
   * @param {Vector3} sunRel 太阳相对相机的位置（场景单位）
   * @param {number} viewScaleKm 当前视野尺度（相机到枢轴的距离，km）
   * @param {number} sunDistKm 相机到太阳的距离，km
   * @param {number} focalPx 像素焦距
   * @param {number} timeDays 仿真时刻
   */
  update(sunRel, viewScaleKm, sunDistKm, focalPx, timeDays) {
    this.points.position.copy(sunRel);
    this.material.uniforms.uTime.value = timeDays;

    const meanKm = this.spec.meanAU * AU_KM;
    // ① 镜头尺度远小于带本身时淡出：贴着行星看的时候真实小行星根本不可见，
    //    满屏乱撒光点只会变成噪点。
    const near = smoothstep(0.02 * meanKm, 0.15 * meanKm, viewScaleKm);
    // ② 按屏幕面积归一化：点是恒定像素尺寸的，带被压小时总光通量不变、
    //    单位面积亮度却 ∝ 1/面积，加法混合下会糊成一坨白斑。乘上面积比即可
    //    让"远看是一圈淡淡的环"，而不是一个过曝的团。
    const beltPx = (meanKm / Math.max(sunDistKm, 1)) * focalPx;
    const spread = Math.min(1, (beltPx / REF_SPAN_PX) ** 2);

    const o = near * spread;
    this.material.uniforms.uOpacity.value = o;
    this.points.visible = o > 0.004;
  }
}

export class Belts {
  constructor(scene, pixelRatio) {
    this.main = new Belt(BELTS.main, 'mainbelt', scene, pixelRatio);
    this.kuiper = new Belt(BELTS.kuiper, 'kuiperbelt', scene, pixelRatio);
  }

  get count() {
    return BELTS.main.count + BELTS.kuiper.count;
  }

  update(sunRel, viewScaleKm, sunDistKm, focalPx, timeDays) {
    this.main.update(sunRel, viewScaleKm, sunDistKm, focalPx, timeDays);
    this.kuiper.update(sunRel, viewScaleKm, sunDistKm, focalPx, timeDays);
  }
}
