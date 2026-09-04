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
import { updateIllumination } from './render/illumination.js';
import { CameraRig } from './control/cameraRig.js';
import { attachInput } from './control/input.js';
import { Hud } from './ui/hud.js';
import { applyStaticStrings, T } from './i18n.js';

applyStaticStrings(); // place the static copy for the browser language before building the HUD

const canvas = document.getElementById('view');
const hud = new Hud();
const query = new URLSearchParams(location.search);

// ───────────────────────────── Renderer ─────────────────────────────
const renderer = new WebGLRenderer({
  canvas,
  antialias: true,
  logarithmicDepthBuffer: true, // the only workable depth scheme at true scale
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

const scene = new Scene();
const camera = new PerspectiveCamera(FOV, window.innerWidth / window.innerHeight, 1e-4, FAR_UNITS);
camera.up.set(0, 0, 1); // ecliptic north is up
scene.add(camera);

const sky = createSky(scene);

// The Sun is a decay=2 point light, so falloff is physically inverse-square. Intensity is
// scaled so that a unit-albedo surface facing the light at 1 AU has an outgoing radiance of 1.
const sunLight = new PointLight(new Color('#fff6ec'), Math.PI * AU_UNITS * AU_UNITS, 0, 2);
scene.add(sunLight);
const ambient = new AmbientLight(0xffffff, AMBIENT);
scene.add(ambient);

// ───────────────────────────── Scene contents ─────────────────────────────
const system = new SolarSystem();
const requestedDate = query.get('date') ? new Date(query.get('date')) : null;
system.setDate(requestedDate && Number.isFinite(requestedDate.getTime()) ? requestedDate : new Date());

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
let orbitOpacity = 1; // 0 turns orbit lines off
let timeIndex = TIME_SCALE_DEFAULT_INDEX; // T cycles through TIME_SCALES

/** One command path serves keyboard shortcuts and the mobile toolbar, keeping their state equal. */
function toggleFeature(what) {
  if (what === 'orbits') {
    orbitOpacity = orbitOpacity > 0 ? 0 : 1;
    hud.setControlState(what, orbitOpacity > 0);
  } else if (what === 'labels') {
    labels.setEnabled(!labels.enabled);
    hud.setControlState(what, labels.enabled);
  } else if (what === 'lagrange') {
    lagrange.setEnabled(!lagrange.enabled);
    hud.setControlState(what, lagrange.enabled);
  } else if (what === 'grid') {
    const mode = grid.cycle();
    hud.setGrid(mode, grid.unitKm);
    hud.setControlState(what, mode !== 'off');
  } else if (what === 'ui') {
    const visible = hud.toggleUi();
    hud.setControlState(what, visible);
  } else if (what === 'time') {
    timeIndex = (timeIndex + 1) % TIME_SCALES.length;
  }
}

// ───────────────────────── Per-frame scratch values ─────────────────────────
const camPosKm = new Vector3();
const relKm = new Vector3();
const relUnits = new Vector3();
const fwd = new Vector3();
const rightV = new Vector3();
const upV = new Vector3();
const sunViewPos = new Vector3();
const sunRel = new Vector3();
const occluders = [];

let viewW = window.innerWidth;
let viewH = window.innerHeight;
let focalPx = 1;
let logExposure = null; // null means uninitialised: the first frame takes the target directly
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

// ───────────────────────────── Picking ─────────────────────────────
/** Screen picking: try disc hits first, taking the nearest, then label hot zones */
function pick(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;

  // Three tiers: a disc hit (nearest to the camera wins), then the label text box, then the dot
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

/** Project heliocentric ecliptic km to screen pixels, used to place the grid ticks */
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

// ───────────────────────────── Main loop ─────────────────────────────
let lastT = performance.now();
let hudTimer = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;

  // Time flow: real seconds times the current rate gives simulated days, after which every
  // body is repositioned and re-oriented from its Kepler elements
  system.advance((dt * TIME_SCALES[timeIndex]) / 86400);
  rig.update(dt);
  rig.position(camPosKm);
  rig.forward(fwd);
  rig.right(rightV);
  rig.upVector(upV);

  // The camera stays at the scene origin and the world translates around it. This floating
  // origin is what keeps float32 sufficient for rendering.
  camera.position.set(0, 0, 0);
  camera.lookAt(fwd.x, fwd.y, fwd.z);
  camera.updateMatrixWorld();

  let nearestSurface = Infinity;

  for (const body of system.bodies) {
    relKm.subVectors(body.position, camPosKm);
    const dist = relKm.length();

    // Camera basis (right/up/forward), kept in double precision throughout
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

    // Ringed bodies use the outer ring edge as their extent, so flying close to the rings
    // does not let the near plane clip them
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
  // Occlusion: a body hidden behind a planet should neither carry a label nor be clickable.
  // A screen-space test suffices, since the occluder is nearer and the target falls inside its disc.
  occluders.length = 0;
  for (const b of system.bodies) {
    if (b.screen.visible && b.screen.px > 3) occluders.push(b);
  }

  // Analytic finite-disc shadows cover solar/lunar eclipses and rings projected onto their
  // planet. Surface shaders evaluate the shadow separately for every fragment so an umbra can
  // cross the visible disc.
  updateIllumination(system.bodies, views, camPosKm, camera.matrixWorldInverse, sunViewPos);
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

  // Orbit lines: the geometry is anchored to the body, so the whole line translates to the
  // BODY's position, while its apparent size still follows the distance to the primary.
  for (const ol of orbitLines) {
    relUnits.subVectors(ol.body.position, camPosKm).multiplyScalar(KM_TO_UNITS);
    const parentDistUnits = Math.max(ol.body.parent.position.distanceTo(camPosKm) * KM_TO_UNITS, 1e-9);
    ol.update(relUnits, focalPx / parentDistUnits, orbitOpacity, system.timeDays);
  }

  grid.update(sunRel, rig.dist, viewH);
  grid.updateTicks(projectEcliptic, viewW, viewH);
  lagrange.update(camPosKm, projectEcliptic, focalPx, viewW, viewH);
  belts.update(sunRel, rig.dist, camPosKm.length(), focalPx, system.timeDays);

  // The near plane tracks the closest object; the far plane is fixed and covers the whole system
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
  // The sky shell has to sit well inside the near and far planes with margin at both ends
  sky.scale.setScalar(Math.min(camera.near * 100, FAR_UNITS * 0.2));

  // Auto-exposure. The outer system receives six orders of magnitude less light, and camera
  // sensitivity makes up part of that. In free mode the reference floor is 1 AU, which is
  // neutral exposure; focus mode may go down to 0.3 AU.
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
  ambient.intensity = AMBIENT / exposure; // hold ambient visually constant

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

// ───────────────────────────── Startup ─────────────────────────────
const yieldToBrowser = () => new Promise((r) => setTimeout(r, 0));

async function boot() {
  updateViewport();

  // 1) Pull the real textures first; this is the leading 55% of the progress bar
  const assets = await preloadBodyTextures(BODIES, (done, all, url) => {
    hud.progress(0.55 * (done / all), T.loadTextures(url.split('/').pop()));
  });

  // 2) Build the body views from the preloaded surface maps.
  const total = system.bodies.length;
  for (let i = 0; i < total; i++) {
    const body = system.bodies[i];
    const view = new BodyView(body, scene, assets);
    views.set(body.id, view);
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
    onToggle: toggleFeature,
  });
  hud.onControl(toggleFeature);

  hud.progress(1, T.loadReady);
  hud.finishLoading();
  selectBody(system.byId.get('earth'));

  // Deep links: focus a body, set a distance in AU, or choose a reproducible UTC epoch.
  const target = query.get('focus') && system.byId.get(query.get('focus'));
  if (target) {
    selectBody(target);
    rig.flyTo(target, true);
  }
  if (query.has('dist')) rig.setDistance(Number(query.get('dist')) * AU_KM);

  lastT = performance.now();
  requestAnimationFrame(frame);
  window.__ready = true; // lets automated screenshots know the scene is ready
}

boot().catch((error) => {
  console.error('[helios] startup failed', error);
  hud.failLoading(T.loadFailed);
});

// Exposed for tuning and debugging
window.HELIOS = {
  system, rig, views, orbitLines, grid,
  get belts() { return belts; }, get lagrange() { return lagrange; }, renderer, scene, camera, focusBody,
  get selected() { return selected; },
  get timeScale() { return TIME_SCALES[timeIndex]; },
};
