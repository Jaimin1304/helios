import { Quaternion, Vector3 } from 'three';
import { KM_TO_UNITS } from '../config.js';
import { BODY_BY_ID } from '../data/bodies.js';

const MAX_CASTERS = 3;
const SUN_RADIUS_KM = BODY_BY_ID.get('sun').radius;
const SUN_RADIUS_UNITS = SUN_RADIUS_KM * KM_TO_UNITS;
const NIGHT_INTENSITY = 0.45;

const OCCLUSION_GLSL = /* glsl */`
  float heliosDiscVisibility(vec3 fragmentPos, vec3 occluderPos, float occluderRadius) {
    if (occluderRadius <= 0.0) return 1.0;
    vec3 sunVector = uSunViewPos - fragmentPos;
    vec3 occVector = occluderPos - fragmentPos;
    float sunDistance = length(sunVector);
    float occDistance = length(occVector);
    if (occDistance >= sunDistance || occDistance <= occluderRadius) return 1.0;

    float sunRadius = asin(clamp(uSunRadius / sunDistance, 0.0, 0.999));
    float occRadius = asin(clamp(occluderRadius / occDistance, 0.0, 0.999));
    float separation = acos(clamp(dot(sunVector / sunDistance, occVector / occDistance), -1.0, 1.0));
    if (separation >= sunRadius + occRadius) return 1.0;
    if (separation <= abs(sunRadius - occRadius)) {
      float covered = min(sunRadius, occRadius);
      return 1.0 - (covered * covered) / (sunRadius * sunRadius);
    }

    float d2 = separation * separation;
    float sr2 = sunRadius * sunRadius;
    float or2 = occRadius * occRadius;
    float a = acos(clamp((d2 + sr2 - or2) / (2.0 * separation * sunRadius), -1.0, 1.0));
    float b = acos(clamp((d2 + or2 - sr2) / (2.0 * separation * occRadius), -1.0, 1.0));
    float area = sr2 * a + or2 * b - 0.5 * sqrt(max(0.0,
      (-separation + sunRadius + occRadius) *
      ( separation + sunRadius - occRadius) *
      ( separation - sunRadius + occRadius) *
      ( separation + sunRadius + occRadius)));
    return clamp(1.0 - area / (PI * sr2), 0.0, 1.0);
  }
`;

function casterUniformDeclarations() {
  let source = '';
  for (let i = 0; i < MAX_CASTERS; i++) {
    source += `uniform vec3 uOccPos${i};\n`;
    source += `uniform float uOccRadius${i};\n`;
  }
  return source;
}

function eclipseLightingGlsl() {
  let source = 'float heliosSunVisibility = 1.0;\n';
  for (let i = 0; i < MAX_CASTERS; i++) {
    source += `float heliosV${i} = heliosDiscVisibility(geometryPosition, uOccPos${i}, uOccRadius${i});\n`;
    source += `heliosSunVisibility *= heliosV${i};\n`;
  }
  source += `
    float heliosRingLight = 1.0;
    #ifdef HELIOS_RING_SHADOW
      heliosRingLight = heliosRingVisibility(vHeliosLocalPos, uSunLocalDir);
    #endif
    float heliosDirect = heliosSunVisibility * heliosRingLight;
    reflectedLight.directDiffuse *= heliosDirect;
    reflectedLight.directSpecular *= heliosDirect;
  `;
  return source;
}

/**
 * Adds finite-disc eclipses and ring shadows to a standard surface material. One patch owns
 * the material hook so independent effects cannot overwrite each other's onBeforeCompile
 * handlers.
 */
