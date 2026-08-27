import { AU_KM } from '../config.js';

/**
 * Body table. Radii are mean radii in km and orbital elements use the J2000.0 epoch.
 *
 * Planetary elements come from Standish's JPL approximation for 1800-2050 in a/e/i/L/lp/node
 * form, converted here to (node, peri = lp - node, M0 = L - lp). Dwarf planets and asteroids
 * use their mean elements. Satellites use mean elements relative to the primary's EQUATORIAL
 * frame, an approximation of the Laplace plane; real satellite orbits are strongly perturbed,
 * and these long-term averages are close enough to look right. A satellite's M0, its phase at
 * epoch, is often an estimate, and it only decides which side of its orbit the moon starts on.
 *
 * kind: star | planet | dwarf | moon | minor
 * style and palette feed the procedural texture generator and are unused once a real texture
 * covers the body.
 */

/** Planets: Standish form to internal form */
function pl(aAU, e, i, L, varpi, node, period) {
  return { a: aAU * AU_KM, e, i, node, peri: varpi - node, M0: L - varpi, period };
}
/** General case, with a in AU (small bodies) */
function au(a, e, i, node, peri, M0, period) {
  return { a: a * AU_KM, e, i, node, peri, M0, period };
}
/** Satellites, with a in km */
function km(a, e, i, node, peri, M0, period) {
  return { a, e, i, node, peri, M0, period };
}

export const BODIES = [
  // ────────────────────────────── Star ──────────────────────────────
  {
    id: 'sun', name: '太阳', en: 'Sun', kind: 'star', radius: 695700,
    pole: [286.13, 63.87], rotHours: 609.12, flattening: 0,
    style: 'star', palette: ['#7a1500', '#ff6a10', '#ffb648', '#fff6d8'],
    tex: { map: './solar_textures/8k_sun.jpg' },
  },

  // ────────────────────────────── Planets ──────────────────────────────
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
    // Ring radii are calibrated from the alpha profile of the ring texture: the Cassini division
    // sits at x = 0.70 along the strip, which is the real 119,875 km, and working backwards puts
    // the strip's ends at 62,829 and 144,251 km.
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

  // ────────────────────────────── Earth system ──────────────────────────────
  {
    id: 'moon', name: '月球', en: 'Moon', parent: 'earth', kind: 'moon', radius: 1737.4,
    // The Moon's spin axis is nearly perpendicular to the ecliptic, only 1.54 degrees off, so it
    // cannot inherit Earth's equatorial frame
    pole: [270.0, 66.54],
    rotHours: 655.728, style: 'cratered', craters: 198,
    tex: { map: './solar_textures/8k_moon.jpg' },
    palette: ['#2e2e30', '#5f5f62', '#8b8b8e', '#b9b9bc'],
    // The Moon's 5.145 degree inclination is measured against the ECLIPTIC, not Earth's equator
    orbit: { ...km(384400, 0.0549, 5.145, 125.08, 318.15, 135.27, 27.321582), frame: 'ecliptic' },
  },

  // ────────────────────────── Moons of Jupiter ──────────────────────────
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

  // ─────────────────────────── Moons of Saturn ───────────────────────────
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
    id: 'iapetus', name: '土卫八 · 伊阿珀托斯', en: 'Iapetus', parent: 'saturn', kind: 'moon', radius: 734.5,
    style: 'cratered', craters: 143, palette: ['#241d16', '#584c3c', '#a09484', '#d6cfc2'],
    orbit: km(3560820, 0.0286, 15.47, 0, 275.9, 12.0, 79.3215),
  },

  // ─────────────────────────── Moons of Uranus ───────────────────────────
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

  // ─────────────────────────── Moons of Neptune ──────────────────────────
  {
    id: 'triton', name: '海卫一 · 特里同', en: 'Triton', parent: 'neptune', kind: 'moon', radius: 1353.4,
    style: 'icy', cracks: 70, palette: ['#7d7480', '#c0b6c2', '#e9e1ea', '#a08f9c'],
    // Retrograde: an inclination above 90 degrees already expresses that, so the period stays positive
    orbit: km(354759, 0.000016, 156.885, 0, 344.0, 77.0, 5.876854),
  },

  // ──────────────────────── Dwarf planets and small bodies ────────────────────────
  {
    id: 'ceres', name: '谷神星', en: 'Ceres', parent: 'sun', kind: 'dwarf', radius: 469.7,
    rotHours: 9.074, style: 'cratered', craters: 132,
    palette: ['#33302b', '#5e5850', '#837b70', '#a49b8d'],
    orbit: au(2.7675, 0.07582, 10.593, 80.393, 73.597, 95.989, 1681.63),
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
    id: 'eris', name: '阋神星', en: 'Eris', parent: 'sun', kind: 'dwarf', radius: 1163,
    rotHours: 379.2, style: 'icy', cracks: 20,
    palette: ['#8e8a84', '#c4c0b8', '#e6e3dc', '#f6f4ef'],
    orbit: au(67.78, 0.44068, 44.04, 35.951, 151.639, 204.16, 203830.0),
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
];

