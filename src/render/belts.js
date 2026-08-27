import {
  BufferGeometry, BufferAttribute, Points, ShaderMaterial, AdditiveBlending, Color, Vector3,
} from 'three';
import { AU_KM, DEG, KM_TO_UNITS } from '../config.js';
import { rng, seedOf, smoothstep } from './noise.js';

/**
 * Asteroid belt and Kuiper belt.
 *
 * Every particle carries its own set of real orbital elements and SOLVES KEPLER'S EQUATION IN
 * THE VERTEX SHADER, so these genuinely orbit the Sun. Periods differ from particle to particle,
 * which produces differential rotation on its own rather than the uniform spin of a textured
 * ring. The whole thing costs two draw calls.
 *
 * A real asteroid is far below one pixel at any viewing distance, so each is drawn as a dot of
 * exactly one device pixel with size attenuation off. That is both the cheapest option and the
 * physically honest one.
 *
 * These are not interactive: they are not Body instances, take no part in picking, and carry
 * no labels.
 */

/**
 * Point size has to be a WHOLE NUMBER of device pixels.
 *
 * GL rasterises a point as a square of side gl_PointSize centred on the point, generating a
 * fragment for every pixel whose CENTRE the square covers. At a side of 1.6 that square covers
 * one, two or four pixel centres depending on where the sub-pixel position happens to fall, so
 * a single asteroid's brightness jumps by up to 4x as it moves. That is aliasing rather than
 * twinkling. A whole-number side always covers n^2 pixels and stays steady, and 1 is both the
 * theoretical minimum and the closest match to a real point source.
 *
 * The reason it is not hard-coded to 1.0 is that gl_PointSize counts DEVICE pixels: on a 2x
 * display one device pixel is half a CSS pixel and the whole belt visibly thins out. Using
 * round(dpr) keeps the value whole while matching the look across pixel densities.
 */
const pointSize = (dpr) => Math.max(1, Math.round(dpr));
/** At this on-screen belt radius opacity is full; below it, brightness scales by area ratio */
const REF_SPAN_PX = 420;

/** Kirkwood gaps, swept clear by mean-motion resonances with Jupiter: [centre AU, width, depth] */
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
    color: '#cfc3ad', // asteroids are mostly carbonaceous or silicate, so a warm grey
    brightness: 1.05, // compensates for the coverage lost moving from 1.6 px to 1 px
    aRange: [2.00, 3.35],
    meanAU: 2.75,
    /** Radial number density of the main belt including gaps, used for rejection sampling */
    density(a) {
      let d = smoothstep(2.05, 2.35, a) * (1 - smoothstep(3.05, 3.30, a));
      d *= 0.55 + 0.45 * Math.exp(-((a - 2.85) ** 2) / 0.24);
      for (const [c, w, depth] of KIRKWOOD) {
        d *= 1 - depth * Math.exp(-((a - c) ** 2) / (2 * w * w));
      }
      return d;
    },
    /** Eccentricity and inclination; the main belt averages e around 0.14 and i around 10 degrees */
    shape(rand) {
      return {
        e: Math.min(0.34, 0.02 + Math.sqrt(-2 * Math.log(1 - rand() * 0.999)) * 0.085),
        inc: Math.min(32, Math.sqrt(-2 * Math.log(1 - rand() * 0.999)) * 7.2) * DEG,
      };
    },
  },
  kuiper: {
    count: 45000,
    color: '#c9a89a', // KBO surfaces run red
    brightness: 1.25,
    meanAU: 43,
    /** The Kuiper belt is far from a uniform ring, so it is sampled as a mix of three real populations */
    sample(rand) {
      const r = rand();
      if (r < 0.25) {
        // Plutinos: in 3:2 resonance with Neptune, clustered at 39.4 AU with higher e and i
        return {
          a: 39.45 + (rand() - 0.5) * 0.7,
          e: 0.10 + rand() * 0.22,
          inc: Math.min(24, Math.sqrt(-2 * Math.log(1 - rand() * 0.999)) * 8.5) * DEG,
        };
      }
      if (r < 0.85) {
        // Cold classical belt: 42 to 47.5 AU, near-circular and nearly coplanar, ending at the Kuiper cliff
        return {
          a: 42.0 + rand() * 5.5,
          e: rand() * 0.09,
          inc: Math.sqrt(-2 * Math.log(1 - rand() * 0.999)) * 2.2 * DEG,
        };
      }
      // Hot classical belt: wider spread and higher inclinations
      return {
        a: 40.0 + rand() * 8.0,
        e: 0.04 + rand() * 0.20,
        inc: Math.min(34, 4 + Math.sqrt(-2 * Math.log(1 - rand() * 0.999)) * 11) * DEG,
      };
    },
  },
};

const VERT = /* glsl */`
  attribute vec3 aP;      // basis vector towards perihelion
  attribute vec3 aQ;      // orthogonal basis vector in the orbital plane
  attribute vec2 aPhase;  // x = mean anomaly at epoch, y = brightness
  uniform float uTime;    // days since J2000
  uniform float uSize;    // point size, in whole device pixels
  varying float vShade;

  #include <common>
  #include <logdepthbuf_pars_vertex>

  void main() {
    // position is repurposed to carry orbital quantities:
    // x = semi-major axis (scene units), y = eccentricity, z = mean motion (rad/day)
    float a = position.x;
    float e = position.y;
    float M = aPhase.x + position.z * uTime;

    // Solve Kepler's equation M = E - e*sinE. With e < 0.35, three Newton steps converge to
    // well under a pixel.
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

  // Density ceiling for rejection sampling
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
    // Mean motion in Gaussian gravitational constant form, n = k * a^-1.5 (rad/day, a in AU)
    orbit[i * 3 + 2] = 0.01720209895 / (aAU * Math.sqrt(aAU));

    phase[i * 2] = rand() * Math.PI * 2;
    // A power-law brightness distribution keeps most particles faint and a few bright, which is
    // what gives the belt grain instead of an even smear
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
      depthTest: true, // planets have to be able to hide them
      toneMapped: false,
    });
    this.points = new Points(buildGeometry(spec, seed), this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -2; // drawn before the orbit lines
    scene.add(this.points);
  }

  /**
   * @param {Vector3} sunRel Sun position relative to the camera (scene units)
   * @param {number} viewScaleKm current view scale, the camera-to-pivot distance in km
   * @param {number} sunDistKm camera-to-Sun distance in km
   * @param {number} focalPx focal length in pixels
   * @param {number} timeDays simulation instant
   */
  update(sunRel, viewScaleKm, sunDistKm, focalPx, timeDays) {
    this.points.position.copy(sunRel);
    this.material.uniforms.uTime.value = timeDays;

    const meanKm = this.spec.meanAU * AU_KM;
    // 1) Fade out once the view scale drops far below the belt itself. Standing beside a planet,
    //    real asteroids would be invisible, and a screenful of scattered dots is just noise.
    const near = smoothstep(0.02 * meanKm, 0.15 * meanKm, viewScaleKm);
    // 2) Normalise by screen area. The dots hold a constant pixel size, so as the belt shrinks the
    //    total flux stays put while brightness per unit area rises as 1/area, and additive blending
    //    turns it into an overexposed blob. Multiplying by the area ratio restores the faint ring
    //    it should read as from far away.
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
