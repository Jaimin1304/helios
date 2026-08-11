import {
  Mesh, SphereGeometry, MeshBasicMaterial, BackSide, TextureLoader, SRGBColorSpace, Color,
  RepeatWrapping,
} from 'three';
import { OBLIQUITY, SKYBOX_TEXTURE, SKY_BRIGHTNESS } from '../config.js';

/**
 * 星空天球。做成一个跟随相机的反面球而不是 scene.background，是为了
 *   1) 能自由摆正朝向（贴图是赤道系，场景是黄道系）；
 *   2) toneMapped=false，不受自动曝光影响（曝光会在 0.15~60 之间大幅变化）。
 * 关掉深度测试并最先绘制，所以看不见深度冲突；但顶点仍会被近/远裁面裁掉，
 * 而近裁面在本工程里会随镜头在 1e-7 ~ 1e5 单位之间大幅漂移，
 * 所以几何体半径取 1，由主循环每帧按 camera.near 缩放。
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
  // 球体贴图极点在 +Y，把它转到天球北极方向（黄道系里 = (0, sinε, cosε)）
  mesh.rotation.x = Math.PI / 2 - OBLIQUITY;
  scene.add(mesh);

  new TextureLoader().load(
    SKYBOX_TEXTURE,
    (tex) => {
      tex.colorSpace = SRGBColorSpace;
      // 从球内侧看会左右镜像，翻回来让星图方位正确
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
      console.warn('[helios] 星空贴图加载失败，退回纯黑背景', err);
      mat.color.setScalar(0);
      onLoad?.();
    },
  );

  return mesh;
}
