import { AU_KM } from '../config.js';

/**
 * 天体表。半径为平均半径(km)，轨道根数历元 J2000.0。
 *
 * 行星根数用 Standish (JPL, 1800-2050 近似) 的 a/e/i/L/ϖ/Ω 形式，
 * 这里换算成 (Ω, ω=ϖ-Ω, M0=L-ϖ)。
 * 矮行星/小行星用其平均根数；卫星用相对母天体**赤道系**（Laplace 面的近似）
 * 的平均根数——真实卫星轨道有较强摄动，这里取长期平均值，视觉上足够。
 * 卫星的 M0（历元时刻的相位）多为估计值，只影响初始时刻各卫星站在轨道哪一侧。
 *
 * kind: star | planet | dwarf | moon | minor
 * style/palette 供程序化贴图生成器使用（后续会被真实纹理替换）。
 */

/** 行星：Standish 形式 → 内部形式 */
function pl(aAU, e, i, L, varpi, node, period) {
  return { a: aAU * AU_KM, e, i, node, peri: varpi - node, M0: L - varpi, period };
}
/** 通用：a 以 AU 计（小天体） */
function au(a, e, i, node, peri, M0, period) {
  return { a: a * AU_KM, e, i, node, peri, M0, period };
}
/** 卫星：a 以 km 计 */
function km(a, e, i, node, peri, M0, period) {
  return { a, e, i, node, peri, M0, period };
}

