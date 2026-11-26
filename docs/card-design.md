# Card design and observation contract

Build a 1080 × 570 SVG with a dark ground. The references leave roughly 16 px outer margins, a 540 × 538 photo area on the left and two panels about 476 × 260 on the right. Fit the entire monochrome exposure proportionally within the left area. Letterbox as needed. Overlay a dark date band with the middle-exposure UTC date. Put the field-center constellation name over the sky panel and the location caption over the orbital panel. Use English labels, strong contrast, simple vector symbols and system font fallbacks.

| Reference in this checkout | Relationship to reproduce |
|---|---|
| [March](../march_loc.png) | Galaxy field, tilted purple sky footprint and Earth near the bottom of the white orbit |
| [July](../july_loc.png) | Bright filamentary image, single sky map and Earth near the right edge |
| [November](../nov_loc.png) | Dense star field, rotated footprint and Earth above the Sun |
| [July detail](../july_loc_zoom.png) | Same date and orbit as July, with two framed maps and a connector |

All four are illustrative. Keep the existing root paths while the assets live there. The intended permanent asset directory is `docs/mockups/`. Production uses measured positions even when a month label differs from a sketch.

## Evidence in the checkout

`probar_webb.py` defines `leer_exposicion(ruta, uri)`. It merges primary and SCI headers, checks NRC_IMAGE, position, pointing and SCI validity, and returns a full-resolution Pillow image and metadata dictionary. The driver shuffles public science observations in its fixed 2025-01-01 to 2026-02-01 search interval, samples up to 20, deduplicates product URIs within the run and saves FITS downloads and successful PNG/JSON pairs in `salida_webb_exp_2`. It stops after one successful product per sampled observation. The save loop has no brightness eligibility gate. Its Earth-relative estimate subtracts an Astropy Earth barycentric vector at the elapsed midpoint from header Webb XYZ, whose epoch is recorded separately.

`recalcular_metricas_webb.py` imports that reader, opens existing JSON and sibling FITS in `salida_webb`, rebuilds the PNG in memory and atomically replaces only the metrics in the JSON. Other fields, including any pre-existing eligibility decision, can therefore describe an earlier pass. The optional `webb_aptas_con_descartes.py` is absent. The scratch JSON contains an acceptance flag of unknown authorship.

| Scratch keys (within the indicated object) | Future meaning |
|---|---|
| archivo, uri_mast, telescopio, instrumento, detector, filtro, pupila, objetivo_catalogado, programa | product.file, uri, mission, instrument, detector, filter, pupil, target, program. Derive ID from the product basename. |
| exposicion_inicio_utc, instante_medio_usado_utc, exposicion_fin_utc | time.begin, middle, end. Reader uses elapsed midpoint. |
| posicion_webb.xyz_baricentrico_km_del_fits, marco_de_efemerides_del_fits, epoca_de_efemerides_mjd_del_fits, tipo_de_efemerides_del_fits | fitsOrbit.xyz, frame, epochMjd, type. Carry the original time basis separately when verified. |
| xyz_desde_centro_tierra_km_aprox, distancia_al_centro_tierra_km_aprox (in posicion_webb) | Legacy approximate diagnostics. Do not feed these to the common-epoch orbital scene. |
| apuntado_punto_de_referencia.ascension_recta_grados, declinacion_grados, coordenadas_legibles, constelacion | sky.reference and legacy formatted reference label/region. Derive the displayed center and region independently with GWCS. |
| metricas_visuales.fraccion_pixeles_validos, variacion_entre_filas, variacion_entre_columnas | metrics.validFraction, rowVariation, columnVariation |
| salto_entre_filas_vecinas, salto_entre_columnas_vecinas, brillo_mediano_fondo_png, salto_total, revisar_por_franjas (in metricas_visuales) | metrics.rowJump, columnJump, brightness, totalJump, stripesWarning |
| apta_para_readme | Legacy acceptance. Re-evaluate versioned eligibility independently. |

The local FITS, PNG and scratch JSON share the basename `jw09438007001_03103_00002_nrca3_cal`. The FITS identifies an NRC_IMAGE exposure of crowded_l20 from program 09438, with NRCA3/F140M/CLEAR, calibration version 3.0.0 and CRDS context `jwst_1584.pmap`. Its SCI and DQ arrays are both 2048 × 2048. Applying the documented mask and stretch to SCI reproduced all 4,194,304 pixels of the supplied 8-bit grayscale PNG in detector row order. The valid fraction rounds to 0.9850. This full-resolution pair provides a regression reference for increment 4, before the planned reduction to 1024 pixels.

