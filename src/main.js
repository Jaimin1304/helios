import {
  WebGLRenderer, Scene, PerspectiveCamera, PointLight, AmbientLight,
  ACESFilmicToneMapping, Vector3, Color,
} from 'three';

import {
  AU_KM, AU_UNITS, DEG, FOV, KM_TO_UNITS, MIN_NEAR_UNITS, MAX_NEAR_UNITS, FAR_UNITS,
  EXPOSURE_EXP, EXPOSURE_MIN, EXPOSURE_MAX, EXPOSURE_REF_MIN_AU, EXPOSURE_REF_MAX_AU,
  AMBIENT, TIME_SCALES, TIME_SCALE_DEFAULT_INDEX,
} from './config.js';
import { SolarSystem } from './sim/system.js';
import { BodyView } from './render/bodyView.js';
import { preloadBodyTextures } from './render/assets.js';
import { BODIES } from './data/bodies.js';
import { OrbitLine } from './render/orbits.js';
import { LabelLayer } from './render/labels.js';
import { EclipticGrid } from './render/grid.js';
import { Belts } from './render/belts.js';
import { LagrangePoints } from './render/lagrange.js';
import { createSky } from './render/sky.js';
import { CameraRig } from './control/cameraRig.js';
import { attachInput } from './control/input.js';
import { Hud } from './ui/hud.js';
import { applyStaticStrings, T } from './i18n.js';

applyStaticStrings(); // 先按浏览器语言把静态文案落位，再建 HUD

const canvas = document.getElementById('view');
const hud = new Hud();