export const BODIES = [
  // ────────────────────────────── 恒星 ──────────────────────────────
  {
    id: 'sun', name: '太阳', en: 'Sun', kind: 'star', radius: 695700,
    pole: [286.13, 63.87], rotHours: 609.12, flattening: 0,
    style: 'star', palette: ['#7a1500', '#ff6a10', '#ffb648', '#fff6d8'],
    tex: { map: './solar_textures/8k_sun.jpg' },
  },

  // ────────────────────────────── 行星 ──────────────────────────────
  {
    id: 'mercury', name: '水星', en: 'Mercury', parent: 'sun', kind: 'planet', radius: 2439.7,
    pole: [281.0103, 61.4155], rotHours: 1407.6, flattening: 0,
    style: 'cratered', palette: ['#3b3531', '#6b6158', '#8f857a', '#b0a698'],
    tex: { map: './solar_textures/8k_mercury.jpg' },
    orbit: pl(0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593, 87.9691),
  },
  {
    id: 'venus', name: '金星', en: 'Venus', parent: 'sun', kind: 'planet', radius: 6051.8,
    pole: [272.76, 67.16], rotHours: -5832.6, flattening: 0,
    style: 'cloudy', palette: ['#8a6626', '#c69a4a', '#e6cf90', '#fff2cc'],
    tex: { map: './solar_textures/4k_venus_atmosphere.jpg' },
    orbit: pl(0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255, 224.701),
  },
  {
    id: 'earth', name: '地球', en: 'Earth', parent: 'sun', kind: 'planet', radius: 6371.0,
    pole: [0.0, 90.0], rotHours: 23.9345, flattening: 0.00335,
    style: 'terrestrial', palette: ['#071d3d', '#0e3c66', '#2f6b34', '#7d6f43'],
    tex: {
      map: './solar_textures/8k_earth_daymap.jpg',
      night: './solar_textures/8k_earth_nightmap.jpg',
      clouds: './solar_textures/8k_earth_clouds.jpg',
    },
    orbit: pl(1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0, 365.256363),
  },
  {
    id: 'mars', name: '火星', en: 'Mars', parent: 'sun', kind: 'planet', radius: 3389.5,
    pole: [317.681, 52.887], rotHours: 24.6229, flattening: 0.00589,
    style: 'desert', palette: ['#4d2312', '#8a4122', '#b56a3a', '#d99f6c'],
    tex: { map: './solar_textures/8k_mars.jpg' },
    orbit: pl(1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 686.980),
  },
  {
    id: 'jupiter', name: '木星', en: 'Jupiter', parent: 'sun', kind: 'planet', radius: 69911,
    pole: [268.057, 64.495], rotHours: 9.9250, flattening: 0.06487,
    style: 'banded', bands: 11, spot: { lat: -21, lon: 65, size: 0.14, color: '#c0603a' },
    palette: ['#6b4630', '#c9a179', '#efe0c8', '#9a6a48'],
    tex: { map: './solar_textures/8k_jupiter.jpg' },
    orbit: pl(5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, 4332.589),
  },
  {
    id: 'saturn', name: '土星', en: 'Saturn', parent: 'sun', kind: 'planet', radius: 58232,
    pole: [40.589, 83.537], rotHours: 10.656, flattening: 0.09796,
    style: 'banded', bands: 8,
    palette: ['#8a7345', '#d5bd8a', '#f2e6c6', '#b59a63'],
    tex: { map: './solar_textures/8k_saturn.jpg', ring: './solar_textures/8k_saturn_ring_alpha.png' },
    // 环带半径按环贴图的 alpha 剖面标定：卡西尼缝落在条带 x≈0.70 处，
    // 对应真实的 119,875 km，反推出条带两端 = 62,829 / 144,251 km。
    rings: { innerKm: 62829, outerKm: 144251, tint: '#d8c9a5' },
    orbit: pl(9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, 10759.22),
  },
  {
    id: 'uranus', name: '天王星', en: 'Uranus', parent: 'sun', kind: 'planet', radius: 25362,
    pole: [257.311, -15.175], rotHours: -17.24, flattening: 0.02293,
    style: 'banded', bands: 3,
    palette: ['#2b6f78', '#69b4bf', '#a9dbe2', '#4d8f98'],
    tex: { map: './solar_textures/2k_uranus.jpg' },
    rings: { innerKm: 41800, outerKm: 51500, tint: '#6a6a72', opacity: 0.35 },
    orbit: pl(19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503, 30685.4),
  },
  {
    id: 'neptune', name: '海王星', en: 'Neptune', parent: 'sun', kind: 'planet', radius: 24622,
    pole: [299.36, 43.46], rotHours: 16.11, flattening: 0.01708,
    style: 'banded', bands: 4,
    palette: ['#16306f', '#2d5cc4', '#6a9bea', '#1d3f8f'],
    tex: { map: './solar_textures/2k_neptune.jpg' },
    orbit: pl(30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574, 60189.0),
  },

  // ────────────────────────────── 地球系统 ──────────────────────────────
  {
    id: 'moon', name: '月球', en: 'Moon', parent: 'earth', kind: 'moon', radius: 1737.4,
    // 月球自转轴几乎垂直于黄道面（对黄极仅 1.54°），不能沿用地球赤道系
    pole: [270.0, 66.54],
    rotHours: 655.728, style: 'cratered', craters: 198,
    tex: { map: './solar_textures/8k_moon.jpg' },
    palette: ['#2e2e30', '#5f5f62', '#8b8b8e', '#b9b9bc'],
    // 月球轨道倾角是相对**黄道**约 5.145°，不走地球赤道系
    orbit: { ...km(384400, 0.0549, 5.145, 125.08, 318.15, 135.27, 27.321582), frame: 'ecliptic' },
  },

  // ────────────────────────────── 火卫 ──────────────────────────────
  {
    id: 'phobos', name: '火卫一', en: 'Phobos', parent: 'mars', kind: 'moon', radius: 11.267,
    style: 'cratered', craters: 88, palette: ['#2a2320', '#4d443c', '#6d6357', '#8a8073'],
    orbit: km(9376, 0.0151, 1.093, 0, 150.2, 92.5, 0.318910),
  },
  {
    id: 'deimos', name: '火卫二', en: 'Deimos', parent: 'mars', kind: 'moon', radius: 6.2,
    style: 'cratered', craters: 62, palette: ['#2e2722', '#544a40', '#75695b', '#948877'],
    orbit: km(23463.2, 0.00033, 0.93, 0, 260.7, 311.0, 1.263),
  },

  // ────────────────────────────── 木卫 ──────────────────────────────
  {
    id: 'io', name: '木卫一 · 伊奥', en: 'Io', parent: 'jupiter', kind: 'moon', radius: 1821.6,
    style: 'volcanic', palette: ['#8f6a12', '#d8b32c', '#f2e08a', '#a33418'],
    orbit: km(421800, 0.0041, 0.036, 0, 84.1, 342.0, 1.769138),
  },
  {
    id: 'europa', name: '木卫二 · 欧罗巴', en: 'Europa', parent: 'jupiter', kind: 'moon', radius: 1560.8,
    style: 'icy', cracks: 120, palette: ['#7d6b53', '#cbbca4', '#efe8dc', '#8a5f43'],
    orbit: km(671100, 0.0094, 0.466, 0, 88.9, 171.0, 3.551181),
  },
  {
    id: 'ganymede', name: '木卫三 · 盖尼米德', en: 'Ganymede', parent: 'jupiter', kind: 'moon', radius: 2634.1,
    style: 'cratered', craters: 154, palette: ['#3f3830', '#7b7264', '#a89e8e', '#c7bdad'],
    orbit: km(1070400, 0.0013, 0.177, 0, 192.4, 317.5, 7.154553),
  },
  {
    id: 'callisto', name: '木卫四 · 卡利斯托', en: 'Callisto', parent: 'jupiter', kind: 'moon', radius: 2410.3,
    style: 'cratered', craters: 286, palette: ['#241f1b', '#4e463e', '#786d5f', '#968a79'],
    orbit: km(1882700, 0.0074, 0.192, 0, 52.6, 181.4, 16.689018),
  },
  {
    id: 'amalthea', name: '木卫五 · 阿马尔忒亚', en: 'Amalthea', parent: 'jupiter', kind: 'moon', radius: 83.5,
    style: 'cratered', craters: 53, palette: ['#3c1a12', '#6e2f1e', '#8f4a30', '#a86546'],
    orbit: km(181365, 0.0032, 0.374, 0, 155.9, 44.0, 0.498179),
  },
  {
    id: 'himalia', name: '木卫六 · 希玛利亚', en: 'Himalia', parent: 'jupiter', kind: 'moon', radius: 69.8,
    style: 'cratered', craters: 44, palette: ['#221e1a', '#453e35', '#665c4f', '#847968'],
    orbit: km(11460000, 0.1623, 27.5, 57.2, 331.6, 66.0, 250.56),
  },

  // ────────────────────────────── 土卫 ──────────────────────────────
  {
    id: 'mimas', name: '土卫一 · 弥玛斯', en: 'Mimas', parent: 'saturn', kind: 'moon', radius: 198.2,
    style: 'cratered', craters: 121, palette: ['#5e5e62', '#97979c', '#c2c2c7', '#e2e2e6'],
    orbit: km(185539, 0.0196, 1.574, 0, 14.4, 255.3, 0.942422),
  },
  {
    id: 'enceladus', name: '土卫二 · 恩克拉多斯', en: 'Enceladus', parent: 'saturn', kind: 'moon', radius: 252.1,
    style: 'icy', cracks: 60, palette: ['#8fa0ab', '#cfdde6', '#f2f8fb', '#a9bcc7'],
    orbit: km(237948, 0.0047, 0.009, 0, 211.9, 18.6, 1.370218),
  },
  {
    id: 'tethys', name: '土卫三 · 忒堤斯', en: 'Tethys', parent: 'saturn', kind: 'moon', radius: 531.1,
    style: 'cratered', craters: 132, palette: ['#67676c', '#a0a0a6', '#c9c9cf', '#e6e6ea'],
    orbit: km(294619, 0.0001, 1.091, 0, 262.8, 137.4, 1.887802),
  },
  {
    id: 'dione', name: '土卫四 · 狄俄涅', en: 'Dione', parent: 'saturn', kind: 'moon', radius: 561.4,
    style: 'cratered', craters: 110, palette: ['#5c5c60', '#96969b', '#c0c0c6', '#dedee2'],
    orbit: km(377396, 0.0022, 0.028, 0, 168.8, 289.0, 2.736915),
  },
  {
    id: 'rhea', name: '土卫五 · 瑞亚', en: 'Rhea', parent: 'saturn', kind: 'moon', radius: 763.8,
    style: 'cratered', craters: 165, palette: ['#57575b', '#909095', '#bcbcc2', '#dbdbdf'],
    orbit: km(527108, 0.0013, 0.331, 0, 256.4, 44.7, 4.518212),
  },
  {
    id: 'titan', name: '土卫六 · 泰坦', en: 'Titan', parent: 'saturn', kind: 'moon', radius: 2574.7,
    style: 'cloudy', palette: ['#7a4a10', '#c08a28', '#e3bb62', '#f4dda0'],
    orbit: km(1221870, 0.0288, 0.348, 0, 185.7, 210.3, 15.945421),
  },
  {
    id: 'hyperion', name: '土卫七 · 许珀里翁', en: 'Hyperion', parent: 'saturn', kind: 'moon', radius: 135,
    style: 'cratered', craters: 132, palette: ['#3a2f24', '#6b5a45', '#8f7c63', '#b09b80'],
    orbit: km(1481009, 0.1230, 0.568, 0, 324.0, 100.2, 21.276),
  },
  {
    id: 'iapetus', name: '土卫八 · 伊阿珀托斯', en: 'Iapetus', parent: 'saturn', kind: 'moon', radius: 734.5,
    style: 'cratered', craters: 143, palette: ['#241d16', '#584c3c', '#a09484', '#d6cfc2'],
    orbit: km(3560820, 0.0286, 15.47, 0, 275.9, 12.0, 79.3215),
  },
  {
    id: 'phoebe', name: '土卫九 · 菲比', en: 'Phoebe', parent: 'saturn', kind: 'moon', radius: 106.5,
    style: 'cratered', craters: 99, palette: ['#1c1a18', '#3a352f', '#585045', '#736958'],
    orbit: km(12947780, 0.1635, 175.3, 0, 342.0, 200.0, 550.31),
  },

  // ────────────────────────────── 天卫 ──────────────────────────────
  {
    id: 'miranda', name: '天卫五 · 米兰达', en: 'Miranda', parent: 'uranus', kind: 'moon', radius: 235.8,
    style: 'cratered', craters: 88, palette: ['#4a4a4e', '#7d7d82', '#a5a5ab', '#c6c6cb'],
    orbit: km(129390, 0.0013, 4.232, 0, 68.3, 311.3, 1.413479),
  },
  {
    id: 'ariel', name: '天卫一 · 艾瑞尔', en: 'Ariel', parent: 'uranus', kind: 'moon', radius: 578.9,
    style: 'icy', cracks: 40, palette: ['#5c5c62', '#96969e', '#c4c4cb', '#e2e2e8'],
    orbit: km(190900, 0.0012, 0.260, 0, 115.3, 39.5, 2.520379),
  },
  {
    id: 'umbriel', name: '天卫二 · 乌姆柏里厄尔', en: 'Umbriel', parent: 'uranus', kind: 'moon', radius: 584.7,
    style: 'cratered', craters: 121, palette: ['#2b2b2e', '#4f4f54', '#6e6e74', '#8c8c92'],
    orbit: km(266000, 0.0039, 0.128, 0, 84.7, 12.5, 4.144177),
  },
  {
    id: 'titania', name: '天卫三 · 泰坦妮亚', en: 'Titania', parent: 'uranus', kind: 'moon', radius: 788.4,
    style: 'cratered', craters: 99, palette: ['#453c36', '#786b60', '#9d9084', '#bdb1a4'],
    orbit: km(436300, 0.0011, 0.340, 0, 284.4, 96.7, 8.705872),
  },
  {
    id: 'oberon', name: '天卫四 · 奥伯龙', en: 'Oberon', parent: 'uranus', kind: 'moon', radius: 761.4,
    style: 'cratered', craters: 110, palette: ['#3d3630', '#6d6157', '#918578', '#b0a596'],
    orbit: km(583500, 0.0014, 0.058, 0, 104.4, 279.8, 13.463239),
  },

  // ────────────────────────────── 海卫 ──────────────────────────────
  {
    id: 'triton', name: '海卫一 · 特里同', en: 'Triton', parent: 'neptune', kind: 'moon', radius: 1353.4,
    style: 'icy', cracks: 70, palette: ['#7d7480', '#c0b6c2', '#e9e1ea', '#a08f9c'],
    // 逆行：倾角 >90° 已表达逆行，周期取正
    orbit: km(354759, 0.000016, 156.885, 0, 344.0, 77.0, 5.876854),
  },
  {
    id: 'proteus', name: '海卫八 · 普罗透斯', en: 'Proteus', parent: 'neptune', kind: 'moon', radius: 210,
    style: 'cratered', craters: 77, palette: ['#232326', '#43434a', '#5f5f68', '#7b7b85'],
    orbit: km(117647, 0.00053, 0.524, 0, 60.0, 210.0, 1.122315),
  },
  {
    id: 'nereid', name: '海卫二 · 涅瑞伊得', en: 'Nereid', parent: 'neptune', kind: 'moon', radius: 170,
    style: 'cratered', craters: 66, palette: ['#2b2b30', '#4f4f57', '#70707a', '#8f8f9a'],
    orbit: km(5513818, 0.7507, 7.232, 0, 296.3, 45.0, 360.13619),
  },

  // ────────────────────────── 矮行星 / 小天体 ──────────────────────────
  {
    id: 'ceres', name: '谷神星', en: 'Ceres', parent: 'sun', kind: 'dwarf', radius: 469.7,
    rotHours: 9.074, style: 'cratered', craters: 132,
    palette: ['#33302b', '#5e5850', '#837b70', '#a49b8d'],
    orbit: au(2.7675, 0.07582, 10.593, 80.393, 73.597, 95.989, 1681.63),
  },
  {
    id: 'vesta', name: '灶神星', en: 'Vesta', parent: 'sun', kind: 'minor', radius: 262.7,
    rotHours: 5.342, style: 'cratered', craters: 110,
    palette: ['#443b30', '#7a6c58', '#a2937c', '#c2b49b'],
    orbit: au(2.3617, 0.08857, 7.1417, 103.851, 151.198, 307.8, 1325.75),
  },
  {
    id: 'pallas', name: '智神星', en: 'Pallas', parent: 'sun', kind: 'minor', radius: 256,
    rotHours: 7.813, style: 'cratered', craters: 99,
    palette: ['#2f302c', '#565a52', '#767b70', '#969b8e'],
    orbit: au(2.7720, 0.22988, 34.837, 173.024, 310.202, 59.1, 1686.0),
  },
  {
    id: 'hygiea', name: '健神星', en: 'Hygiea', parent: 'sun', kind: 'minor', radius: 217,
    rotHours: 13.83, style: 'cratered', craters: 88,
    palette: ['#282623', '#4a453d', '#676155', '#847d6e'],
    orbit: au(3.1415, 0.11250, 3.8316, 283.20, 312.32, 152.18, 2031.0),
  },
  {
    id: 'pluto', name: '冥王星', en: 'Pluto', parent: 'sun', kind: 'dwarf', radius: 1188.3,
    pole: [132.993, -6.163], rotHours: -153.2928,
    style: 'desert', palette: ['#4a3227', '#8a6249', '#c2a184', '#e6d6bf'],
    orbit: au(39.482, 0.24883, 17.16, 110.299, 113.834, 14.53, 90560.0),
  },
  {
    id: 'charon', name: '冥卫一 · 卡戎', en: 'Charon', parent: 'pluto', kind: 'moon', radius: 606,
    style: 'cratered', craters: 99, palette: ['#3a3a3e', '#6a6a70', '#909096', '#b2b2b8'],
    orbit: km(19591, 0.0002, 0.08, 0, 0, 60.0, 6.3872),
  },
  {
    id: 'nix', name: '冥卫二 · 尼克斯', en: 'Nix', parent: 'pluto', kind: 'moon', radius: 24.5,
    style: 'icy', cracks: 12, palette: ['#7f7f86', '#b4b4bc', '#d8d8de', '#eeeef2'],
    orbit: km(48694, 0.0020, 0.13, 0, 31.0, 200.0, 24.8548),
  },
  {
    id: 'hydra', name: '冥卫三 · 许德拉', en: 'Hydra', parent: 'pluto', kind: 'moon', radius: 20.5,
    style: 'icy', cracks: 10, palette: ['#7a7a82', '#b0b0b8', '#d4d4da', '#ececf0'],
    orbit: km(64738, 0.0059, 0.24, 0, 140.0, 22.0, 38.2018),
  },
  {
    id: 'eris', name: '阋神星', en: 'Eris', parent: 'sun', kind: 'dwarf', radius: 1163,
    rotHours: 379.2, style: 'icy', cracks: 20,
    palette: ['#8e8a84', '#c4c0b8', '#e6e3dc', '#f6f4ef'],
    orbit: au(67.78, 0.44068, 44.04, 35.951, 151.639, 204.16, 203830.0),
  },
  {
    id: 'dysnomia', name: '阋卫一 · 迪丝诺美亚', en: 'Dysnomia', parent: 'eris', kind: 'moon', radius: 350,
    style: 'cratered', craters: 55, palette: ['#2e2e31', '#535358', '#74747a', '#93939a'],
    orbit: { ...km(37273, 0.0062, 0, 0, 0, 130.0, 15.786), frame: 'ecliptic' },
  },
  {
    id: 'haumea', name: '妊神星', en: 'Haumea', parent: 'sun', kind: 'dwarf', radius: 780,
    rotHours: 3.9155, style: 'icy', cracks: 18,
    palette: ['#8d8f92', '#c3c6ca', '#e5e8ea', '#f5f7f8'],
    orbit: au(43.13, 0.19489, 28.19, 122.163, 239.0, 218.2, 103468.0),
  },
  {
    id: 'makemake', name: '鸟神星', en: 'Makemake', parent: 'sun', kind: 'dwarf', radius: 715,
    rotHours: 22.83, style: 'desert',
    palette: ['#4a2a1e', '#8a5236', '#b8805c', '#dcb08c'],
    orbit: au(45.43, 0.16126, 28.9835, 79.62, 294.834, 165.5, 111845.0),
  },
  {
    id: 'quaoar', name: '创神星', en: 'Quaoar', parent: 'sun', kind: 'dwarf', radius: 545,
    rotHours: 17.68, style: 'icy', cracks: 14,
    palette: ['#4e423c', '#85756a', '#ab9c8f', '#cabfb2'],
    orbit: au(43.69, 0.03937, 7.988, 188.80, 147.5, 290.0, 105495.0),
  },
  {
    id: 'gonggong', name: '共工星', en: 'Gonggong', parent: 'sun', kind: 'dwarf', radius: 615,
    rotHours: 22.4, style: 'desert',
    palette: ['#43221a', '#7a3d2c', '#a56348', '#c98d6a'],
    orbit: au(67.38, 0.50060, 30.628, 336.83, 207.6, 104.0, 202230.0),
  },
  {
    id: 'orcus', name: '亡神星', en: 'Orcus', parent: 'sun', kind: 'dwarf', radius: 458,
    rotHours: 13.19, style: 'icy', cracks: 12,
    palette: ['#565a5e', '#8e939a', '#b6bcc2', '#d6dbe0'],
    orbit: au(39.42, 0.22014, 20.582, 268.55, 72.5, 181.0, 90480.0),
  },
  {
    id: 'arrokoth', name: '天涯海角', en: 'Arrokoth', parent: 'sun', kind: 'minor', radius: 9.1,
    rotHours: 15.92, style: 'cratered', craters: 22,
    palette: ['#3a1c14', '#6e3323', '#8f4c34', '#ab6a4c'],
    orbit: au(44.581, 0.04172, 2.4512, 158.99, 176.0, 317.0, 108700.0),
  },
];