The JSON records an elapsed midpoint of 2025-09-17T06:06:28.396 UTC, reference point (276.872660806°, −11.480048777°) in Scutum, brightness 5.0 and total jump 0.146, which passes the visual filter. The FITS supplies EXPMID = 60935.25449532407 MJD. Its separate EPH_TIME has the same numeric value, with REFFRAME = EME2000 and EPH_TYPE = Definitive. Verification of the ephemeris time scale, evaluation of the calibrated WCS center and corners, and acquisition of the sky subset and Horizons tracks remain part of the integration increment.

## Preload field dictionary

A published observation resolves every required (R) field and resource below. Optional (O) values may be null or absent. Finite JSON numbers only. Ordered pairs and triples are arrays. Immutable resource keys are resolved by the host against the selected manifest before calling the renderer. Record the exact producer versions and digests used to rebuild a bundle.

| Field | Type, units and requirement | Source → consumer |
|---|---|---|
| versions.schema / data / render / filter / catalog | R strings for structure, input revision, design, selection and sky data release | builder → validators, manifest, renderer. Published membership generation is separately versioned. |
| product.id / uri / file / program / mission / instrument | R strings, program preserves leading zeros | MAST and FITS → registry, attribution and labels |
| product.target / detector / filter / pupil | O strings | FITS → alt and provenance |
| provenance | R object with source revision or digest, processor versions and credit string, O program/team/DOI links | archive and collector → audit and credits |
| time.begin / middle / end / method | R ISO UTC strings ending Z and method string | headers and Astropy → date, epoch and reproducibility |
| fitsOrbit.xyz / frame / epochMjd / epochScale / type | O km triple, string, MJD days, string, string | JWST_X/Y/Z, REFFRAME, EPH_TIME, documented scale and EPH_TYPE → independent barycentric provenance |
| image.key / format / size / sourceSize / mapping / stretch | R key, MIME, [width,height] pairs in pixels, mapping and algorithm revision strings | SCI, DQ and Pillow → raster embedding and WCS validation |
| metrics.validFraction / rowVariation / columnVariation / rowJump / columnJump / totalJump | R measurement slots, dimensionless numbers (null for undefined profile scores) | native SCI background → filter and audit |
| metrics.brightness / stripesWarning / accepted | R median uint8 intensity (nullable in outcomes), nullable boolean, boolean | normalized PNG and filter → registry and audit |
| sky.center / corners / reference | R pair, R four perimeter-ordered pairs, O RA_REF/DEC_REF pair, ICRS degrees | calibrated GWCS and headers → sky projection, pointing, cross-check |
| sky.region / abbreviation / figureKey / starsKey | R strings | official field-center region lookup, audited line and magnitude catalogs → title, overview and credits |
| sky.detail.center / size / corners | R ICRS pair, [width,height] angular degrees, four ICRS pairs | tangent-plane fit and inverse transform → detail and overview outline |
| sky.detail.stars / segments | R arrays, optionally empty. Stars [RA°,Dec°,apparent magnitude], segments [[RA°,Dec°],[RA°,Dec°]] | catalog subset → detail. Record magnitude band in catalog metadata. |
| orbit.epochJdTdb / source / frame / unit | R number (JD TDB) and strings | converted middle and checked Horizons response → orbital scene validation |
| orbit.sun / earth / moon / webb / l2 / l2Method | R heliocentric km triples in ecliptic J2000 and method string | common-epoch geometric vectors and approximation → marker anchors |
| orbit.basis / pointing | R three unit triples [R,T,N] and one unit triple in ecliptic J2000 | Earth state and rotated ICRS direction → local curves and direction glyph |
| orbit.tracks | R object with earth, moon and webb immutable series keys | collector → resolved local scene |

**Illustrative synthetic preload.** Every value below is a fixture value, including times, positions, credits and resource identifiers. The keys illustrate references within a synthetic bundle.

