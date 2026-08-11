// 全局常量与可调参数。
// 约定：**所有物理量一律用 km / 天 / 弧度做双精度计算**，只有在写进 three.js
// 对象时才乘 KM_TO_UNITS 转成场景单位。

export const DEG = Math.PI / 180;
export const AU_KM = 149597870.7;
export const DAY_MS = 86400000;

/** J2000.0 = 2000-01-01 12:00 TT，本工程用作所有轨道根数的历元 */
export const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

/** 黄赤交角（J2000），用于把 IAU 极点(赤道系 RA/Dec)转到黄道系 */
export const OBLIQUITY = 23.4392911 * DEG;

/** 场景单位：1 unit = 1000 km。数值本身不影响精度（渲染是相机相对的），
 *  只是让 near/far 之类的量级好读一些。 */
export const KM_TO_UNITS = 1e-3;
export const UNITS_TO_KM = 1e3;
export const AU_UNITS = AU_KM * KM_TO_UNITS;

// ---- 相机 ----
export const FOV = 50;
export const MIN_NEAR_UNITS = 2e-7; // 0.2 m
export const FAR_UNITS = 4e8; // 4e11 km ≈ 2700 AU
/** 近裁面上限。近裁面本来随最近物体走，但视角拉到最远时它会涨到 1e7 单位，
 *  把跟随它缩放的天球壳顶出远裁面之外 → 星空整个变黑。对数深度缓冲下
 *  近裁面取小一点没有任何代价，所以直接封顶。 */
export const MAX_NEAR_UNITS = 2e4;

// 自由模式的缩放范围（相机到枢轴的距离，km）
export const FREE_DIST_MIN = 20;
export const FREE_DIST_MAX = 4e10;
/** 聚焦模式下相机到天体中心的最小距离 = 半径 × 该系数 */
export const FOCUS_MIN_DIST_FACTOR = 1.5;
/** 飞行前这段比例内把镜头转向目标，之后全程锁定目标（0 = 瞬间对准） */
export const FLIGHT_AIM_LOCK = 0.18;

/** 仿真时间流逝倍率（1440 = 1 真实分钟走完 1 仿真日）。设 0 即冻结时间。 */
export const TIME_SCALE = 1440;

// ---- 曝光（把 10^6 级的光照动态范围压到可看）----
// 参考距离 = 关注目标到太阳的距离，曝光 ∝ d^EXPOSURE_EXP。
// 光照本身 ∝ d^-2，所以画面亮度 ∝ d^(EXP-2)：
//   EXP = 2 → 各处一样亮，完全失去距离感；EXP = 0 → 海王星比地球暗 900 倍。
// 取 1.88 → 海王星约为地球的 0.67、阋神星 0.58，既能看清又保留衰减感；
// 同时近日天体的曝光被压低（水星仅比地球亮 12%），不会过曝。
export const EXPOSURE_EXP = 1.88;
export const EXPOSURE_MIN = 0.15;
export const EXPOSURE_MAX = 1400;
export const EXPOSURE_REF_MIN_AU = 0.3;
export const EXPOSURE_REF_MAX_AU = 45;
export const SKY_BRIGHTNESS = 0.62; // 星空亮度（会被曝光反向补偿，保持恒定）
export const AMBIENT = 0.02;

// ---- 可见性 / 标签 ----
/** 天体视半径小于该像素数时，用恒定屏幕尺寸的光点代替（并淡出球体） */
export const DOT_TAKEOVER_PX = 4.0;
export const DOT_FULL_PX = 1.0;
// 恒星那一档是星芒贴图的最小屏幕尺寸：芒占贴图外围大半，画布太小就读不出"刺眼"
export const DOT_SIZE_PX = { star: 84, planet: 9, dwarf: 7, moon: 6, minor: 6 };
export const LABEL_MIN_SEP_PX = 9; // 卫星与母天体的最小屏幕间距，太近就不画标签

// ---- 轨道线 ----
export const ORBIT_SEGMENTS = 512;
// 轨道线只在"镜头大致处于该轨道的尺度上"时显示：太小看不清，
// 太大就只是几条横穿视野的直线（比如贴着地球时的海王星轨道），纯属干扰。
export const ORBIT_FADE_IN_PX = 14;
export const ORBIT_FADE_FULL_PX = 45;
export const ORBIT_FADE_OUT_PX = 1400;
export const ORBIT_GONE_PX = 5200;
export const ORBIT_OPACITY = 0.34;

export const SKYBOX_TEXTURE = './solar_textures/8k_stars_milky_way.jpg';

/** 真实纹理的最长边上限（像素）。见 render/assets.js 里的显存账。
 *  显存充裕想更高清，调到 4096 或 8192 即可。 */
export const TEXTURE_MAX_WIDTH = 2048;