export class SurfaceIllumination {
  constructor(material, body, { nightMap = null, ringMap = null } = {}) {
    this.body = body;
    this.hasNightMap = Boolean(nightMap);
    this.hasRingShadow = Boolean(ringMap && body.def.rings);
    this.uniforms = {
      uSunViewPos: { value: new Vector3(0, 0, 1) },
      uSunRadius: { value: SUN_RADIUS_UNITS },
    };
    for (let i = 0; i < MAX_CASTERS; i++) {
      this.uniforms[`uOccPos${i}`] = { value: new Vector3() };
      this.uniforms[`uOccRadius${i}`] = { value: 0 };
    }
    if (this.hasNightMap) {
      this.uniforms.uNightMap = { value: nightMap };
      this.uniforms.uNightIntensity = { value: NIGHT_INTENSITY };
    }
    if (this.hasRingShadow) {
      this.uniforms.uRingMap = { value: ringMap };
      this.uniforms.uRingInner = { value: body.def.rings.innerKm * KM_TO_UNITS };
      this.uniforms.uRingOuter = { value: body.def.rings.outerKm * KM_TO_UNITS };
      this.uniforms.uSunLocalDir = { value: new Vector3(0, 0, 1) };
      this.uniforms.uPolarScale = { value: 1 - (body.def.flattening || 0) };
    }

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      if (this.hasRingShadow) {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
            uniform float uPolarScale;
            varying vec3 vHeliosLocalPos;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>\n
            vHeliosLocalPos = vec3(transformed.xy, transformed.z * uPolarScale);`);
      }

      let fragmentHeader = `
        uniform vec3 uSunViewPos;
        uniform float uSunRadius;
        ${casterUniformDeclarations()}
        ${OCCLUSION_GLSL}
      `;
      if (this.hasNightMap) {
        fragmentHeader += `
          uniform sampler2D uNightMap;
          uniform float uNightIntensity;
        `;
      }
      if (this.hasRingShadow) {
        fragmentHeader += `
          #define HELIOS_RING_SHADOW
          uniform sampler2D uRingMap;
          uniform float uRingInner;
          uniform float uRingOuter;
          uniform vec3 uSunLocalDir;
          varying vec3 vHeliosLocalPos;

          float heliosRingVisibility(vec3 surfacePoint, vec3 sunDirection) {
            if (abs(sunDirection.z) < 1e-6) return 1.0;
            float t = -surfacePoint.z / sunDirection.z;
            if (t <= 0.0) return 1.0;
            float radiusAtRing = length(surfacePoint.xy + sunDirection.xy * t);
            float width = uRingOuter - uRingInner;
            float edge = max(width * 0.003, 0.001);
            float inside = smoothstep(uRingInner - edge, uRingInner + edge, radiusAtRing)
              * (1.0 - smoothstep(uRingOuter - edge, uRingOuter + edge, radiusAtRing));
            if (inside <= 0.0) return 1.0;
            float u = clamp((radiusAtRing - uRingInner) / width, 0.0, 1.0);
            float opticalDepth = texture2D(uRingMap, vec2(u, 0.5)).a;
            return 1.0 - inside * opticalDepth * 0.94;
          }
        `;
      }
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>\n${fragmentHeader}`,
      );
      if (this.hasNightMap) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            vec3 fragPos = -vViewPosition;
            vec3 sunDir = normalize(uSunViewPos - fragPos);
            float nightMask = 1.0 - smoothstep(-0.15, 0.12, dot(normal, sunDir));
            totalEmissiveRadiance += texture2D(uNightMap, vMapUv).rgb
              * nightMask * uNightIntensity;
          }`,
        );
      }
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>\n${eclipseLightingGlsl()}`,
      );
    };
    material.customProgramCacheKey = () => `helios-surface-${this.hasNightMap ? 1 : 0}-${this.hasRingShadow ? 1 : 0}`;
  }

  setSun(viewPosition, localDirection) {
    this.uniforms.uSunViewPos.value.copy(viewPosition);
    this.uniforms.uSunLocalDir?.value.copy(localDirection);
  }

  clearCasters() {
    for (let i = 0; i < MAX_CASTERS; i++) {
      this.uniforms[`uOccRadius${i}`].value = 0;
    }
  }

  setCaster(index, viewPosition, radiusKm) {
    this.uniforms[`uOccPos${index}`].value.copy(viewPosition);
    this.uniforms[`uOccRadius${index}`].value = radiusKm * KM_TO_UNITS;
  }
}

/**
 * Select only bodies whose shadow cone can touch the target, then update the fixed-size shader
 * caster set. This keeps eclipse work bounded even if the catalogue grows substantially.
 */
export function updateIllumination(bodies, views, camPosKm, viewMatrix, sunViewPos) {
  for (const target of bodies) {
    if (target.kind === 'star') continue;
    const view = views.get(target.id);
    const lighting = view?.illumination;
    if (!lighting) continue;
    if (!view.mesh.visible) continue;

    lighting.clearCasters();
    for (let i = 0; i < MAX_CASTERS; i++) {
      BEST_BODIES[i] = null;
      BEST_SCORES[i] = -Infinity;
    }

    TO_SUN.copy(target.position).negate();
    const sunDistance = TO_SUN.length();
    if (sunDistance <= 1) continue;
    TO_SUN.divideScalar(sunDistance);
    const targetRadius = target.equatorialRadius;

    for (const candidate of bodies) {
      if (candidate === target || candidate.kind === 'star') continue;
      DELTA.subVectors(candidate.position, target.position);
      const along = DELTA.dot(TO_SUN);
      if (along <= 0 || along >= sunDistance) continue;
      const perpendicular = Math.sqrt(Math.max(0, DELTA.lengthSq() - along * along));
      const reach = targetRadius + candidate.equatorialRadius + along * (SUN_RADIUS_KM / sunDistance);
      if (perpendicular > reach) continue;

      const distance = Math.sqrt(perpendicular * perpendicular + along * along);
      const score = candidate.equatorialRadius / Math.max(distance, 1);
      for (let slot = 0; slot < MAX_CASTERS; slot++) {
        if (score <= BEST_SCORES[slot]) continue;
        for (let j = MAX_CASTERS - 1; j > slot; j--) {
          BEST_SCORES[j] = BEST_SCORES[j - 1];
          BEST_BODIES[j] = BEST_BODIES[j - 1];
        }
        BEST_SCORES[slot] = score;
        BEST_BODIES[slot] = candidate;
        break;
      }
    }

    LOCAL_SUN.copy(TO_SUN).applyQuaternion(INVERSE_FRAME.copy(view.frameQuat).invert());
    lighting.setSun(sunViewPos, LOCAL_SUN);
    for (let i = 0; i < MAX_CASTERS; i++) {
      const caster = BEST_BODIES[i];
      if (!caster) break;
      CASTER_VIEW.copy(caster.position).sub(camPosKm).multiplyScalar(KM_TO_UNITS).applyMatrix4(viewMatrix);
      lighting.setCaster(i, CASTER_VIEW, caster.equatorialRadius);
    }
  }
}

const TO_SUN = new Vector3();
const DELTA = new Vector3();
const LOCAL_SUN = new Vector3();
const CASTER_VIEW = new Vector3();
const INVERSE_FRAME = new Quaternion();
const BEST_BODIES = Array(MAX_CASTERS).fill(null);
const BEST_SCORES = new Float64Array(MAX_CASTERS);
