import {
  Mesh, SphereGeometry, RingGeometry, MeshStandardMaterial, MeshBasicMaterial,
  Sprite, SpriteMaterial, AdditiveBlending, DoubleSide, Color, Matrix4, Vector3,
  Quaternion, Float32BufferAttribute,
} from 'three';
import { AU_KM, KM_TO_UNITS, DOT_SIZE_PX, DOT_TAKEOVER_PX, DOT_FULL_PX } from '../config.js';
import {
  makeRingTexture, getGlowTexture, getStarburstTexture, getGlareTexture,
} from './textures.js';
import { pickTexture } from './assets.js';
import { smoothstep } from './noise.js';
import { BODY_BY_ID } from '../data/bodies.js';
import { SurfaceIllumination } from './illumination.js';

const SUN_RADIUS_KM = BODY_BY_ID.get('sun').radius;

/** Effective ring albedo, an empirical figure that folds in backscatter; combined with the
 *  inverse-square falloff it gives the final brightness */
const RING_ALBEDO = 0.45;
/** Cosine of the viewing angle over which a ring fades as it swings edge-on, about 0.23 degrees.
 *  A zero-thickness disc covers almost no pixels there, so the fade goes unnoticed. */
const RING_EDGE_FADE = 0.004;
/** How steeply transmitted light falls off with ring density on the shaded face. Rings are
 *  translucent, so from the unlit side the thin gaps glow while the dense B ring goes dark. */
const RING_EXTINCTION = 2.4;
/** Multiple scattering and planetshine keep the unlit face visible even in dense ring bands. */
const RING_BACKLIGHT_FLOOR = 0.20;
/** Scratch values for the ring shading maths */
const RING_NORMAL = new Vector3();
const RING_SUN = new Vector3();
const RING_QUAT = new Quaternion();
/** Cloud shell height as a multiple of the surface radius (about 16 km for Earth). */
const CLOUD_SHELL = 1.0025;
/** How much faster the clouds turn than the surface, producing a slow relative drift. */
const CLOUD_DRIFT = 0.02;
/** Solar limb brightness relative to disc centre (0.3 to 0.4 in the visible for the real Sun) */
const LIMB_EDGE = 0.34;
/** Overdrive applied to the solar disc so the brightest granulation clips to white, which is
 *  what sells the glare */
const STAR_OVERDRIVE = 1.55;
/** Screen-size cap for the starburst in pixels, so it cannot smother the view up close */
const STAR_FLARE_MAX_PX = 900;
/** Below this camera distance the starburst is dropped, recovering full strength by FADE (AU) */
const STAR_FLARE_MIN_AU = 2.0;
const STAR_FLARE_FADE_AU = 2.6;
/** Veiling glare: strength at 1 AU, and the screen size it spreads over */
const GLARE_GAIN = 2;
const GLARE_SPAN_PX = 2000;
/** Below this distance the glare is dropped so it cannot block a close look at the disc,
 *  recovering by FADE (AU) */
const GLARE_MIN_AU = 0.03;
const GLARE_FADE_AU = 0.06;

/** Sphere tessellation chosen by body size */
function segmentsFor(body) {
  if (body.kind === 'star') return [128, 64];
  if (body.kind === 'planet') return [96, 48];
  if (body.radius > 800) return [64, 32];
  if (body.radius > 150) return [48, 24];
  return [24, 12];
}

/**
 * Everything drawn for one body: the sphere, a fixed-screen-size dot, and optional rings and
 * clouds. All of it hangs directly off the scene without parent-child nesting, and positions
 * are written each frame by the floating origin.
 */