```json
{
  "versions": {"schema":"1","data":"fixture-1","render":"1","filter":"1","catalog":"toy-1"},
  "product": {"id":"toy-a","uri":"fixture:toy-a","file":"toy-a_cal.fits","program":"00000","mission":"JWST","instrument":"NIRCAM","target":null,"detector":null,"filter":null,"pupil":null},
  "provenance":{"sourceRevision":"toy-a-1","processors":{"generator":"fixture-1"},"credit":"Synthetic demonstration"},
  "time":{"begin":"2025-01-01T00:00:00Z","middle":"2025-01-01T00:01:00Z","end":"2025-01-01T00:02:00Z","method":"elapsed-midpoint"},
  "fitsOrbit":null,
  "image":{"key":"photos/toy-a.png","format":"image/png","size":[256,256],"sourceSize":[512,512],"mapping":"full-frame-unflipped","stretch":"p1-p99.7-asinh10-v1"},
  "metrics":{"validFraction":1,"rowVariation":0.1,"columnVariation":0.1,"rowJump":0.01,"columnJump":0.02,"totalJump":0.03,"brightness":32,"stripesWarning":false,"accepted":true},
  "sky":{"center":[0,0],"corners":[[0.05,0.05],[359.95,0.05],[359.95,-0.05],[0.05,-0.05]],"reference":null,"region":"Fixture region","abbreviation":"Toy","figureKey":"sky/toy-1/figure","starsKey":"sky/toy-1/stars","detail":{"center":[0,0],"size":[0.36,0.3],"corners":[[0.18,0.15],[359.82,0.15],[359.82,-0.15],[0.18,-0.15]],"stars":[],"segments":[]}},
  "orbit":{"epochJdTdb":2460676.501495,"source":"synthetic","frame":"heliocentric-ecliptic-J2000","unit":"km","sun":[0,0,0],"earth":[150000000,0,0],"moon":[150380000,0,0],"l2":[151500000,0,0],"l2Method":"radial-1500000-km","webb":[151510000,100000,30000],"basis":[[1,0,0],[0,1,0],[0,0,1]],"pointing":[1,0,0],"tracks":{"earth":"orbits/toy-1/year","moon":"orbits/toy-1/lunation","webb":"orbits/toy-1/half-year"}}
}
```

## Time, image and sky construction

Prefer valid MJD-MID, then EXPMID in the product's documented time system, converting to UTC. Check finiteness, begin ≤ middle ≤ end and header semantics. Otherwise compute begin + half the elapsed interval with a time library and record the method. Preserve original header values and time keys for audit. EPH_TIME has its own epoch and scale, to be verified from the applicable product definition. [JWST time definitions](https://jwst-docs.stsci.edu/accessing-jwst-data/jwst-science-data-overview/jwst-etc-time-definitions)

