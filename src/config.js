// Global constants and tuning knobs.
// Everything physical is computed in double precision using km, days and radians;
// values are multiplied by KM_TO_UNITS only when they are handed to three.js.

export const DEG = Math.PI / 180;
export const AU_KM = 149597870.7;
export const DAY_MS = 86400000;

/** J2000.0 = 2000-01-01 12:00 TT, the epoch for every orbital element here */
export const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

/** Obliquity of the ecliptic (J2000), used to rotate IAU poles from equatorial RA/Dec into ecliptic coordinates */
export const OBLIQUITY = 23.4392911 * DEG;

/** Scene unit: 1 unit = 1000 km. The choice does not affect precision, since rendering
 *  is camera-relative; it just keeps near/far values in a readable range. */
export const KM_TO_UNITS = 1e-3;
export const UNITS_TO_KM = 1e3;
export const AU_UNITS = AU_KM * KM_TO_UNITS;

// ---- Camera ----
export const FOV = 50;
export const MIN_NEAR_UNITS = 2e-7; // 0.2 m
export const FAR_UNITS = 4e8; // 4e11 km ≈ 2700 AU
/** Ceiling on the near plane. It normally tracks the closest object, but at maximum
 *  zoom-out it climbs to ~1e7 units and pushes the sky shell, which scales with it,
 *  past the far plane and blanks the starfield. A logarithmic depth buffer makes a
 *  small near plane free, so capping it costs nothing. */
export const MAX_NEAR_UNITS = 2e4;

// Zoom range in free mode (camera-to-pivot distance, km)
export const FREE_DIST_MIN = 20;
export const FREE_DIST_MAX = 4e10;
/** Minimum camera-to-centre distance in focus mode = body radius times this factor */
export const FOCUS_MIN_DIST_FACTOR = 1.5;
/** Fraction of the flight spent turning towards the target; afterwards the camera stays locked on it (0 aims instantly) */
export const FLIGHT_AIM_LOCK = 0.18;

/**
 * The four time-lapse rates cycled by T. Each one is a whole multiple of a real minute
 * so the readings stay intuitive: 1x (real time), 1440x (one minute per simulated day),
 * 43200x (30 days) and 525600x (365 days). The timeRates array in i18n.js matches
 * this table entry for entry.
 */
export const TIME_SCALES = [1, 1440, 43200, 525600];
/** Index of the default rate (1440x) */
export const TIME_SCALE_DEFAULT_INDEX = 1;

// ---- Exposure: compressing a 10^6 lighting range into something viewable ----
// The reference distance runs from the object of interest to the Sun, and exposure
// scales as d^EXPOSURE_EXP. Illumination itself falls off as d^-2, so screen brightness
// ends up proportional to d^(EXP-2). An exponent of 2 makes everything equally bright
// and destroys any sense of distance, while 0 leaves Neptune 900 times darker than Earth.
// At 1.88 Neptune lands around 0.67 of Earth and Eris around 0.58, readable but still
// visibly dimmer, and the same curve holds Mercury to 12% brighter than Earth.
export const EXPOSURE_EXP = 1.88;
export const EXPOSURE_MIN = 0.15;
export const EXPOSURE_MAX = 1400;
export const EXPOSURE_REF_MIN_AU = 0.3;
export const EXPOSURE_REF_MAX_AU = 45;
export const SKY_BRIGHTNESS = 0.3; // Starfield brightness (toneMapped:false, so exposure never touches it)
export const AMBIENT = 0.02;

// ---- Visibility and labels ----
/** Below this apparent radius a body is replaced by a fixed-screen-size dot and the sphere fades out */
export const DOT_TAKEOVER_PX = 4.0;
export const DOT_FULL_PX = 1.0;
// The star entry is the minimum screen size for the starburst sprite. Its spikes occupy most
// of the texture, and any smaller they stop reading as glare.
export const DOT_SIZE_PX = { star: 84, planet: 9, dwarf: 7, moon: 6, minor: 6 };
export const LABEL_MIN_SEP_PX = 9; // A moon closer than this to its primary on screen gets no label

// ---- Orbit lines ----
export const ORBIT_SEGMENTS = 512;
// An orbit line is drawn only while the camera sits roughly at that orbit's scale. Any smaller
// and it is illegible; any larger and it degenerates into a few straight lines crossing the
// view, such as Neptune's orbit seen from beside Earth, which is pure clutter.
export const ORBIT_FADE_IN_PX = 14;
export const ORBIT_FADE_FULL_PX = 45;
export const ORBIT_FADE_OUT_PX = 1400;
export const ORBIT_GONE_PX = 5200;
export const ORBIT_OPACITY = 0.34;

export const SKYBOX_TEXTURE = './solar_textures/8k_stars_milky_way.jpg';

/** Longest-edge cap for real textures, in pixels. See the VRAM arithmetic in render/assets.js.
 *  Raise it to 4096 or 8192 for sharper surfaces if VRAM allows, then re-run npm run textures. */
export const TEXTURE_MAX_WIDTH = 2048;