export class BodyView {
  /** @param {Map<string, import('three').Texture>} assets preloaded surface/effect textures */
  constructor(body, scene, assets = new Map()) {
    this.body = body;
    const def = body.def;
    // The sphere is built at the equatorial radius and squashed by (1-f) along the polar axis,
    // which is exactly the real oblate spheroid
    const radiusUnits = body.equatorialRadius * KM_TO_UNITS;

    const [ws, hs] = segmentsFor(body);
    const geo = new SphereGeometry(radiusUnits, ws, hs);
    // three puts the sphere's pole at +Y while this project spins bodies about +Z, so the
    // geometry is rotated upright. The texture's v axis then runs with latitude and the rings
    // land in the local XY plane.
    geo.rotateX(Math.PI / 2);

    const surfaceMap = pickTexture(assets, def.tex?.map);
    const nightMap = pickTexture(assets, def.tex?.night);
    const cloudMap = pickTexture(assets, def.tex?.clouds, 'linear');
    const ringMap = def.rings
      ? pickTexture(assets, def.tex?.ring) || makeRingTexture(def)
      : null;
    if (body.kind === 'star') {
      this.material = new MeshBasicMaterial({
        map: surfaceMap,
        color: surfaceMap ? 0xffffff : def.palette?.at(-1) ?? '#ffffff',
        toneMapped: false,
      });
      this.#attachLimbDarkening();
    } else {
      this.material = new MeshStandardMaterial({
        map: surfaceMap,
        color: surfaceMap ? 0xffffff : def.palette?.at(-1) ?? '#888888',
        roughness: 0.92,
        metalness: 0.0,
      });
    }

    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false; // positions are written by hand, so three's culling misjudges
    this.mesh.renderOrder = 1;

    // Spin axis orientation. The equatorial rotation is constant and the spin angle is applied
    // after it, about the body's own +Z.
    this.frameQuat = new Quaternion();
    if (body.frame) {
      this.frameQuat.setFromRotationMatrix(new Matrix4().setFromMatrix3(body.frame));
    }
    this.mesh.quaternion.copy(this.frameQuat);
    this.spinQuat = new Quaternion();
    this.spinAxis = new Vector3(0, 0, 1);
    // Flattening: squash along the spin axis
    const axes = def.axes ?? [1, 1, 1];
    const f = def.flattening || 0;
    this.bodyScale = new Vector3(axes[0], axes[1], axes[2] * (1 - f));
    this.mesh.scale.copy(this.bodyScale);

    this.illumination = body.kind === 'star'
      ? null
      : new SurfaceIllumination(this.material, body, { nightMap, ringMap });

    scene.add(this.mesh);

    // Clouds remain an independent transparent surface so they can drift above Earth's map.
    this.clouds = null;
    if (cloudMap) {
      const cloudGeometry = new SphereGeometry(radiusUnits * CLOUD_SHELL, ws, hs);
      cloudGeometry.rotateX(Math.PI / 2);
      this.clouds = new Mesh(cloudGeometry, new MeshStandardMaterial({
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
      this.clouds.scale.copy(this.bodyScale);
      scene.add(this.clouds);
    }

    // ---- Fixed-screen-size dot, which takes over once a body is too small to see ----
    const isStar = body.kind === 'star';
    const tint = new Color(def.palette
      ? def.palette[def.palette.length - 1]
      : '#ffffff');
    // A star's tint is pushed deliberately past 1.0 so the core clips to pure white and the
    // spikes' midtones brighten with it. Without a post-process bloom this is the closest
    // approximation to an overexposed light source.
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

    // ---- Stellar limb halo ----
    // depthTest:true matters here. The sprite quad passes through the star's centre, and what
    // the solar disc occludes is precisely the interior of the circle, so this additive layer
    // only appears beyond the limb. Disc detail stays sharp and a transiting planet is not
    // washed out.
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

      // Veiling glare, the one layer with depthTest:false. It models the haze light scatters
      // inside the lens after entering it, which belongs over the whole image rather than
      // behind the geometry.
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
      this.glare.renderOrder = 50; // drawn last
      scene.add(this.glare);
    }

    // ---- Rings ----
    this.rings = null;
    if (def.rings) {
      const inner = def.rings.innerKm * KM_TO_UNITS;
      const outer = def.rings.outerKm * KM_TO_UNITS;
      const rgeo = new RingGeometry(inner, outer, 256, 1);
      // Custom UVs: u runs along the radius, matching the radial ring strip texture
      const pos = rgeo.attributes.position;
      const uv = [];
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i));
        uv.push((r - inner) / (outer - inner), 0.5);
      }
      rgeo.setAttribute('uv', new Float32BufferAttribute(uv, 2));

      // The rings use Basic rather than Standard. Their normal points along the spin axis and
      // sunlight arrives at a grazing angle, so a Lambertian model renders them nearly black,
      // while real rings are almost as bright as the planet thanks to strong backscatter.
      // Brightness is therefore set straight from the inverse square of the solar distance and
      // left for auto-exposure to compress.
      this.ringTint = new Color(def.rings.tint || '#d0c0a0');
      this.rings = new Mesh(rgeo, new MeshBasicMaterial({
        map: ringMap,
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
        toneMapped: true,
      }));
      this.rings.frustumCulled = false;
      this.rings.renderOrder = 2;
      this.rings.quaternion.copy(this.frameQuat); // rings sit in the equatorial plane and do not spin
      this.#attachRingShading(def);
      scene.add(this.rings);
    }
  }

  /**
   * Ring shading: the planet's own shadow, and transmitted light on the shaded face.
   *
   * Both need the fragment's position within the ring, so the local vertex position travels
   * through as a varying. Ring points lie in the local z = 0 plane with the planet at the
   * origin, which makes the shadow test cheap.
   */
  #attachRingShading(def) {
    this.ringFlatten = 1 - (def.flattening || 0);
    this.ringUniforms = {
      uShadowAxis: { value: new Vector3(0, 0, 1) },
      uLitFacing: { value: 1 },
      uPlanetR: { value: this.body.equatorialRadius * KM_TO_UNITS },
      uPenumbra: { value: 0 },
    };

    this.rings.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.ringUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          varying vec3 vRingLocal;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vRingLocal = position;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uShadowAxis;
          uniform float uLitFacing;
          uniform float uPlanetR;
          uniform float uPenumbra;
          varying vec3 vRingLocal;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            // The planet's shadow. A ring point is eclipsed when it lies behind the planet
            // along the Sun direction and inside its silhouette. Squashing space along the
            // polar axis turns the oblate planet into a sphere; ring points sit at local
            // z = 0 and are untouched by that, so only the shadow axis carries the squash,
            // which the CPU side folds in.
            float t = dot(vRingLocal, uShadowAxis);
            if (t < 0.0) {
              float d = length(vRingLocal - t * uShadowAxis);
              // The Sun is a disc, so the shadow edge softens with distance behind the planet.
              float pen = max(uPenumbra * abs(t), uPlanetR * 0.001);
              diffuseColor.rgb *= smoothstep(uPlanetR - pen, uPlanetR + pen, d);
            }
            // On the shaded face what reaches the eye came through the rings, so the dense
            // regions go dark while the thin ones stay comparatively bright. This is the
            // contrast inversion Cassini photographed from Saturn's unlit side.
            //
            // Which face is visible is decided on the CPU rather than from gl_FrontFacing:
            // RingGeometry reports front-facing when viewed from its local -Z, the opposite of
            // what its +Z normals suggest, and depending on that is an easy way to get the
            // lit and shaded sides backwards.
            if (uLitFacing < 0.0) {
              float tau = texture2D(map, vMapUv).a;
              float transmitted = ${RING_BACKLIGHT_FLOOR.toFixed(2)}
                + ${(1 - RING_BACKLIGHT_FLOOR).toFixed(2)} * exp(-${RING_EXTINCTION.toFixed(2)} * tau);
              diffuseColor.rgb *= transmitted;
            }
          }`);
    };
    // The key has to be per body: Saturn and Uranus both patch a MeshBasicMaterial here, and a
    // shared key makes three hand them one compiled program, after which only one of the two
    // gets its custom uniforms bound and the other renders with whatever was left behind.
    this.rings.material.customProgramCacheKey = () => `helios-rings-${this.body.id}`;
  }

  /**
   * Limb darkening and overdrive on the solar disc.
   * The real Sun is markedly darker at the edge, where the line of sight cuts obliquely through
   * the photosphere and reaches a shallower, cooler layer. Adding that turns the disc from a
   * textured ball into something that reads as a star, and pushing brightness past 1.0 clips the
   * brightest granulation to white, which is what makes it look painful to look at.
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
   * Per-frame update: write the camera-relative position and cross-fade between sphere and dot
   * according to screen size.
   * @param {import('three').Vector3} rel position relative to the camera (scene units)
   * @param {number} pxRadius body radius on screen, in pixels
   * @param {number} unitsPerPixel scene units per pixel at this distance, which is how the dot
   *   holds a constant screen size
   * @param {boolean} onScreen whether the body is in front of the camera
   */
  update(rel, pxRadius, unitsPerPixel, onScreen) {
    // Rotation: the constant equatorial orientation, then a spin angle about the polar axis
    this.spinQuat.setFromAxisAngle(this.spinAxis, this.body.spin);
    this.mesh.quaternion.copy(this.frameQuat).multiply(this.spinQuat);
    if (this.clouds) {
      this.spinQuat.setFromAxisAngle(this.spinAxis, this.body.spin * (1 + CLOUD_DRIFT));
      this.clouds.quaternion.copy(this.frameQuat).multiply(this.spinQuat);
    }

    this.mesh.position.copy(rel);
    if (this.rings) this.rings.position.copy(rel);
    if (this.clouds) this.clouds.position.copy(rel);
    this.dot.position.copy(rel);
    if (this.glare) this.glare.position.copy(rel);

    // Sphere: below a pixel radius of 0.35 there is nothing worth drawing
    const meshVisible = onScreen && pxRadius > 0.35;
    this.mesh.visible = meshVisible;
    if (this.clouds) this.clouds.visible = meshVisible && pxRadius > 2;
    if (this.rings) {
      // Fade out as the rings swing edge-on, where a zero-thickness disc covers no pixels anyway
      RING_NORMAL.set(0, 0, 1).applyQuaternion(this.frameQuat);
      const camSide = RING_NORMAL.dot(rel) / Math.max(rel.length(), 1e-12);
      const sideFade = smoothstep(0, RING_EDGE_FADE, Math.abs(camSide));

      this.rings.visible = meshVisible && pxRadius > 1.5 && sideFade > 0.004;
      if (this.rings.visible) {
        const sunDistKm = this.body.sunDistance;
        const au = sunDistKm / AU_KM;
        this.rings.material.color.copy(this.ringTint).multiplyScalar(RING_ALBEDO / (au * au));
        this.rings.material.opacity = sideFade;

        // Sun direction in the ring's own frame. The Sun sits at the origin of the heliocentric
        // frame, so the direction from the planet towards it is just -position.
        RING_SUN.copy(this.body.position).multiplyScalar(-1).normalize()
          .applyQuaternion(RING_QUAT.copy(this.frameQuat).invert());
        // The camera's own component along the ring normal. rel points from the camera to the
        // body, so its sign is inverted. Matching signs mean the lit face is turned towards us.
        const camAlongNormal = -camSide;
        this.ringUniforms.uLitFacing.value = (camAlongNormal >= 0) === (RING_SUN.z >= 0) ? 1 : -1;
        // Squashed along the polar axis, so the shadow test can treat the planet as a sphere
        this.ringUniforms.uShadowAxis.value
          .set(RING_SUN.x, RING_SUN.y, RING_SUN.z / this.ringFlatten).normalize();
        this.ringUniforms.uPenumbra.value = SUN_RADIUS_KM / Math.max(sunDistKm, 1);
      }
    }

    // Dot: the smaller the apparent radius, the more prominent it becomes
    const a = 1 - smoothstep(DOT_FULL_PX, DOT_TAKEOVER_PX, pxRadius);
    if (this.body.kind === 'star') {
      // At a distance the starburst is what makes a star read as brilliant, but closer than
      // STAR_FLARE_MIN_AU the disc is well resolved and diffraction spikes start to look fake,
      // so the veiling glare carries the impression alone.
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
      // The halo only means anything once the disc is resolved; before that the starburst carries it
      const solar = smoothstep(1.2, 6, pxRadius);
      this.halo.visible = onScreen && solar > 0.01;
      this.halo.material.opacity = 0.85 * solar;

      // Glare strength follows the solar irradiance entering the lens, so it is blinding near
      // Earth and essentially gone beyond Jupiter's orbit, which is how a real camera behaves.
      // Occlusion by a planet kills it instantly, covering eclipses and transits. Closer than
      // GLARE_MIN_AU it is dropped as well: at that range the viewer is almost certainly
      // looking at the disc itself, and a screen-wide wash of haze only gets in the way.
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
