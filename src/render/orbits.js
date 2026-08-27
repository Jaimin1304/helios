import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineLoop, Color } from 'three';
import { sampleOrbit, eccentricAnomalyAt } from '../sim/kepler.js';
import {
  KM_TO_UNITS, ORBIT_SEGMENTS, ORBIT_FADE_IN_PX, ORBIT_FADE_FULL_PX,
  ORBIT_FADE_OUT_PX, ORBIT_GONE_PX, ORBIT_OPACITY,
} from '../config.js';
import { smoothstep } from './noise.js';

/**
 * Orbit line. The geometry is built with the body's current position as its origin and its
 * sampling phase aligned to the body, so each frame only translates the whole line to the
 * body's camera-relative position. That keeps the line passing exactly through the body and
 * stops float32 jitter at large distances.
 * Once bodies start moving, call rebuild() to resample.
 */
export class OrbitLine {
  constructor(body, scene, timeDays = 0) {
    this.body = body;
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new Float32BufferAttribute(new Float32Array(ORBIT_SEGMENTS * 3), 3),
    );

    this.material = new LineBasicMaterial({
      color: new Color(body.theme),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    this.line = new LineLoop(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.line.renderOrder = 0;
    this.line.visible = false;
    scene.add(this.line);

    this.semiMajorUnits = body.orbit.a * KM_TO_UNITS;
    this.rebuild(timeDays);
  }

  /** Resample for the current instant, with the phase anchored to the body */
  rebuild(timeDays) {
    const E0 = eccentricAnomalyAt(this.body.orbit, timeDays);
    const pts = sampleOrbit(this.body.orbit, ORBIT_SEGMENTS, E0, this.body.local);
    const attr = this.geometry.attributes.position;
    for (let i = 0; i < pts.length; i++) attr.array[i] = pts[i] * KM_TO_UNITS;
    attr.needsUpdate = true;
    this.builtE = E0;
  }

  /**
   * @param {import('three').Vector3} bodyRel body position relative to the camera (scene units)
   * @param {number} pxPerUnit  pixels per scene unit at the primary's distance
   * @param {number} globalOpacity master switch (0 turns orbit lines off)
   */
  update(bodyRel, pxPerUnit, globalOpacity, timeDays) {
    if (globalOpacity <= 0) {
      this.line.visible = false;
      return;
    }
    this.line.position.copy(bodyRel);
    const px = this.semiMajorUnits * pxPerUnit;
    const a = smoothstep(ORBIT_FADE_IN_PX, ORBIT_FADE_FULL_PX, px)
      * (1 - smoothstep(ORBIT_FADE_OUT_PX, ORBIT_GONE_PX, px));
    this.material.opacity = a * ORBIT_OPACITY * globalOpacity;
    this.line.visible = this.material.opacity > 0.004;

    // Once the body has travelled more than half a segment the anchor needs redoing.
    // Only visible orbits are checked, which makes this cheap.
    if (this.line.visible) {
      const E = eccentricAnomalyAt(this.body.orbit, timeDays);
      const drift = Math.atan2(Math.sin(E - this.builtE), Math.cos(E - this.builtE));
      if (Math.abs(drift) > Math.PI / ORBIT_SEGMENTS) this.rebuild(timeDays);
    }
  }
}
