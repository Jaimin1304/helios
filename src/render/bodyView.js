import {
  Mesh, SphereGeometry, RingGeometry, MeshStandardMaterial, MeshBasicMaterial,
  Sprite, SpriteMaterial, AdditiveBlending, DoubleSide, Color, Matrix4, Vector3,
  Quaternion, Float32BufferAttribute,
} from 'three';
import { AU_KM, KM_TO_UNITS, DOT_SIZE_PX, DOT_TAKEOVER_PX, DOT_FULL_PX } from '../config.js';
import {
  makeSurface, makeRingTexture, getGlowTexture, getStarburstTexture, getGlareTexture,
} from './textures.js';
import { pickTexture } from './assets.js';
import { smoothstep } from './noise.js';

/** 环的等效反照率（含后向散射的经验值），配合平方反比给出最终亮度 */
const RING_ALBEDO = 0.45;
/** 夜面灯光强度。真实城市灯光比日照弱好几个数量级，这里只取"看得见但明显更暗" */
const NIGHT_INTENSITY = 0.45;
/** 云层壳相对地表的高度倍率（地球 ≈ 16 km） */
const CLOUD_SHELL = 1.0025;
/** 云层自转比地表快的比例，制造缓慢的相对漂移 */
const CLOUD_DRIFT = 0.02;
/** 日面临边相对中心的亮度（真实太阳可见光波段约 0.3~0.4） */
const LIMB_EDGE = 0.34;
/** 日面亮度过曝倍数：最亮的米粒组织削到纯白，观感才够"刺眼" */
const STAR_OVERDRIVE = 1.55;
/** 星芒的屏幕尺寸上限（像素），免得贴近时糊满整屏 */
const STAR_FLARE_MAX_PX = 900;
/** 相机到恒星近于该距离时不画星芒，到 FADE 距离恢复满强度（AU） */
const STAR_FLARE_MIN_AU = 2.0;
const STAR_FLARE_FADE_AU = 2.6;
/** 面纱眩光：1 AU 处的强度，以及它铺开的屏幕尺寸 */
const GLARE_GAIN = 2;
const GLARE_SPAN_PX = 2000;
/** 相机近于该距离时不画眩光（贴脸看日面时别挡路），到 FADE 距离恢复（AU） */
const GLARE_MIN_AU = 0.03;
const GLARE_FADE_AU = 0.06;

/** 按天体大小挑球体细分 */
function segmentsFor(body) {
  if (body.kind === 'star') return [128, 64];
  if (body.kind === 'planet') return [96, 48];
  if (body.radius > 800) return [64, 32];
  if (body.radius > 150) return [48, 24];
  return [24, 12];
}

/**
 * 一个天体的全部可视对象：球体 + 恒定屏幕尺寸的光点 + 可选星环 / 云层。
 * 所有对象都直接挂在 scene 下（不做父子嵌套），位置每帧由浮动原点写入。
 */