Evaluate model.meta.wcs on the calibrated detector grid, x = column, y = SCI row, zero-based pixel centers. For width W and height H use ((W−1)/2,(H−1)/2) and the ordered boundary vertices (−0.5,−0.5), (W−0.5,−0.5), (W−0.5,H−0.5), (−0.5,H−0.5) subject to the calibrated bounding box. Validate finite support there and record actual bounds if a valid subregion is used. No implicit FITS display flip. Full-frame reduction preserves angular footprint. For any future crop/flip, store the explicit displayed-to-detector transform and recompute displayed center and corners. [JWST calibrated WCS](https://jwst-pipeline.readthedocs.io/en/stable/jwst/assign_wcs/main.html)

Classify the center by official constellation region (record boundary implementation/version). The conventional stick figure is a separate dataset. Shared sky resources carry immutable key, release/digest, source file and upstream attribution/license, frame/equinox, epoch, magnitude band and any coordinate conversion. Store stars as ICRS RA/Dec degrees and magnitude, and stick edges as ordered sky endpoints or stable star ID pairs. Normalize RA to [0,360), Dec to [−90,90]. Convert source longitudes explicitly. Audit each adopted D3-Celestial file and its upstream catalog separately from the library license. [Candidate data](https://github.com/ofrohn/d3-celestial) · [D3 geographic paths](https://d3js.org/d3-geo/path)

Construct the north-up, east-left gnomonic detail window at field center. Use local east/north axes and fix the roll convention at a pole using the recorded central RA. Fit the footprint's projected width and height to about one third of the detail rectangle on its limiting axis, preserving panel aspect. Record center, angular spans through center and inverse-projected screen corners in top-left clockwise order. Clip great-circle line segments against the window even when both endpoints are outside. Draw only catalog stars. A sparse detail may legitimately show just the field and scale bar.

First fit a hypothetical single overview around the union of the stick figure and field. Use a spherical projection centered on that union (e.g. stereographic), with local north up and east left. Project edges on the sphere across RA zero, resampling as needed. Measure the shorter side of the minimum-area oriented bounding rectangle of the projected field. At a proposed reference width of **540 CSS px** (half the SVG base), use single-map true scale if that side is ≥12 display pixels. This configurable visual cutoff belongs to the render version. A static GitHub SVG makes one decision per exposure and layout.

Otherwise fit the overview to the figure, footprint and detail-window outline on the left, link left to right and draw the aligned detail on the right. Use the actual inverse-projected window polygon for the outline and the detector polygon for the purple fill. When subpixel, add a distinct locator labeled as symbolic. Compute the scale bar from inverse projection at its drawn location. Include outside-figure targets in the fit. Test wrap and polar geometry in spherical coordinates.

## Orbital scene

At the chosen middle instant convert UTC to TDB. Request geometric Horizons vectors (no light-time or aberration correction), Sun center, J2000 ecliptic axes, km and km/s, Earth center, Moon center and spacecraft at the identical epoch. Check returned target, center, axes, timescale, units, coverage and epochs. Store a zero Sun and approximate L2 = earth + 1,500,000 km × normalize(earth). Label this radial estimate. Preserve the independent barycentric header record. Rotate the field's ICRS unit vector into J2000 ecliptic axes with a documented rotation only, without observer translation or parallax. Missing spacecraft coverage leaves a technical omission. [JWST orbit](https://jwst-docs.stsci.edu/jwst-observatory-characteristics/jwst-orbit) · [Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html)

Each shared series has key/revision, source/query, center, frame, basis, km units, time scale, validity interval, cadence and sorted samples [JD TDB,x,y,z]. Batch neighboring epochs and reuse immutable intervals. Earth uses a heliocentric year with anchors at actual calendar dates. Moon uses Moon minus Earth over roughly a lunar revolution in fixed ecliptic axes. For Webb use about six months of Webb minus radial L2. At **each sample epoch**, compute R = unit(earth), N = unit(earth × earthVelocity), T = N × R. Store [offset·R,offset·T,offset·N]. Reconstruct each offset in the exposure-time basis as aR + bT + cN at the exposure's L2. Merge exact exposure-epoch samples into each resolved series from the preload state, preserving chronological order. Draw the historical polyline open. Limit interpolation to validated intervals and accuracy, with no extrapolation across coverage gaps.

Use a fixed orthographic oblique camera looking at the Sun. For a reproducible initial orientation, take horizontal axis U along the ecliptic-plane projection of Earth's July 1 2025 vector, P = ecliptic north × U, vertical-up V = sin(25°)P + cos(25°)north. Map q to (q·U, −q·V) in screen coordinates. Freeze U with its measured source or a labeled synthetic reference in the fixture. Check March below, July right and November above without rotating the camera per exposure. Fit the white Earth track with margin and a yellow Sun. Place green Earth at its physical anchor. Apply one labeled local magnification M to *all* Earth-relative offsets, e.g. draw Webb at earth + M(webb−earth). Use the same M on the cyan Moon track and gray Moon, pale orange antisolar link, L2 dot and Webb track. Anchor the Webb icon and purple pointing wedge there. State the local factor in the legend.

Project the unit pointing vector onto U,V. A triangle indicates direction with illustrative opening angle. When projected length falls below a documented render tolerance, use dot/cross toward/away according to its signed component on U × V. Move labels or offset icons with leaders on conjunctions and near edges, reserve margins or provide local detail. Keep true marker anchors on their tracks. Real Moon and Webb phases come from vectors.

The host resolves photo and shared keys into a scene before rendering. The pure renderer returns one script-free self-contained SVG with embedded PNG, vector shapes, title/description and text, with no external fonts or fetches. In HTML provide descriptive alt (date, field, detector/filter where known), accessible Next and status feedback. Validate size, MIME, keyboard interaction, proxy display and mobile legibility using the [increment checks](increments.md).
