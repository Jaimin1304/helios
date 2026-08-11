import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineLoop, Color } from 'three';
import { sampleOrbit, eccentricAnomalyAt } from '../sim/kepler.js';
import {
  KM_TO_UNITS, ORBIT_SEGMENTS, ORBIT_FADE_IN_PX, ORBIT_FADE_FULL_PX,
  ORBIT_FADE_OUT_PX, ORBIT_GONE_PX, ORBIT_OPACITY,
} from '../config.js';
import { smoothstep } from './noise.js';

/**
 * 轨道线。几何体以**天体当前位置**为原点、并把采样相位对齐到天体，
 * 每帧只把整条线平移到天体的相机相对位置上。
 * 这样轨道线一定精确穿过天体，远处也不会因为 float32 而抖动。
 * （天体运动起来后调 rebuild() 重采样即可。）
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

  /** 按当前时刻重新采样（相位锚定在天体上） */
  rebuild(timeDays) {
    const E0 = eccentricAnomalyAt(this.body.orbit, timeDays);
    const pts = sampleOrbit(this.body.orbit, ORBIT_SEGMENTS, E0, this.body.local);
    const attr = this.geometry.attributes.position;
    for (let i = 0; i < pts.length; i++) attr.array[i] = pts[i] * KM_TO_UNITS;
    attr.needsUpdate = true;
    this.builtE = E0;
  }

  /**
   * @param {import('three').Vector3} bodyRel 天体相对相机的位置（场景单位）
   * @param {number} pxPerUnit  母天体所在距离上 1 场景单位 = 多少像素
   * @param {number} globalOpacity 总开关（0 = 关闭轨道线）
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

    // 天体沿轨道走了超过半段，锚点就该重打了（只对当前可见的轨道做，很便宜）
    if (this.line.visible) {
      const E = eccentricAnomalyAt(this.body.orbit, timeDays);
      const drift = Math.atan2(Math.sin(E - this.builtE), Math.cos(E - this.builtE));
      if (Math.abs(drift) > Math.PI / ORBIT_SEGMENTS) this.rebuild(timeDays);
    }
  }
}