// ───────────────────────────── 渲染器 ─────────────────────────────
const renderer = new WebGLRenderer({
  canvas,
  antialias: true,
  logarithmicDepthBuffer: true, // 真实比例下唯一能用的深度方案
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

const scene = new Scene();
const camera = new PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 1e-4, FAR_UNITS);
camera.up.set(0, 0, 1); // 黄道北极朝上
scene.add(camera);

const sky = createSky(scene);

// 太阳：decay=2 的点光源，物理平方反比。
// 强度定标成"1 AU 处、反照率 1 的表面正对光时出射亮度 = 1"。
const sunLight = new PointLight(new Color('#fff6ec'), Math.PI * AU_UNITS * AU_UNITS, 0, 2);
scene.add(sunLight);
const ambient = new AmbientLight(0xffffff, AMBIENT);
scene.add(ambient);

// ───────────────────────────── 场景内容 ─────────────────────────────
const system = new SolarSystem();
system.setDate(new Date()); // 时间轴暂时冻结在打开页面的时刻

/** @type {Map<string, BodyView>} */
const views = new Map();
/** @type {OrbitLine[]} */
const orbitLines = [];

const rig = new CameraRig();
const grid = new EclipticGrid(scene, document.getElementById('gridticks'));
let labels = null;
let belts = null;
let lagrange = null;

let selected = null;
let orbitOpacity = 1; // 0 = 关闭轨道线
let timeIndex = TIME_SCALE_DEFAULT_INDEX; // T 键在 TIME_SCALES 里循环

// ───────────────────────────── 每帧用的临时量 ─────────────────────────────
const camPosKm = new Vector3();
const relKm = new Vector3();
const relUnits = new Vector3();
const fwd = new Vector3();
const rightV = new Vector3();
const upV = new Vector3();
const sunViewPos = new Vector3();
const sunRel = new Vector3();
/** 需要每帧知道太阳观察空间坐标的视图（地球夜面灯光） */
const sunAwareViews = [];

let viewW = window.innerWidth;
let viewH = window.innerHeight;
let focalPx = 1;
let logExposure = null; // null = 尚未初始化，首帧直接取目标值而不是从 1 慢慢爬
let lastNear = -1;

function updateViewport() {
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  renderer.setSize(viewW, viewH);
  camera.aspect = viewW / viewH;
  focalPx = viewH / 2 / Math.tan((FOV * DEG) / 2);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', updateViewport);

// ───────────────────────────── 拾取 ─────────────────────────────
/** 屏幕拾取：先比圆面命中（取最近的），没有再比标签热区（取离光标最近的） */
function pick(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;

  // 三级优先：① 圆面命中（取离相机最近的）② 标签文字块 ③ 光点热区
  let best = null;
  let bestScore = Infinity;
  for (const b of system.bodies) {
    const s = b.screen;
    if (!s.visible || s.occluded) continue;
    const d = Math.hypot(px - s.x, py - s.y);
    let score;
    if (d <= s.px) score = s.dist;
    else if (d <= Math.max(12, s.px + 8)) score = 2e30 + d;
    else continue;
    if (score < bestScore) {
      bestScore = score;
      best = b;
    }
  }
  if (bestScore > 1e30) {
    const onLabel = labels?.hitTest(px, py);
    if (onLabel) return onLabel;
  }
  return best;
}

/** 把黄道系坐标（km，日心）投到屏幕像素，供坐标系刻度定位 */
const projTmp = new Vector3();
function projectEcliptic(x, y, z) {
  projTmp.set(x, y, z).sub(camPosKm);
  const zc = projTmp.dot(fwd);
  if (zc <= 1e-9) return PROJ_HIDDEN;
  const inv = focalPx / zc;
  return {
    x: viewW / 2 + projTmp.dot(rightV) * inv,
    y: viewH / 2 - projTmp.dot(upV) * inv,
    visible: true,
  };
}
const PROJ_HIDDEN = { x: 0, y: 0, visible: false };

function selectBody(body) {
  selected = body;
  labels?.setSelected(body?.id ?? null);
}

function focusBody(body) {
  if (!body) return;
  selectBody(body);
  rig.flyTo(body);
}

// ───────────────────────────── 主循环 ─────────────────────────────
let lastT = performance.now();
let hudTimer = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;

  // 时间流逝：真实秒 × 当前倍率 → 仿真天，所有天体按开普勒根数重新定位并自转
  system.advance((dt * TIME_SCALES[timeIndex]) / 86400);
  rig.update(dt);
  rig.position(camPosKm);
  rig.forward(fwd);
  rig.right(rightV);
  rig.upVector(upV);

  // 相机永远在场景原点，世界围着它平移（浮动原点），float32 才够用
  camera.position.set(0, 0, 0);
  camera.lookAt(fwd.x, fwd.y, fwd.z);
  camera.updateMatrixWorld();

  let nearestSurface = Infinity;

  for (const body of system.bodies) {
    relKm.subVectors(body.position, camPosKm);
    const dist = relKm.length();

    // 相机坐标系（右/上/前），全程双精度
    const zc = relKm.dot(fwd);
    const s = body.screen;
    s.dist = dist;
    s.px = (body.radius / Math.max(dist, 1e-6)) * focalPx;

    if (zc > 1e-9) {
      s.visible = true;
      const inv = focalPx / zc;
      s.x = viewW / 2 + relKm.dot(rightV) * inv;
      s.y = viewH / 2 - relKm.dot(upV) * inv;
    } else {
      s.visible = false;
      s.x = -1e4;
      s.y = -1e4;
    }

    // 有环的天体按环外缘算"体积"，免得贴着环飞时被近裁面切掉
    const eff = body.def.rings ? body.def.rings.outerKm : body.radius;
    nearestSurface = Math.min(nearestSurface, dist - eff);

    relUnits.copy(relKm).multiplyScalar(KM_TO_UNITS);
    const unitsPerPixel = (dist * KM_TO_UNITS) / focalPx;

    const view = views.get(body.id);
    view.update(relUnits, s.px, unitsPerPixel, s.visible || s.px > viewW);

    if (body.id === 'sun') {
      sunLight.position.copy(relUnits);
      sunRel.copy(relUnits);
      sunViewPos.copy(relUnits).applyMatrix4(camera.matrixWorldInverse);
    }
  }
  for (const v of sunAwareViews) v.setSunViewPos(sunViewPos);

  // 遮挡：被行星挡住的天体不该还飘着标签、也不该被点中。
  // 屏幕空间判据即可——遮挡者更近，且目标落在它的圆面里。
  const occluders = [];
  for (const b of system.bodies) {
    if (b.screen.visible && b.screen.px > 3) occluders.push(b);
  }
  for (const b of system.bodies) {
    const s = b.screen;
    s.occluded = false;
    if (!s.visible) continue;
    for (const o of occluders) {
      const so = o.screen;
      if (o === b || so.dist >= s.dist) continue;
      if (Math.hypot(s.x - so.x, s.y - so.y) < so.px) {
        s.occluded = true;
        break;
      }
    }
  }

  // 轨道线：几何体锚定在天体上，所以整条线平移到**天体**位置；
  // 但视在大小仍由到轨道中心（母天体）的距离决定。
  for (const ol of orbitLines) {
    relUnits.subVectors(ol.body.position, camPosKm).multiplyScalar(KM_TO_UNITS);
    const parentDistUnits = Math.max(ol.body.parent.position.distanceTo(camPosKm) * KM_TO_UNITS, 1e-9);
    ol.update(relUnits, focalPx / parentDistUnits, orbitOpacity, system.timeDays);
  }

  grid.update(sunRel, rig.dist, camPosKm.length(), viewH);
  grid.updateTicks(projectEcliptic, viewW, viewH);
  lagrange.update(camPosKm, projectEcliptic, focalPx, viewW, viewH);
  belts.update(sunRel, rig.dist, camPosKm.length(), focalPx, system.timeDays);

  // 近裁面跟着最近的物体走，远裁面固定覆盖整个已知太阳系
  const nearKm = Number.isFinite(nearestSurface) && nearestSurface > 0
    ? nearestSurface * 0.3
    : 1;
  const near = Math.min(MAX_NEAR_UNITS, Math.max(MIN_NEAR_UNITS, nearKm * KM_TO_UNITS));
  if (lastNear < 0 || near / lastNear > 1.5 || near / lastNear < 0.66) {
    camera.near = near;
    camera.far = FAR_UNITS;
    camera.updateProjectionMatrix();
    lastNear = near;
  }
  // 天球必须稳稳落在近/远裁面之间，两头都留足余量
  sky.scale.setScalar(Math.min(camera.near * 100, FAR_UNITS * 0.2));

  // 自动曝光：外太阳系光照弱 6 个数量级，靠相机"感光度"补偿一部分。
  // 自由模式下的基准下限取 1 AU（中性曝光），聚焦时才允许压到 0.3 AU。
  const refKm = rig.focus ? rig.focus.sunDistance : rig.pivot.length();
  const refFloor = rig.focus ? EXPOSURE_REF_MIN_AU : 1;
  const refAU = Math.min(EXPOSURE_REF_MAX_AU, Math.max(refFloor, refKm / AU_KM));
  const targetExp = Math.min(EXPOSURE_MAX, Math.max(EXPOSURE_MIN, Math.pow(refAU, EXPOSURE_EXP)));
  const targetLog = Math.log(targetExp);
  logExposure = logExposure === null
    ? targetLog
    : logExposure + (targetLog - logExposure) * (1 - Math.exp(-dt * 2.5));
  const exposure = Math.exp(logExposure);
  renderer.toneMappingExposure = exposure;
  ambient.intensity = AMBIENT / exposure; // 环境光保持视觉恒定

  labels.update(viewW, viewH);

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.12;
    hud.setMode(rig.mode, rig.focus ?? rig.flight?.body);
    hud.setBody(selected, selected ? selected.screen.dist : 0);
    hud.setGrid(grid.mode, grid.unitKm);
    hud.setLagrange(lagrange.enabled, lagrange.shownCount);
    hud.setClock(system.date, timeIndex);
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ───────────────────────────── 启动 ─────────────────────────────
const yieldToBrowser = () => new Promise((r) => setTimeout(r, 0));

async function boot() {
  updateViewport();

  // 1) 先把真实纹理拉下来（占进度条前 55%）
  const assets = await preloadBodyTextures(BODIES, (done, all, url) => {
    hud.progress(0.55 * (done / all), T.loadTextures(url.split('/').pop()));
  });

  // 2) 再建天体视图；没有真实纹理的天体在这一步现场生成程序化表面
  const total = system.bodies.length;
  for (let i = 0; i < total; i++) {
    const body = system.bodies[i];
    const view = new BodyView(body, scene, assets);
    views.set(body.id, view);
    if (view.sunViewPos) sunAwareViews.push(view);
    if (body.orbit) orbitLines.push(new OrbitLine(body, scene, system.timeDays));
    hud.progress(0.55 + 0.45 * ((i + 1) / total), T.loadSurface(body.name));
    if (i % 2 === 0) await yieldToBrowser();
  }

  hud.progress(1, T.loadBelts);
  await yieldToBrowser();
  belts = new Belts(scene, renderer.getPixelRatio());
  lagrange = new LagrangePoints(
    scene, document.getElementById('lpoints'), system.bodies, renderer.getPixelRatio(),
  );

  labels = new LabelLayer(document.getElementById('labels'), system.bodies);

  attachInput(canvas, rig, {
    pick,
    onSelect: (body) => selectBody(body),
    onFocus: (body) => focusBody(body),
    onHover: (x, y) => {
      const b = pick(x, y);
      labels.setHovered(b?.id ?? null);
      canvas.style.cursor = b ? 'pointer' : 'default';
    },
    onRelease: () => rig.release(),
    onFocusSelected: () => {
      if (selected) focusBody(selected);
    },
    onToggle: (what) => {
      if (what === 'orbits') {
        orbitOpacity = orbitOpacity > 0 ? 0 : 1;
      } else if (what === 'labels') {
        labels.setEnabled(!labels.enabled);
      } else if (what === 'lagrange') {
        lagrange.setEnabled(!lagrange.enabled);
      } else if (what === 'grid') {
        hud.setGrid(grid.cycle(), grid.unitKm);
      } else if (what === 'ui') {
        hud.toggleUi();
      } else if (what === 'time') {
        timeIndex = (timeIndex + 1) % TIME_SCALES.length;
      }
    },
  });

  hud.progress(1, T.loadReady);
  hud.finishLoading();
  selectBody(system.byId.get('earth'));

  // 直达视角：?focus=saturn 直接聚焦，?dist=45 设定初始距离(AU)
  const q = new URLSearchParams(location.search);
  const target = q.get('focus') && system.byId.get(q.get('focus'));
  if (target) {
    selectBody(target);
    rig.flyTo(target, true);
  }
  if (q.has('dist')) rig.dist = parseFloat(q.get('dist')) * AU_KM;

  lastT = performance.now();
  requestAnimationFrame(frame);
  window.__ready = true; // 供自动化截图判断"已就绪"
}

boot();

// 调参用
window.HELIOS = {
  system, rig, views, orbitLines, grid,
  get belts() { return belts; }, get lagrange() { return lagrange; }, renderer, scene, camera, focusBody,
  get selected() { return selected; },
  get timeScale() { return TIME_SCALES[timeIndex]; },
};
