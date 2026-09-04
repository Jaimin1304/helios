# Generated planetary surface maps

> **AI-generated / AI 生成** — every file matching `2k_*_generated.jpg` is a visual
> approximation, not an observation product, scientific data set, or navigational map.

These 26 assets were generated on 2026-09-05 with OpenAI's built-in image generator. The
existing Moon and Mercury maps were supplied only as references for the flat 2:1 cartographic
layout and detail density. Each result was normalised to a 2048 x 1024 equirectangular JPEG,
stripped of metadata, and blended across a narrow longitude boundary so the globe seam closes.
The file suffix and the `generatedTexture()` helper in `src/data/bodies.js` make provenance
visible both on disk and in code.

## Prompt set

Every asset used this shared prompt plus one row-specific appearance constraint:

> Use case: scientific-educational. Asset type: production 3D globe surface texture. Create one
> seamless 2:1 equirectangular longitude-latitude albedo texture matching the flat cartographic
> presentation and fine detail density of the supplied Moon and Mercury references. Style:
> photorealistic spacecraft-imagery-derived planetary map, or measured spectral colour for
> unresolved trans-Neptunian objects; scientifically restrained. Fill the canvas edge to edge,
> with equator centred and poles at top and bottom. Use completely flat albedo: no directional
> light, terminator, cast shadows, bevel lighting, or spherical shading. No sphere, black space,
> border, grid, labels, text, watermark, or repeated procedural stamps. For unresolved bodies,
> do not imply that invented geography was observed.

| System | File(s) | Appearance constraint and evidence level |
| --- | --- | --- |
| Jupiter | `2k_io_generated.jpg`, `2k_europa_generated.jpg`, `2k_ganymede_generated.jpg`, `2k_callisto_generated.jpg` | Spacecraft-constrained: Io sulphur plains and volcanic deposits; Europa ice and lineae; Ganymede dark terrain and bright grooves; Callisto dark, crater-saturated terrain and a Valhalla-like multi-ring structure. Based on NASA's [Galilean satellite imagery](https://science.nasa.gov/photojournal/the-galilean-satellites/) and [surface comparison](https://science.nasa.gov/science-research/europa-ganymede-and-callisto-surface-comparison-at-high-spatial-resolution/). |
| Saturn | `2k_mimas_generated.jpg`, `2k_enceladus_generated.jpg`, `2k_tethys_generated.jpg`, `2k_dione_generated.jpg`, `2k_rhea_generated.jpg`, `2k_titan_generated.jpg`, `2k_iapetus_generated.jpg` | Cassini-constrained at large scale: Herschel, tiger stripes, Odysseus/Ithaca Chasma, wispy fractures, cratered Rhea, Titan's opaque orange haze bands, and Iapetus's albedo dichotomy. Based on NASA's [enhanced-colour inner-moon maps](https://science.nasa.gov/photojournal/enhanced-color-maps-of-saturn-inner-moons/) and [Saturn system resources](https://assets.science.nasa.gov/content/dam/science/psd/solar/2023/09/t/The_Saturn_System-1.pdf?emrc=689cfdc3f1d51). |
| Uranus | `2k_miranda_generated.jpg`, `2k_ariel_generated.jpg`, `2k_umbriel_generated.jpg`, `2k_titania_generated.jpg`, `2k_oberon_generated.jpg` | Voyager-constrained on imaged terrain, extrapolated elsewhere: coronae and cliffs on Miranda; fault valleys on Ariel; dark Umbriel with a Wunda-like bright ring; canyons on Titania; dark cratered Oberon. See NASA's [Voyager 2 mission account](https://science.nasa.gov/mission/voyager/voyager-2/). |
| Neptune | `2k_triton_generated.jpg` | Voyager-constrained at large scale: pink/cream nitrogen ice, south-polar cap, dark geyser streaks and cantaloupe terrain. See NASA's [Triton approach sequence](https://science.nasa.gov/resource/color-sequence-of-triton-approach-images/) and [south-polar terrain](https://science.nasa.gov/photojournal/triton-south-polar-terrain/). |
| Asteroid belt | `2k_ceres_generated.jpg` | Dawn-constrained: low-albedo cratered terrain and Occator-like bright faculae. See NASA's [Ceres colour map](https://science.nasa.gov/resource/color-map-of-ceres-elliptical-projection/). |
| Pluto system | `2k_pluto_generated.jpg`, `2k_charon_generated.jpg` | New Horizons-constrained at large scale: Pluto's Tombaugh Regio/Sputnik Planitia and dark equatorial terrain; Charon's neutral ice, red north pole and canyon belt. See NASA's [Pluto and Charon image](https://science.nasa.gov/image-detail/pluto-and-charon-1920x640/) and [enhanced-colour Charon](https://science.nasa.gov/resource/charon-in-enhanced-color/). |
| Distant dwarf planets | `2k_eris_generated.jpg`, `2k_haumea_generated.jpg`, `2k_makemake_generated.jpg` | **Spectral/albedo inference only; geography is speculative.** Eris uses bright methane/nitrogen frost, Haumea neutral crystalline-water ice with a red albedo region, and Makemake reddish methane/ethane frost. See NASA's [Makemake](https://science.nasa.gov/dwarf-planets/makemake/), [Haumea](https://science.nasa.gov/dwarf-planets/haumea/), and [Webb trans-Neptunian composition results](https://science.nasa.gov/blogs/webb/2025/02/12/nasas-webb-reveals-the-ancient-surfaces-of-trans-neptunian-objects/). |
| Other trans-Neptunian objects | `2k_quaoar_generated.jpg`, `2k_gonggong_generated.jpg`, `2k_orcus_generated.jpg` | **Spectral/colour inference only; all geography is speculative.** Quaoar uses red-brown material and crystalline-water-ice exposures; Gonggong dark red organics with water ice; Orcus neutral/blue-grey water ice with subtle ammonia-bearing regions. Constraints come from [Quaoar spectroscopy](https://ntrs.nasa.gov/api/citations/20160003297/downloads/20160003297.pdf), [JWST observations of Gonggong and Quaoar](https://www.sciencedirect.com/science/article/am/pii/S0019103524000769), and [Orcus spectroscopy](https://arxiv.org/abs/1006.4962). |

The generated maps are appropriate for an educational visualisation at this scene's scale. They
must not be detached from this provenance note or presented as complete observed global maps.
