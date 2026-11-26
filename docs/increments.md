# Seven vertical increments

All seven are planned. The checkout contains design references and experimental collector evidence. Each demonstration below describes a future runnable outcome. Add its exact tested command to the [README](../README.md) when the slice works.

## 1. Local orbital playground

**Depends on** the [scene and camera contract](card-design.md) and three seasonal references. Build a pure TypeScript orbital renderer and a local HTML view. Both the controls and the later headless card call the same renderer with resolved scene vectors and tracks. Label the view synthetic. Provide March, July and November presets and reset to the selected preset.

| Controlled concept | Labeled range inputs with live values |
|---|---|
| Earth annual phase | 0–360° around the synthetic solar track |
| Moon geocentric phase | 0–360° around Earth |
| Webb phase around L2 | 0–360° around the synthetic local track |
| Webb pointing direction | Ecliptic longitude 0–360° **and** latitude −90 to +90° |

**Demonstrate** by launching the local playground, selecting a preset and adjusting each of the five native keyboard-operable sliders. Convert longitude λ and latitude β to (cos β cos λ, cos β sin λ, sin β), converting degrees to radians first. Regenerate synthetic vectors/tracks on input and redraw live without NASA or cloud access. Earth carries its local system, Moon phase moves the Moon, Webb phase moves the telescope, and pointing alone changes only the direction indicator.

**Accept** after sweeping full phases and endpoints, cardinal directions, high latitudes and nearly camera-aligned directions in both senses. Check apparent conjunctions and labels at panel edges at desktop and mobile reference widths. Confirm the locally magnified anchors stay on their curves, symbols remain in view, labels are legible, keyboard focus persists and reset reproduces the preset. Capture representative configurations for visual regression. A slider that drags the wrong body, a flattened 3D direction or a clipped marker fails this slice.

## 2. Two cards through the real GitHub profile

**Depends on** the local renderer plus a private R2 Standard bucket, Worker binding and an authorized profile test. Package visibly distinct A/B fixtures with sample raster, provisional sky and orbital panel. Implement the shared current image and Next routes from the [HTTP contract](architecture.md). Publish each replacement as a complete self-contained object.

**Demonstrate** by embedding current.svg and linking Next on a real README, alternating A and B through Camo on desktop and mobile. Exercise two visitors and overlapping clicks. Record response MIME, validator changes, revalidation, uncached redirect, backend latency, cold CPU, payload bytes and click-to-visible timings.

**Accept** when reads do not mutate, readers see complete cards, last successful write wins and empty storage serves the bundle. Inject a render/write failure and confirm the prior valid card survives. Compare origin and proxied responses for stale images. Decide SVG compatibility or a same-design PNG fallback using the evidence.

## 3. Celestial panel and double zoom

**Depends on** the card layout and versioned synthetic sky subsets. Replace the provisional panel with the fitted overview, threshold decision, calibrated detail window and connector.

**Demonstrate** by rendering the same card fixture with large, tiny and rotated fields, crossing RA=0°, near a pole and outside the stick figure. Include an empty/sparse detail and a segment passing through it with both endpoints outside.

**Accept** when the reference-width cutoff changes mode at the rotation-aware short dimension, north/east and footprint orientation agree, the inverse-projected detail outline maps back onto the overview, and scale bar distances check against sky coordinates. Inspect both sides of the threshold. A wraparound stroke across the panel, lost crossing segment or invented star fails.

## 4. One complete real exposure locally

**Depends on** both panels, one eligible public calibrated FITS, compatible pinned Python tools, audited sky files and Horizons coverage. Add native-resolution metrics, PNG reduction, versioned observation JSON, GWCS center/corners, shared trajectories and scene resolution. Preserve original-file identity, time choices, query metadata, units and credits.

**Demonstrate** by processing one accepted product locally, then rendering the integrated card offline from its bundle. Compare pixel center and ordered detector corners against GWCS, reference point separately, UTC middle versus query TDB, position units, origins and axes against returned metadata. Check antisolar L2, local scale, exact Webb anchor on its reconstructed track and near-line-of-sight glyphs (use a controlled direction test if needed).

**Accept** after inspecting the raster, sky and orbit together and reproducing the output from recorded inputs. Extend to three different exposure months as available and record coverage. Exercise invalid SCI, missing WCS, absent optional metadata and missing ephemerides. Record omissions explicitly and withhold incomplete scenes.

## 5. Published catalog and Hugo portfolio

**Depends on** versioned real bundles, the Worker and the bilingual portfolio. Publish a small catalog, implement random selection and versioned card routes, and mount the Hugo shortcode with per-tab state and offscreen image preload. Both clients use the same renderer.

**Demonstrate** on a scrolled project page in two tabs. Use keyboard Next, check the displayed ID, alt and image after loading, then confirm the URL, scroll position and button focus. Change one tab and check the other tab and GitHub selection.

**Accept** when multiple entries avoid immediate repeats, singleton selection succeeds, empty selection is reported, independent requests draw with replacement and rapid clicks cannot apply stale results. Simulate selection and image failures, a retired URL and a failed retry. Retain the previous card throughout failure and retry selection at most once for a lost image.

## 6. Scheduled ingest and incremental publication

**Depends on** a working local collector, manifest validation and private scoped credentials. Add release-time overlap, independent historical coverage, persistent checkpoints, product/version deduplication, bounded retry and one active publishing writer. Publish assets, immutable manifest and pointer in order.

**Demonstrate** the same bounded batch locally, then by manual dispatch on a standard Linux Actions runner, then on a schedule. Compare accepted, visually rejected and technically omitted outcomes. Interrupt between object write and publication, resume, replay an overlap containing a late release and reprocess a genuinely revised product.

**Accept** when every published entry resolves, outcomes prevent duplicate processing, and retryable upstream failures survive an interrupted run. Disable or delay the schedule, simulate upstream downtime and browse the last catalog successfully. Verify a click produces no Actions run.

## 7. Retention and operational limits

**Depends on** working ingest, retired records, real byte counts and measured route behavior. Implement byte-budget FIFO retirement, grace-period cleanup and shared-reference checks. Add scoped rate limits and a repeatable recovery procedure.

**Demonstrate** by forcing a small budget locally with two entries sharing a trajectory. Keep an old selection in flight, retire by entry time, publish the reduced manifest, interrupt cleanup and resume after grace. Exercise a retired card URL, a cached copy, catalog exhaustion and rate limiting.

**Accept** when byte accounting includes pending/grace and shared objects, referenced dependencies survive, the durable GitHub current card remains readable and retirement avoids immediate reingest. Verify stable origin retirement responses and bounded retries. Measure Worker CPU, cold latency, storage, requests, cache behavior, card bytes and proxy latency against current service terms. Record repeatable local tests and recovery steps for a failed batch, interrupted cleanup and stale proxy before choosing budget, schedule or pre-rendering changes.