/**
 * 主题色：用于轨道线、标签、信息栏标题，以及以后的公转轨迹。
 * 只给"直觉上有明确颜色"的天体单独指定，其余一律用统一的中性灰。
 * 注意这**不是**天体的真实外观色（那是贴图的事），而是识别用的标识色。
 */
export const THEME_DEFAULT = '#9aa5b1';

const THEMES = {
  sun: '#ffc233',
  mercury: '#b9a68e',
  venus: '#ffd98a',
  earth: '#3fdd6a',
  moon: '#dfe4ec',
  mars: '#ff4d3d',
  jupiter: '#e8a15c',
  saturn: '#e3c565',
  uranus: '#7fdbe8',
  neptune: '#4a7dff',
  pluto: '#d9a98c',
  // 少数几个自带强烈色彩印象的卫星
  io: '#f2d24a', // 硫磺黄
  europa: '#cfe3f2', // 冰蓝白
  titan: '#f0a02c', // 橙色雾霾
  enceladus: '#e8f6ff', // 高反照率冰
  triton: '#d9c0d6', // 淡粉
};

/**
 * 自转：IAU/WGCCRE 的自转基准子午线 W = W0 + Wdot·d（度，d 为 J2000 起的天数）。
 * W0 是从「天体赤道对 ICRF 赤道的升交点」量起的，而本工程的赤道系 X 轴是
 * 「对**黄道**的升交点」，两者差一个常量角，由 system.js 在建表时算出并补上。
 * 没有列在这里的天体：卫星按潮汐锁定（自转周期 = 公转周期，相位由轨道反解），
 * 其余用 rotHours。
 */