/**
 * Theme colours, used for orbit lines, labels, info panel titles and future orbital trails.
 * Only bodies with an obvious intuitive colour get their own entry; everything else shares one
 * neutral grey. These are identification colours rather than a body's true appearance, which
 * is what the textures are for.
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
  // The handful of moons that carry a strong colour association
  io: '#f2d24a', // sulphur yellow
  europa: '#cfe3f2', // icy blue-white
  titan: '#f0a02c', // orange haze
  enceladus: '#e8f6ff', // high-albedo ice
  triton: '#d9c0d6', // pale pink
};

/**
 * Rotation from the IAU/WGCCRE prime meridian, W = W0 + Wdot * d, in degrees with d counted in
 * days from J2000. W0 is measured from the ascending node of the body's equator on the ICRF
 * equator, whereas this project's equatorial X axis points at the ascending node on the
 * ECLIPTIC. The two differ by a constant angle, which system.js computes and applies at table
 * build time. Bodies absent from this table fall back to tidal locking for satellites, where
 * the rotation period equals the orbital period and the phase is solved from the orbit, and to
 * rotHours for everything else.
 */
const ROTATION = {
  sun: [84.176, 14.1844000],
  mercury: [329.5988, 6.1385108],
  venus: [160.20, -1.4813688],
  earth: [190.147, 360.9856235],
  moon: [38.3213, 13.17635815],
  mars: [176.630, 350.89198226],
  jupiter: [284.95, 870.5360000], // System III
  saturn: [38.90, 810.7939024],
  uranus: [203.81, -501.1600928],
  neptune: [253.18, 536.3128492],
  pluto: [302.695, 56.3625225],
};

/**
 * Standard gravitational parameter GM in km^3/s^2, used for surface gravity g = GM/R^2.
 * Large bodies use measured values; small moons and TNOs are mostly converted from mass
 * estimates and are good for order of magnitude only.
 */
const GM = {
  sun: 132712440018, mercury: 22031.87, venus: 324858.592, earth: 398600.4418,
  mars: 42828.375, jupiter: 126686534, saturn: 37931187, uranus: 5793939,
  neptune: 6836529, moon: 4902.8, io: 5959.916, europa: 3202.739,
  ganymede: 9887.834, callisto: 7179.289, mimas: 2.5026, enceladus: 7.2027,
  tethys: 41.2097, dione: 73.1146, rhea: 153.9426, titan: 8978.14,
  iapetus: 120.5, miranda: 4.4, ariel: 86.4, umbriel: 81.5,
  titania: 228.2, oberon: 192.4, triton: 1427.6, pluto: 869.6,
  charon: 105.9, ceres: 62.63, eris: 1108, haumea: 267,
  makemake: 207, quaoar: 93.4, gonggong: 116.8, orcus: 42.4,
};

for (const b of BODIES) {
  b.theme = THEMES[b.id] ?? THEME_DEFAULT;
  if (ROTATION[b.id]) b.iauW = ROTATION[b.id];
  if (GM[b.id]) b.gm = GM[b.id];
}

export const BODY_BY_ID = new Map(BODIES.map((b) => [b.id, b]));