export class BodyView {
  /** @param {Map<string, import('three').Texture>} assets 预加载好的真实纹理 */
  constructor(body, scene, assets = new Map()) {
    this.body = body;
    const def = body.def;
    // 球体按赤道半径建、再沿极轴压扁 (1−f)，得到的正是真实的扁球体
    const radiusUnits = body.equatorialRadius * KM_TO_UNITS;

    const [ws, hs] = segmentsFor(body);
    const geo = new SphereGeometry(radiusUnits, ws, hs);
    // three 的球极点在 +Y；本工程天体自转轴用 +Z，这里把几何体扳正，
    // 这样贴图的 v 方向 = 天体纬度，星环也落在 local XY 平面。
    geo.rotateX(Math.PI / 2);

    // 有真实纹理就用真实的，否则回退到程序化表面
    const realMap = pickTexture(assets, def.tex?.map);
    const nightMap = pickTexture(assets, def.tex?.night);
    const cloudMap = pickTexture(assets, def.tex?.clouds, 'linear');
    let bump = null;
    let map = realMap;
    if (!map) ({ map, bump } = makeSurface(def));

    if (body.kind === 'star') {
      this.material = new MeshBasicMaterial({ map, toneMapped: false });
      this.#attachLimbDarkening();
    } else {
      this.material = new MeshStandardMaterial({
        map,
        bumpMap: bump,
        bumpScale: bump ? Math.min(1.2, radiusUnits * 0.06 + 0.02) : 0,
        roughness: 0.92,
        metalness: 0.0,
      });
      if (nightMap) this.#attachNightSide(nightMap);
    }

    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false; // 位置每帧手写，让 three 自己剔除容易误判
    this.mesh.renderOrder = 1;

    // 自转轴指向：赤道系旋转是常量，自转角每帧叠在它后面（绕自身 +Z）
    this.frameQuat = new Quaternion();
    if (body.frame) {
      this.frameQuat.setFromRotationMatrix(new Matrix4().setFromMatrix3(body.frame));
    }
    this.mesh.quaternion.copy(this.frameQuat);
    this.spinQuat = new Quaternion();
    this.spinAxis = new Vector3(0, 0, 1);
    // 扁率：沿自转轴压扁
    const f = def.flattening || 0;
    if (f > 0) this.mesh.scale.set(1, 1, 1 - f);

    scene.add(this.mesh);

    // ---- 云层壳 ----
    this.clouds = null;
    if (cloudMap) {
      const cgeo = new SphereGeometry(radiusUnits * CLOUD_SHELL, ws, hs);
      cgeo.rotateX(Math.PI / 2);
      this.clouds = new Mesh(cgeo, new MeshStandardMaterial({
        color: 0xffffff,
        alphaMap: cloudMap,
        transparent: true,
        depthWrite: false,
        roughness: 1,
        metalness: 0,
      }));
      this.clouds.frustumCulled = false;
      this.clouds.renderOrder = 2;
      this.clouds.quaternion.copy(this.frameQuat);
      this.clouds.scale.copy(this.mesh.scale);
      scene.add(this.clouds);
    }

    // ---- 恒定屏幕尺寸的光点（天体小到看不见时接管）----
    const isStar = body.kind === 'star';
    const tint = new Color(def.palette ? def.palette[def.palette.length - 1] : '#ffffff');
    // 恒星的星芒故意推到 1.0 以上：核心削成纯白，芒的中间调也跟着提亮，
    // 这是在不上后期 bloom 的前提下最接近"过曝发光"的手段
    if (isStar) tint.setRGB(1.75, 1.62, 1.44);
    this.dot = new Sprite(new SpriteMaterial({
      map: isStar ? getStarburstTexture() : getGlowTexture(),
      color: tint,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      opacity: 0,
    }));
    this.dot.frustumCulled = false;
    this.dot.renderOrder = 4;
    this.dotSizePx = DOT_SIZE_PX[body.kind] ?? 6;
    scene.add(this.dot);

    // ---- 恒星贴边热晕 ----
    // depthTest:true —— 精灵面片过日心，被日面球体挡掉的正好是圆面内部，
    // 于是这层叠加光只出现在临边之外，既不糊掉日面细节，凌日的行星也不会被冲掉。
    this.halo = null;
    if (body.kind === 'star') {
      this.halo = new Sprite(new SpriteMaterial({
        map: getGlowTexture(),
        color: new Color('#ffe6b8'),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
        opacity: 0,
      }));
      this.halo.frustumCulled = false;
      this.halo.renderOrder = 3;
      this.halo.scale.setScalar(radiusUnits * 2.4);
      scene.add(this.halo);

      // 面纱眩光：唯一一层 depthTest:false 的，因为它模拟的是光进入镜头之后
      // 在镜头内部散射出来的雾——它本来就该盖在整个画面上，而不是被几何体挡住。
      this.glare = new Sprite(new SpriteMaterial({
        map: getGlareTexture(),
        color: new Color('#fff3dc'),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        opacity: 0,
      }));
      this.glare.frustumCulled = false;
      this.glare.renderOrder = 50; // 最后画
      scene.add(this.glare);
    }

    // ---- 星环 ----
    this.rings = null;
    if (def.rings) {
      const inner = def.rings.innerKm * KM_TO_UNITS;
      const outer = def.rings.outerKm * KM_TO_UNITS;
      const rgeo = new RingGeometry(inner, outer, 256, 1);
      // 自定义 UV：u 沿半径方向铺开，配合径向环带贴图
      const pos = rgeo.attributes.position;
      const uv = [];
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i));
        uv.push((r - inner) / (outer - inner), 0.5);
      }
      rgeo.setAttribute('uv', new Float32BufferAttribute(uv, 2));

      // 环用 Basic 而不是 Standard：环面法线沿自转轴，阳光几乎掠射，
      // 兰伯特模型会把它算得几乎全黑；真实环靠强后向散射亮得接近行星本体。
      // 这里直接按"到太阳距离的平方反比"给亮度，交给自动曝光统一压缩。
      this.ringTint = new Color(def.rings.tint || '#d0c0a0');
      this.rings = new Mesh(rgeo, new MeshBasicMaterial({
        map: pickTexture(assets, def.tex?.ring) || makeRingTexture(def),
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
        toneMapped: true,
      }));
      this.rings.frustumCulled = false;
      this.rings.renderOrder = 2;
      this.rings.quaternion.copy(this.frameQuat); // 环固定在赤道面，不跟着自转
      scene.add(this.rings);
    }
  }

  /**
   * 日面的临边昏暗 + 过曝。
   * 真实太阳的边缘明显比中心暗（视线斜穿光球，看到的是更浅更冷的层），
   * 加上这一层，日面就从"一张贴了图的球"变成"一颗在发光的星"；
   * 再把亮度推过 1.0，最亮的米粒组织直接削到纯白，观感上就"刺眼"了。
   */
  #attachLimbDarkening() {
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          varying vec3 vStarN;
          varying vec3 vStarV;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vStarN = normalize(normalMatrix * normal);
          vStarV = -(modelViewMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vStarN;
          varying vec3 vStarV;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            float mu = clamp(dot(normalize(vStarN), normalize(vStarV)), 0.0, 1.0);
            float limb = ${LIMB_EDGE.toFixed(3)} + ${(1 - LIMB_EDGE).toFixed(3)} * pow(mu, 0.62);
            diffuseColor.rgb *= limb * ${STAR_OVERDRIVE.toFixed(2)};
          }`);
    };
    this.material.customProgramCacheKey = () => 'helios-star-limb';
  }

  /**
   * 夜面城市灯光。three 内置的 emissiveMap 是无条件叠加的（白天也会亮），
   * 所以补一段 shader：按太阳方向和法线的夹角做遮罩，只在背光面加发光。
   */
  #attachNightSide(nightMap) {
    this.sunViewPos = new Vector3(0, 0, 1);
    const extra = {
      uSunViewPos: { value: this.sunViewPos },
      uNightMap: { value: nightMap },
      uNightIntensity: { value: NIGHT_INTENSITY },
    };
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, extra);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uSunViewPos;
          uniform sampler2D uNightMap;
          uniform float uNightIntensity;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            vec3 fragPos = -vViewPosition;                       // 片元的观察空间坐标
            vec3 sunDir = normalize(uSunViewPos - fragPos);
            float ndl = dot(normal, sunDir);
            float nightMask = 1.0 - smoothstep(-0.15, 0.12, ndl); // 只在晨昏线之外亮
            totalEmissiveRadiance += texture2D(uNightMap, vMapUv).rgb * nightMask * uNightIntensity;
          }`);
    };
    // 否则会和别的同参数 MeshStandardMaterial 共用同一份已编译程序
    this.material.customProgramCacheKey = () => 'helios-nightside';
  }

  /** 主循环每帧把太阳在观察空间的位置喂进来（夜面遮罩要用） */
  setSunViewPos(v) {
    this.sunViewPos?.copy(v);
  }

  /**
   * 每帧更新：写入相对相机的位置，并按屏幕尺寸在"球体"和"光点"之间过渡。
   * @param {import('three').Vector3} rel 相对相机的位置（场景单位）
   * @param {number} pxRadius 天体在屏幕上的像素半径
   * @param {number} unitsPerPixel 该距离上 1 像素对应多少场景单位（光点靠它保持恒定屏幕尺寸）
   * @param {boolean} onScreen 是否在相机前方
   */
  update(rel, pxRadius, unitsPerPixel, onScreen) {
    // 自转：赤道系朝向（常量）后面叠一个绕自身极轴的转角
    this.spinQuat.setFromAxisAngle(this.spinAxis, this.body.spin);
    this.mesh.quaternion.copy(this.frameQuat).multiply(this.spinQuat);
    if (this.clouds) {
      // 云层比地表略快一点，制造缓慢的相对漂移
      this.spinQuat.setFromAxisAngle(this.spinAxis, this.body.spin * (1 + CLOUD_DRIFT));
      this.clouds.quaternion.copy(this.frameQuat).multiply(this.spinQuat);
    }

    this.mesh.position.copy(rel);
    if (this.rings) this.rings.position.copy(rel);
    if (this.clouds) this.clouds.position.copy(rel);
    this.dot.position.copy(rel);
    if (this.glare) this.glare.position.copy(rel);

    // 球体：像素半径 < 0.35 就没必要画了
    const meshVisible = onScreen && pxRadius > 0.35;
    this.mesh.visible = meshVisible;
    if (this.clouds) this.clouds.visible = meshVisible && pxRadius > 2;
    if (this.rings) {
      this.rings.visible = meshVisible && pxRadius > 1.5;
      if (this.rings.visible) {
        const au = this.body.sunDistance / AU_KM;
        this.rings.material.color.copy(this.ringTint).multiplyScalar(RING_ALBEDO / (au * au));
      }
    }

    // 光点：视半径越小越显眼
    const a = 1 - smoothstep(DOT_FULL_PX, DOT_TAKEOVER_PX, pxRadius);
    if (this.body.kind === 'star') {
      // 恒星的星芒在远处代表"一颗耀眼的星"；但抵近到 STAR_FLARE_MIN_AU 以内，
      // 日面已经解析得很大，衍射芒反而显得假，这时交给面纱眩光独自表现。
      const near = smoothstep(
        STAR_FLARE_MIN_AU * AU_KM,
        STAR_FLARE_FADE_AU * AU_KM,
        this.body.screen.dist,
      );
      this.dot.material.opacity = (0.55 + 0.45 * a) * near;
      this.dot.visible = onScreen && this.dot.material.opacity > 0.004;
      if (this.dot.visible) {
        const px = Math.min(Math.max(this.dotSizePx, pxRadius * 3.2), STAR_FLARE_MAX_PX);
        const s = px * unitsPerPixel;
        this.dot.scale.set(s, s, 1);
      }
    } else {
      this.dot.visible = onScreen && a > 0.004;
      if (this.dot.visible) {
        this.dot.material.opacity = a * 0.95;
        const s = this.dotSizePx * unitsPerPixel;
        this.dot.scale.set(s, s, 1);
      }
    }

    if (this.halo) {
      // 日面被解析出来之后热晕才有意义，否则观感全交给星芒
      const solar = smoothstep(1.2, 6, pxRadius);
      this.halo.visible = onScreen && solar > 0.01;
      this.halo.material.opacity = 0.85 * solar;

      // 面纱眩光强度直接跟进入镜头的太阳辐照度走（平方反比），
      // 于是地球附近刺眼、木星轨道外基本没有——这正是真实相机的行为。
      // 被行星挡住时立刻消失（日食/凌日）。
      // 但抵近到 GLARE_MIN_AU 以内就撤掉：那个距离上用户多半是在看日面本身，
      // 一层洗白整屏的光雾只会挡路。
      const au = this.body.screen.dist / AU_KM;
      const irr = 1 / Math.max(au * au, 1e-9);
      const inner = smoothstep(GLARE_MIN_AU, GLARE_FADE_AU, au);
      const amount = this.body.screen.occluded ? 0 : Math.min(1, GLARE_GAIN * irr) * inner;
      this.glare.visible = onScreen && amount > 0.004;
      if (this.glare.visible) {
        this.glare.material.opacity = amount;
        const s = GLARE_SPAN_PX * (0.5 + 0.5 * Math.min(1, irr)) * unitsPerPixel;
        this.glare.scale.set(s, s, 1);
      }
    }
  }
}
