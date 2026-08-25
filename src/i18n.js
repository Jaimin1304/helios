/**
 * 中英双语 / Bilingual strings.
 *
 * 语言在启动时定一次就不再变：整套 UI（包括天体名）都从这里取字符串，
 * 运行时切换意味着要重建标签层、拉格朗日点标签和已量好的标签宽度，不值得。
 *
 * 判定规则：浏览器首选语言是中文（zh-*）→ 中文，其余一律英文。
 * 繁体（zh-TW / zh-HK）虽然不是简体，但读简体仍远比读英文自然，所以归中文。
 * `?lang=en` / `?lang=zh` 可强制覆盖，方便截图与分享。
 */

function detect() {
  const forced = new URLSearchParams(location.search).get('lang');
  const tag = forced
    || (navigator.languages?.length ? navigator.languages[0] : navigator.language)
    || 'en';
  return String(tag).toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** @type {'zh'|'en'} */
export const LANG = detect();

const ZH = {
  docTitle: 'Helios · 真实比例太阳系',
  brandSub: '真实比例太阳系',

  modeFree: '自由模式',
  modeFlying: '飞行中…',
  modeFocus: (name) => `聚焦 · ${name}`,

  kind: {
    star: '恒星', planet: '行星', dwarf: '矮行星', moon: '卫星', minor: '小天体',
  },

  rowType: '类型',
  rowRadius: '半径',
  rowGravity: '表面重力',
  rowSpin: '自转周期',
  rowParent: '母天体',
  rowSemiMajor: '轨道半长径',
  rowPeriod: '公转周期',
  rowSunDist: '距太阳',
  rowCamDist: '距相机',

  none: '—',
  retrograde: '逆行',
  tidalLock: '潮汐锁定',
  spinTags: (main, tags) => `${main}（${tags.join(' · ')}）`,

  hours: (v) => `${v} 小时`,
  days: (v) => `${v} 天`,
  years: (v) => `${v} 年`,
  millionKm: (v) => `${v} 百万 km`,
  thousandKm: (v) => `${v} 千 km`,

  // 与 config.js 的 TIME_SCALES 一一对应
  timeRates: ['实时', '1 分钟/天', '1 分钟/月', '1 分钟/年'],

  gridRect: '方格',
  gridPolar: '极坐标',
  gridChip: (mode, unit) => `黄道面 ${mode} · 格距 ${unit}`,
  lagrangeChip: (n) => `拉格朗日点 · ${n} 组`,

  infoHint: '单击 = 选中 · 双击天体或标签 = 飞抵并聚焦',
  helpTitle: '操作',
  helpRows: [
    ['中键拖拽', '平移视角（自由模式）'],
    ['右键拖拽', '绕视口中心与黄道面的交点旋转'],
    ['滚轮', '缩放（指数级，跨 10 个数量级）'],
    ['单击天体/标签', '选中，只更新右上角简介'],
    ['双击天体/标签', '飞抵并进入聚焦模式'],
    ['聚焦中 · 右键', '绕天体旋转 · 滚轮拉近拉远'],
    ['聚焦中 · 中键', '单击解除聚焦；拖动 = 解除并平移'],
    ['<kbd>G</kbd>', '黄道面坐标系：关 → 方格 → 极坐标'],
    ['<kbd>L</kbd>', '拉格朗日点（母天体–子天体 L1~L5）'],
    ['<kbd>T</kbd>', '时间流逝：1× → 1440× → 43200× → 525600×'],
    ['<kbd>O</kbd> <kbd>N</kbd> <kbd>Esc</kbd>', '轨道线 · 天体标签 · 退出聚焦'],
    ['<kbd>H</kbd>', '隐藏 / 显示全部界面'],
  ],

  loadTextures: (file) => `正在载入纹理 ${file}…`,
  loadSurface: (name) => `正在生成 ${name} 的表面…`,
  loadBelts: '正在播撒小行星带与柯伊伯带…',
  loadReady: '就绪',
};

const EN = {
  docTitle: 'Helios · The Solar System at True Scale',
  brandSub: 'THE SOLAR SYSTEM AT TRUE SCALE',

  modeFree: 'FREE',
  modeFlying: 'FLYING…',
  modeFocus: (name) => `FOCUS · ${name}`,

  kind: {
    star: 'Star', planet: 'Planet', dwarf: 'Dwarf planet', moon: 'Moon', minor: 'Small body',
  },

  rowType: 'Type',
  rowRadius: 'Radius',
  rowGravity: 'Surface gravity',
  rowSpin: 'Rotation period',
  rowParent: 'Primary',
  rowSemiMajor: 'Semi-major axis',
  rowPeriod: 'Orbital period',
  rowSunDist: 'Distance to Sun',
  rowCamDist: 'Distance to camera',

  none: '—',
  retrograde: 'retrograde',
  tidalLock: 'tidally locked',
  spinTags: (main, tags) => `${main} (${tags.join(' · ')})`,

  hours: (v) => `${v} h`,
  days: (v) => `${v} d`,
  years: (v) => `${v} yr`,
  millionKm: (v) => `${v}M km`,
  thousandKm: (v) => `${v}k km`,

  // 与 config.js 的 TIME_SCALES 一一对应
  timeRates: ['real time', '1 min/day', '1 min/month', '1 min/year'],

  gridRect: 'GRID',
  gridPolar: 'POLAR',
  gridChip: (mode, unit) => `ECLIPTIC ${mode} · CELL ${unit}`,
  lagrangeChip: (n) => `LAGRANGE · ${n} SYSTEMS`,

  infoHint: 'Click = select · double-click a body or label = fly to and focus',
  helpTitle: 'CONTROLS',
  helpRows: [
    ['Middle drag', 'Pan the view (free mode)'],
    ['Right drag', 'Orbit the view-centre ∩ ecliptic point'],
    ['Wheel', 'Zoom (exponential, 10 orders of magnitude)'],
    ['Click body / label', 'Select — info panel only, camera stays'],
    ['Double-click', 'Fly there and enter focus mode'],
    ['Focus · right drag', 'Orbit the body · wheel to dolly'],
    ['Focus · middle', 'Click releases focus; drag releases + pans'],
    ['<kbd>G</kbd>', 'Ecliptic frame: off → grid → polar'],
    ['<kbd>L</kbd>', 'Lagrange points (primary–secondary L1–L5)'],
    ['<kbd>T</kbd>', 'Time rate: 1× → 1440× → 43200× → 525600×'],
    ['<kbd>O</kbd> <kbd>N</kbd> <kbd>Esc</kbd>', 'Orbits · labels · exit focus'],
    ['<kbd>H</kbd>', 'Hide / show all UI'],
  ],

  loadTextures: (file) => `Loading texture ${file}…`,
  loadSurface: (name) => `Generating the surface of ${name}…`,
  loadBelts: 'Seeding the asteroid and Kuiper belts…',
  loadReady: 'Ready',
};

/** 当前语言的字符串表。参数化的条目是函数。 */
export const T = LANG === 'zh' ? ZH : EN;

/** 天体显示名：中文用 name，英文用 en。 */
export function bodyName(def) {
  return LANG === 'zh' ? def.name : def.en;
}

/** 把 index.html 里带 data-i18n 的静态文案替换成当前语言。 */
export function applyStaticStrings() {
  document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
  document.title = T.docTitle;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = T[el.dataset.i18n];
  }
  const help = document.getElementById('help-rows');
  if (help) {
    help.innerHTML = T.helpRows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }
}
