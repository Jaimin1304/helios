import {
  Mesh, SphereGeometry, MeshBasicMaterial, BackSide, TextureLoader, SRGBColorSpace, Color,
  RepeatWrapping,
} from 'three';
import { OBLIQUITY, SKYBOX_TEXTURE, SKY_BRIGHTNESS } from '../config.js';
import { resolveTextureUrl } from './assets.js';

/**
 * Starfield celestial sphere, drawn as a camera-following back-face sphere rather than a
 * scene.background for two reasons. The orientation has to be adjustable, since the texture
 * is in equatorial coordinates while the scene is ecliptic, and toneMapped=false keeps it
 * clear of the auto-exposure range, which swings between 0.15 and 60.
 * Depth testing is off and it draws first, so z-fighting never appears. Vertices are still
 * clipped by the near and far planes, and the near plane here drifts between 1e-7 and 1e5
 * units, so the geometry has radius 1 and the main loop rescales it by camera.near.
 */
export function createSky(scene, onLoad) {
  const geo = new SphereGeometry(1, 64, 32);
  const mat = new MeshBasicMaterial({
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    color: new Color().setScalar(SKY_BRIGHTNESS),
    fog: false,
  });

  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  // The sphere texture's pole sits at +Y; rotate it to the celestial north pole,
  // which in ecliptic coordinates is (0, sin e, cos e).
  mesh.rotation.x = Math.PI / 2 - OBLIQUITY;
  scene.add(mesh);

  // The sky bypasses the downsampling in assets.js but still needs the build-time texture map
  new TextureLoader().load(
    resolveTextureUrl(SKYBOX_TEXTURE),
    (tex) => {
      tex.colorSpace = SRGBColorSpace;
      // Seen from inside the sphere the map is mirrored; flip it back so the sky reads correctly
      tex.wrapS = RepeatWrapping;
      tex.repeat.x = -1;
      tex.offset.x = 1;
      tex.anisotropy = 8;
      mat.map = tex;
      mat.needsUpdate = true;
      onLoad?.();
    },
    undefined,
    (err) => {
      console.warn('[helios] failed to load the sky texture, falling back to plain black', err);
      mat.color.setScalar(0);
      onLoad?.();
    },
  );

  return mesh;
}
