# Helios

A browser tour of the solar system at 1:1 scale. Body radii, orbit sizes and inclinations all
come from real data, with no "makes it look nicer" fudging anywhere. Pure front end, built on
Three.js and Vite.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # writes dist/, textures included
```

## Controls

| Input | Free mode | Focus mode |
| --- | --- | --- |
| Middle drag | Pan | Releases focus immediately, then pans |
| Middle click | — | Release focus |
| Right drag | Orbit the point where the view-centre ray meets the ecliptic | Orbit the body |
| Wheel | Exponential zoom | Dolly in and out |
| Click a body or label | Select; the camera stays put and only the info panel changes | Same |
| Double-click a body or label | Fly there and focus | Switch target |
| `G` | Ecliptic frame: off, grid, polar | Same |
| `L` | Lagrange points, L1 to L5 for every body and its primary | Same |
| `T` | Time rate: 1x, 1440x, 43200x, 525600x | Same |
| `H` | Hide or show the whole interface, leaving the HELIOS mark | Same |
| `O` `N` `F` `Esc` | Orbit lines, labels, focus the selection, exit focus | |

Labels are `pointer-events: none`, so every mouse gesture reaches the canvas and hovering a
label never blocks panning, orbiting or zooming. Clicking one still works, because picking runs
in screen space on the canvas side and tries the body's disc, then the label's text box, then
the dot's hot zone.

Deep links for debugging: `?focus=saturn`, `?dist=45` (AU), `?lang=en` or `?lang=zh`.

## What true scale costs

Three problems fall out of refusing to fudge the scale, and most of the interesting code exists
to deal with them.

**Precision.** The scene spans about eleven orders of magnitude, from Neptune's orbit at
4.5e9 km down to a 6 km moon, which float32 cannot represent. Every orbit and every piece of
camera state is therefore computed in double precision with km as the unit (`src/sim`,
`src/control/cameraRig.js`). Rendering uses a floating origin: the camera sits permanently at
`(0,0,0)` and each frame writes every body's position as its offset from the camera times
`KM_TO_UNITS`. All float32 ever has to express is how far something is from the camera, so
nearby bodies get the full mantissa. Depth uses `logarithmicDepthBuffer`, with the near plane
following the closest object each frame.

**Invisibility.** Almost everything is sub-pixel at true scale, so each body has two
representations that cross-fade by apparent radius. Above 4 px it draws as a real sphere; below
that a glowing dot of constant screen size takes over (`render/bodyView.js`), with a clickable
HTML label on top (`render/labels.js`). The label layer declutters by importance, drops a moon
whose label would collide with its primary, and hides anything a planet stands in front of.

**Lighting range.** Irradiance at Mercury is roughly 6000 times what Neptune receives. The point
light uses a physical `decay = 2`, and auto-exposure covers part of the rest by driving
`toneMappingExposure` from the distance between the Sun and whatever the camera is looking at.
The exponent is 1.88 rather than 2, which leaves the outer system noticeably dimmer without
going black; `config.js` works through the reasoning. Anything that should hold a fixed
brightness, such as the starfield, the dots and the solar disc, is marked `toneMapped: false`
and sits outside the exposure system.

## What is included

The criterion is hydrostatic equilibrium, meaning bodies their own gravity has pulled round.
That comes to 36: the Sun, the eight planets, 19 round moons (the Moon; Io, Europa, Ganymede,
Callisto; Mimas, Enceladus, Tethys, Dione, Rhea, Titan, Iapetus; Miranda, Ariel, Umbriel,
Titania, Oberon; Triton; Charon) and 8 dwarf planets, being the five the IAU recognises plus
Quaoar, Gonggong and Orcus, which the literature broadly agrees on.

Vesta and Pallas are out because the IAU points to their failure to reach equilibrium as exactly
why they are not dwarf planets. Hygiea is contested and falls well under the roughly 800 km a
rocky body needs. Dysnomia has never had its shape measured. Phobos, Hyperion, Phoebe, Nereid,
Arrokoth and the rest are visibly irregular and would be sub-pixel here regardless.

Sedna is left out for a different reason: it almost certainly is in equilibrium, but its
semi-major axis of 506.8 AU is ten times everything else in the scene, and one orbit line that
size wrecks the sense of scale for everything inside it.

## Time

`T` cycles four rates, each a whole multiple of one real minute so the readings stay intuitive.

| Rate | One real minute covers | Good for |
| --- | --- | --- |
| `1x` | one minute | Real time; nothing appears to move |
| `1440x` (default) | one day | Rotation; Earth turns once in about 60 seconds |
| `43200x` | 30 days | The Moon's orbit, about 55 seconds, and the inner planets |
| `525600x` | one year | Outer planet orbits |

The top bar shows both the multiplier and what it means, since 43200x on its own says nothing
about speed. Positions are solved analytically from Kepler elements rather than integrated, so
fast-forward accumulates no error. The real limit is sampling: at 525600x Earth turns about 37
degrees per frame and strobes badly, which is aliasing rather than a simulation failure.

Rotation comes from three sources in descending order of confidence (`initSpin()` in
`system.js`). The IAU/WGCCRE prime meridian `W = W0 + Wdot * d` covers the Sun, the Moon, the
eight planets and Pluto, with one wrinkle: IAU measures W0 from the ascending node of the body's
equator on the ICRF equator while this project measures from the node on the ecliptic, so
`iauNodeOffset()` supplies the constant angle between them. Retrograde rotation then falls out
of the pole direction on its own, since Pluto has a positive Wdot but a pole south of the
ecliptic at z = -0.388 and still turns backwards seen from ecliptic north. Tidally locked
satellites form the second tier, and whatever is left uses `rotHours` with an uncalibrated epoch
phase, which only decides which face greets you at startup.

## Notes on the parts that fought back

Four things here look like bugs and turn out to be geometry or convention.

**Orbit lines have to pass through their body.** A 512-segment polyline inscribed in an ellipse
has a chord sagitta of about `1.88e-5 * a`. For Earth that is 2,800 km and invisible; for
Neptune it is 84,700 km, or 3.4 Neptune radii, and the line sails past the planet in plain view.
Adding segments does not fix it, since Ceres would need 3,800 and Arrokoth around 100,000. What
does fix it is aligning the sampling phase to the body's current position and using the body as
the geometry origin, so vertex zero lands exactly on it and error grows quadratically from a
point already off screen. That also removes the roughly 450 km float32 offset at 4.5e6 scene
units. Once bodies move, `OrbitLine.rebuild()` has to run after each position update or the
anchor drifts.

**Very long line segments get eaten by the rasteriser.** The ecliptic grid originally drew each
line as a single segment spanning 100 cells. At grazing angles such a segment runs from just in
front of the camera out to tens of AU, covering several orders of magnitude in depth, and the
near end simply vanished, leaving one band near the horizon. Disabling depth testing changed
nothing, which ruled out occlusion. `pushLine()` in `grid.js` now subdivides every line per
cell, keeping each segment's depth range small, which logarithmic depth interpolation needs
anyway.

**Tidal locking needs mean motion, not instantaneous angular velocity.** Deriving the spin rate
from how fast the primary's direction sweeps is wrong, because true anomaly advances unevenly on
an eccentric orbit and more unevenly still once a high-inclination orbit is projected onto the
equator. Measured error was 1.2% for Europa and 6.4% for Triton. Using orbital mean motion with
the direction taken from angular momentum projected onto the spin axis fixes both and makes
retrograde moons spin backwards with no special case. Libration then emerges on its own: the
Moon's sub-Earth longitude swings ±6.3 degrees, matching the theoretical 2e of 6.29.

**Surface gravity uses the equatorial radius.** The table stores mean volumetric radius
`R = Re * (1-f)^(1/3)`, and inverting that recovers Re to better than 0.01% with no extra data.
Mean radius inflates the gas giants systematically, putting Jupiter at 25.92 against a published
24.79, while equatorial radius brings every body within 0.2%.

## The Sun

The real Sun outshines the planets by five or six orders of magnitude, which no display can
reproduce, so the impression has to be assembled from four layers (`bodyView.js`,
`textures.js`). There is deliberately no post-process bloom, since a full-screen pass fights the
per-material `toneMapped: false` scheme that holds certain layers at fixed brightness.

The disc gets limb darkening through a short shader patch, fading the edge to 0.34 of centre by
`mu = N·V`, and is then overdriven 1.55x so the brightest granulation clips to white. That layer
does most of the work of turning a textured ball into something that reads as a star. A hot halo
sprite at 2.4 R sits over it.

Veiling glare is the third layer and matters more than the first two. What makes a light source
painful to look at on film comes mostly from scattering inside the lens or the eye, and that
haze lifts everything nearby while washing out contrast. The texture is accordingly wide and
soft, and its strength tracks solar irradiance entering the lens by inverse square, so it floods
the screen near Earth and has all but vanished beyond Jupiter. It carries `depthTest: false`,
since haze belongs over the image rather than behind the geometry, though it disappears the
moment a planet occludes the Sun. Inside 0.05 AU it is dropped entirely, because at that range
you are almost certainly studying the disc and a screen-wide wash only gets in the way; focusing
the Sun parks the camera at 0.0195 AU, comfortably inside that threshold.

Last comes the starburst, four long and four short diffraction spikes at a constant screen size.
Its colour is set past 1.0 at (1.75, 1.62, 1.44), which without bloom is the closest thing to an
overexposed source. It carries the whole impression once the Sun has receded to a point, and
fades out inside 2 AU where the disc is well resolved and spikes start to look fake.

Every layer except the glare keeps `depthTest: true`. Their sprite quads pass through the Sun's
centre, so what the disc occludes is precisely the interior of the circle and the additive light
appears only beyond the limb, which keeps disc detail sharp and stops a transiting planet from
being washed out.

## Rings

Rings use a `MeshBasicMaterial` rather than a lit one. Their normal points along the spin axis
and sunlight arrives at a grazing angle, so a Lambertian model renders them nearly black, while
real rings come close to the planet's own brightness thanks to strong backscatter. Brightness is
therefore taken straight from the inverse square of the solar distance and left for
auto-exposure to compress. Two things are layered on top of that in a small shader patch.

**The planet's shadow.** A ring point is eclipsed when it lies behind the planet along the Sun
direction and inside its silhouette. Squashing space along the polar axis turns the oblate
planet into a sphere, and since ring points sit at local z = 0 they are untouched by that
squash, so only the shadow axis has to carry it. The test is then a cylinder of the planet's
equatorial radius, and Saturn's works out to 60,268 km against a published 60,268. The Sun is a
disc rather than a point, so the shadow edge softens with distance behind the planet; at
120,000 km out the penumbra comes to 59 km, which the shader derives from the Sun's angular
radius instead of a fudged constant.

**Transmitted light on the shaded face.** Rings are translucent, so from the unlit side what
reaches the eye is light that came through them. Dense regions go dark while thin ones stay
comparatively bright, which is the contrast inversion Cassini photographed from Saturn's unlit
side. The model is `gain * exp(-k * alpha)` against the ring texture's alpha, with the alpha
channel still doing the occlusion, so the shaded face reads as a faint ghost of the lit one
rather than disappearing. Setting `RING_TRANSMIT` to 0 blanks it entirely instead.

Which face is lit is decided on the CPU and passed in as `uLitFacing`. Deriving it in the
shader from `gl_FrontFacing` is a trap: `RingGeometry` reports front-facing when viewed from its
local **-Z**, the opposite of what its +Z normals suggest, which silently swaps the lit and
shaded sides. The ring also fades out over the last 1.7 degrees before edge-on, where a
zero-thickness disc covers almost no pixels anyway.

Which face is lit follows the real season. Saturn passed equinox in May 2025, so the simulation
puts the sub-solar ring latitude at -7.1 degrees in August 2026 and deepening, leaving the
southern face lit into the 2030s. Rotating more than about eight degrees above the ecliptic on
the sunward side therefore crosses the ring plane and brings you round to the shaded face, which
is correct geometry rather than a bug.

Still missing: the rings cast no shadow onto the planet, and the shadowed part of the rings
receives no Saturnshine, so it goes fully black rather than very dark.

## The belts

`render/belts.js` draws the asteroid and Kuiper belts as 105,000 particles in two draw calls.
They are decorative: not `Body` instances, absent from picking, unlabelled.

Each particle carries its own orbital elements and **solves Kepler's equation in the vertex
shader**, so they genuinely orbit with individual periods and develop differential rotation on
their own. The main belt runs 2.05 to 3.30 AU, peaks around 2.7 to 3.0 AU, and has five Kirkwood
gaps carved out by rejection sampling at the resonances with Jupiter; density at 2.50 AU comes
out at 21% of the peak. Mean e of 0.14 and i of 10 degrees give it real thickness. The Kuiper
belt mixes 25% Plutinos clustered at 39.4 AU, 60% near-circular cold classicals between 42 and
47.5 AU, and 15% hot classicals, with the Kuiper cliff at 48 AU.

A real asteroid is far below one pixel at any distance, so each is drawn as a dot of exactly one
device pixel. The whole-number size is not incidental. GL rasterises a point as a square of side
`gl_PointSize` centred on the point, generating a fragment for every pixel whose centre that
square covers, so a side of 1.6 covers one, two or four centres depending on sub-pixel position
and an asteroid's brightness jumps by up to 4x as it drifts. That reads as aliasing rather than
twinkling, while a whole-number side always covers n² pixels and holds steady. The code uses
`round(dpr)` rather than a hard-coded 1.0, because `gl_PointSize` counts device pixels and on a
2x display one device pixel is half a CSS pixel, which visibly thins the belt.

Two fades in `Belt.update()` are necessary. The first drops the belts once the view scale falls
far below the belt itself, since beside a planet you would see nothing and a screenful of dots
is only noise. The second normalises by screen area: the dots hold a constant pixel size, so as
the belt shrinks its total flux stays put while brightness per unit area climbs as 1/area, and
additive blending turned it into an overexposed blob at 95 AU. Multiplying by the area ratio
restores the faint ring it should be.

## Lagrange points

`L` shows all five points of the two-body system each body forms with its primary, tracked live
(`render/lagrange.js`).

The three collinear points depend only on the mass ratio `mu = m2/(m1+m2)`, which makes them
constants: solve once at table build time, then each frame apply the current direction and
separation. The solve uses the dimensionless form in the rotating frame,

```
f(x) = x − (1−mu)·(x+mu)/|x+mu|³ − mu·(x−1+mu)/|x−1+mu|³ = 0
```

whose three roots lie in `(−mu, 1−mu)`, `(1−mu, +inf)` and `(−inf, −mu)`. Since f changes sign
across each interval, plain bisection converges unconditionally, and running once at build time
makes its slowness against Newton irrelevant.

Do not substitute the Hill radius approximation `(mu/3)^(1/3)`. For the Earth-Moon system at
mu = 0.0122 it gives 61,300 km against an exact 58,020 km, an error of 5%.

L4 and L5 form equilateral triangles with the two bodies, so rotating the primary-to-secondary
direction by ±60 degrees about the orbit normal `P × Q` handles retrograde orbits correctly with
no special case. Measured against published figures, and with the differences entirely explained
by the ratio of instantaneous to mean orbital radius, Earth-Moon L1 comes out at 60,499 km
against 58,020 scaled by 400,833/384,400, or 60,500; Sun-Earth L1 gives 1,507,674 km against a
published 1.5e6; and L4's distances to both bodies agree to 1.000000 at 60.000 degrees.

L1 to L3 are unstable saddle points while L4 and L5 are stable for mu < 0.0385, where Jupiter's
Trojans collect, so the two families are coloured differently. A group whose orbit is under
90 px on screen is hidden, since all five points would otherwise pile onto the primary, and the
top bar reports how many groups are visible so a zoomed-out press of `L` does not look broken.

## Interface

The language is decided once at startup from the browser preference, with `zh-*` selecting
Chinese and anything else English (`src/i18n.js`). Traditional Chinese maps to Chinese as well,
since reading simplified is far closer than reading English, and `?lang=en` or `?lang=zh`
overrides the choice. Every string including body names is read at table build time, so
switching at runtime would mean rebuilding the label layer and re-measuring every label width.
Both names live side by side in the `name` and `en` fields of `data/bodies.js` and `Body.name`
picks one, which keeps the labels, info panel and Lagrange overlay unaware of the question.

The styling is monospace throughout, with square corners, hairline borders and no frosted glass.
Numbers use `tabular-nums` so readings do not jitter as they change, and a single accent colour
is defined; the rest of the colour in view belongs to the bodies. Each body carries a `theme`
colour driving its orbit line, label and info panel title, assigned only where there is an
obvious intuitive choice and otherwise left at a neutral grey. These identify rather than
describe, so a distant dot keeps its real colour and ignores the theme.

`H` collapses the interface down to the HELIOS mark, for screenshots and for watching. Body
labels are unaffected, since they belong to the scene and have their own toggle on `N`.

## Coordinates

J2000 ecliptic with +Z towards ecliptic north, which makes the ecliptic plane `z = 0` and the
reference plane for free mode. `G` cycles off, rectangular and polar, starting off. Cells are
fixed at 1 AU out to ±50 AU with a major line every 10 AU, and all four half-axes carry unsigned
AU ticks, since they serve as a distance reference. Readings thin first by on-screen cell size,
choosing 1, 5 or 10 AU, then again by the gap between adjacent labels per half-axis, because
perspective crowds distant ticks together.

Planetary elements come from Standish's approximation. Satellite elements are expressed in the
primary's equatorial frame built from IAU pole RA/Dec, with the Moon as the exception since it
is inclined 5.145 degrees to the ecliptic. Satellite `M0` values are frequently estimates.

## Textures

The art in `solar_textures/` is mostly 8192x4096 jpg, about 66 MB across the 14 files actually
referenced, while `assets.js` downsamples everything to `TEXTURE_MAX_WIDTH` (2048) during decode
at runtime. Roughly 94% of every downloaded pixel was being discarded, so
`scripts/build-textures.mjs` shrinks them at build time and converts to webp.

```bash
npm run textures            # vite build calls this automatically
npm run textures -- --force # ignore the cache and re-encode, about 5 seconds
```

| | Original | Derived |
| --- | --- | --- |
| 14 referenced textures | 66.28 MB | 2.49 MB (26.6x) |
| Whole `dist/` | ~67 MB | 2.9 MB |

Quality is unchanged, because 2048 wide is what the runtime was showing all along. An A/B pixel
comparison at matched camera and time gives a mean absolute difference of 0.64/255 for Earth and
0.14 for Saturn, all of it from webp q82 and the source jpg's own artefacts.

The original 8K art stays untouched, so raising `TEXTURE_MAX_WIDTH` later only needs a re-run.
The sky is the one width exception, since `sky.js` bypasses `assets.js` and uses whatever it
loads: a 50 degree field spans only a seventh of the image, so even 8192 is barely 1:1 sampling
and 2048 goes visibly soft. That image is mostly black, so 8192 in webp costs 0.30 MB, less than
the 1.82 MB jpg it replaces. Anything carrying alpha is encoded losslessly, because the Saturn
ring strip's alpha is data rather than appearance and lossy compression bands the edge of the
Cassini division.

Development serves the originals directly, so edits take effect immediately. Filenames change
from `.jpg` to `.webp` along the way, handled by a map injected at build time and applied by
`resolveTextureUrl()` just before the fetch; in development that map is empty.

Two smaller details. Decoding goes through `createImageBitmap`'s `resizeWidth`, which runs
off-thread and comfortably beats `<img>` plus canvas, and without it each 8192x4096 image costs
about 134 MB of VRAM. Earth's night side needed a shader patch, since three's built-in
`emissiveMap` adds unconditionally and would glow in daylight, so a mask built from the sun
angle restricts it to beyond the terminator.

## Deployment

`.github/workflows/deploy.yml` builds and publishes on every push to `main`. The repository
needs one setting: **Settings → Pages → Source → GitHub Actions**.

`base: './'` keeps every path relative, so a project subpath such as `user.github.io/helios/`
works without configuration. The site is entirely self-contained and makes no external requests,
which matters for access from mainland China, where a single blocked `fonts.googleapis.com` is
enough to stall a page.

## Layout

```
src/
  config.js            units, clip planes, exposure, time rates, every tuning constant
  i18n.js              bilingual string tables and language detection
  data/bodies.js       radii, J2000 elements, IAU poles and rotation, GM, theme colours, textures
  sim/kepler.js        Kepler solver, elements to position, equatorial and IAU meridian conversion
  sim/system.js        body hierarchy, position and rotation propagation
  control/cameraRig.js double-precision camera: free, focus, straight-line flight
  control/input.js     mouse and keyboard bindings
  render/bodyView.js   sphere, dot, rings, clouds, and the four stellar light layers
  render/assets.js     real texture loading with downsampling at decode
  render/textures.js   procedural surfaces and sprite textures
  render/orbits.js     orbit lines, phase-anchored to the body
  render/belts.js      asteroid and Kuiper belt particles, Kepler solved in the vertex shader
  render/lagrange.js   Lagrange points L1 to L5
  render/grid.js       ecliptic frame, rectangular and polar, with AU ticks
  render/labels.js     DOM body label layer
  render/sky.js        celestial sphere
  ui/hud.js            mode, clock, info panel, loading progress
scripts/
  build-textures.mjs   build-time 8K to 2048px webp conversion
.github/workflows/
  deploy.yml           build and publish to GitHub Pages on push to main
```

## Not yet done

Eclipse and ring shadows, atmospheric scattering, comets, and a time control in the interface.