const ROTATION = {
  sun: [84.176, 14.1844000],
  mercury: [329.5988, 6.1385108],
  venus: [160.20, -1.4813688],
  earth: [190.147, 360.9856235],
  moon: [38.3213, 13.17635815],
  mars: [176.630, 350.89198226],
  jupiter: [284.95, 870.5360000], // 系统 III
  saturn: [38.90, 810.7939024],
  uranus: [203.81, -501.1600928],
  neptune: [253.18, 536.3128492],
  pluto: [302.695, 56.3625225],
};

/**
 * 引力常数乘质量 GM（km³/s²），用来算表面重力 g = GM/R²。
 * 大天体取实测值；小卫星和 TNO 多为由质量估计换算，仅供量级参考。
 */
const GM = {
  sun: 132712440018,
  mercury: 22031.87, venus: 324858.592, earth: 398600.4418, mars: 42828.375,
  jupiter: 126686534, saturn: 37931187, uranus: 5793939, neptune: 6836529,
  moon: 4902.8, phobos: 0.0007112, deimos: 0.0000985,
  io: 5959.916, europa: 3202.739, ganymede: 9887.834, callisto: 7179.289,
  amalthea: 0.138, himalia: 0.28,
  mimas: 2.5026, enceladus: 7.2027, tethys: 41.2097, dione: 73.1146,
  rhea: 153.9426, titan: 8978.14, hyperion: 0.3727, iapetus: 120.5, phoebe: 0.5532,
  miranda: 4.4, ariel: 86.4, umbriel: 81.5, titania: 228.2, oberon: 192.4,
  triton: 1427.6, proteus: 2.5, nereid: 0.36,
  pluto: 869.6, charon: 105.9, nix: 0.003, hydra: 0.003,
  ceres: 62.63, vesta: 17.29, pallas: 14.3, hygiea: 5.78,
  eris: 1108, dysnomia: 1.4, haumea: 267, makemake: 207, quaoar: 93.4,
  gonggong: 116.8, orcus: 42.4, arrokoth: 0.00005,
};

for (const b of BODIES) {
  b.theme = THEMES[b.id] ?? THEME_DEFAULT;
  if (ROTATION[b.id]) b.iauW = ROTATION[b.id];
  if (GM[b.id]) b.gm = GM[b.id];
}

export const BODY_BY_ID = new Map(BODIES.map((b) => [b.id, b]));
