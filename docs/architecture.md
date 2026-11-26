# From archive product to public card

The collector owns the science record and published membership. The Worker owns the shared GitHub selection. Each portfolio tab owns its displayed ID. The pure renderer takes a resolved scene plus photo bytes and returns the complete card. This division lets both clients browse the same observations during archive downtime.

## Ingest sequence

1. Run the same Python collector locally or on a standard Linux GitHub Actions runner in the public repository. Start with manual dispatch. Later schedule bounded batches with a proposed 30 minutes/day work limit, a deadline and a single writer across dispatches and schedules. Coordinate local writes through the same writer or use isolated storage. Scheduled starts may drift or stop after repository inactivity.
2. Use astroquery.mast to query public JWST/NIRCam science images, enumerate product metadata, select filenames ending in `_cal.fits` and deduplicate dataURI. Scan newly public products by release time with overlapping pages/windows and a persisted high-water mark. Separately checkpoint historical windows through mission history, allowing random historical candidates. Random sampling alone gives no coverage guarantee.
3. Record source identity and archive revision or content digest. Skip completed product versions, including retired and rejected records. Detect reprocessed products even under the same URI. Download into temporary storage, validate instrument, EXP_TYPE=NRC_IMAGE, two-dimensional SCI, DQ compatibility and usable contrast. Apply the filter below at full resolution.
4. For accepted products, prepare a proportional PNG (initial maximum 1024 px on either side), WCS field, time, sky catalog subset and batched Horizons vectors. Record actual byte sizes, sources and versions. Validate the complete scene as specified in the [card contract](card-design.md). A missing required transform, credit or trajectory prevents publication.
5. Write immutable dependencies and read-check their keys, sizes and digests. Write a complete versioned manifest, then replace the small `catalog/published.json` pointer last. Readers resolve one generation per request. Journal individual outcomes and advance checkpoints only past durably accounted work, retaining pending retries. After interruption reconcile the pointer, journal and staged dependencies, resume idempotently, and reclaim unreferenced objects after grace.

Use Astropy for FITS, time and coordinates, NumPy for measurements, Pillow for PNGs and JWST data models/GWCS for calibrated transforms. Verify and pin a compatible set against a real file during implementation. Preserve product metadata and measurements with filter version. Separate transient download/service failures (bounded backoff with jitter, respect retry hints, retry later), technical omissions (reason and missing input), and visual rejection (thresholds and measured values). Reclassify stored metrics when possible. Local inspection may keep rejected PNGs and FITS. Archive URIs allow later refetch, with revision checks.

## Full-resolution selection

Use finite SCI pixels, clearing those with DQ bit 0 (DO_NOT_USE) set when DQ exists. Require at least 100 valid pixels. Compute p10 and p80 over valid values. The background mask includes valid values within these inclusive limits. Dispersion is the median absolute deviation from the median, without a Gaussian scale factor. Form masked row and column median profiles. Per axis, divide profile dispersion and median absolute adjacent-profile difference by background dispersion, ignoring masked differences. Round each score to four decimals. Zero denominator or missing usable differences yield unknown scores. Sum the two rounded jumps and round again to four decimals when both exist.

Use valid p1 and p99.7 as black and white points, rejecting degenerate contrast. Set invalid pixels to black. Clip the normalized pixel value x to [0,1], then truncate 255 × asinh(10x)/asinh(10) to uint8. Measure median rendered intensity over the original background mask and round to one decimal. Keep valid fraction (four decimals), both variations, both jumps, total and the historical stripes warning (total ≥0.19, unknown if total missing).

| Median background (0–255) | Eligibility |
|---|---|
| Finite, ≤45 | Pass even with an unknown jump |
| >45 and <90 | Pass only for finite total jump ≤0.10 |
| ≥90 or undefined | Reject |

Brightness 78 with jump 0.0783 passes. Brightness 77 with 0.1405 fails. The earlier stripes warning is diagnostic only. These thresholds encode the owner's impressions of 33 examples. Technical completeness still gates publication.

## Private R2 Standard layout

| Object | Owner and lifetime |
|---|---|
| `photos/<id>.png`, `observations/<id>.json` | Collector, immutable first revision. Changed bytes go under a revision prefix such as `revisions/<digest>/photos/<id>.png`. Manifests carry exact keys. |
| `sky/<revision>/…`, `orbits/<revision>/…` | Collector, shared licensed sky resources and timestamped series |
| `collector/checkpoints/…`, `collector/outcomes/…` | Collector, private progress, small processed and retired identities, reasons and metrics |
| `catalog/<generation>.json`, `catalog/published.json` | Collector, immutable active entries and mutable generation pointer |
| `state/github-current.svg` | Worker, one complete persistent rendered card including its ID and version. A bundled fallback ships in the Worker. |

A compact JSON registry suffices initially. Key each entry by product ID and include card version, observation/photo keys, shared references, alt text, actual bytes and first entry time. Derive the card version from all rendering inputs plus design revision. Keep unaffected card versions stable as catalog membership changes. Cache versioned responses for a bounded HTTP TTL. There is no default durable rendered archive per exposure.

## Visitor-click sequence and HTTP contract

Select uniformly with replacement across requests. Exclude the immediately displayed ID if alternatives exist. With one eligible ID return it even if excluded. With none, use the empty behavior below. Concurrent requests may select the same exposure. Clicks never remove entries.

| GET route | Handler and response |
|---|---|
| `/github/current.svg` | Read-only. Serve latest complete bytes or bundled empty-state SVG if uninitialized. Send image/svg+xml, Cache-Control: no-cache and a content-derived ETag. Return 304 only on a matching validator. |
| `/github/next` | GitHub-only interaction. Read current ID and catalog snapshot, draw, resolve dependencies and render. Validate complete SVG then atomically replace the single current object including ID/version. Respond 302 with Cache-Control: no-store to the fixed owner profile (https://github.com/sebastianolmos). Empty catalog or failed selection/render/write leaves the last valid image in place and returns to the profile. |
| `/api/random?exclude=<id>` | Portfolio selection only. Return JSON `{id,imageUrl,alt}` with a versioned card URL. Send no-store and allow configured portfolio origins for browser fetch, varying by Origin when reflected. Empty catalog returns 503 with an empty-catalog code. |
| `/cards/<version>/<id>.svg` | Resolve an eligible published ID/version from the registry, fetch packaged inputs and render on request. Return image/svg+xml and bounded public cache headers. Unknown/mismatched inputs return 404, known retired pairs return 410 on an origin lookup. Cached bytes may survive until expiry. Transient dependency faults return 503 without caching. |

**GitHub.** The README links the current image to Next. The Worker completes the write before redirecting. GitHub's proxy revalidates the mutable image on its own timetable. Concurrent writes resolve by last successful publish and each reader sees a whole object. A bot following the public GET can change the card. Measure actual Camo staleness and click-to-visible latency separately from Worker timings. [GitHub proxy behavior](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls)

**Portfolio.** The Hugo shortcode reserves the card's aspect ratio and provides a localized native button and image alt. Initialize each tab with its actually displayed ID. On Next, fetch using that ID, preload the returned image offscreen, then update visible image, alt and ID together only for the latest successful request. Disable overlapping activation or discard stale completions. If a selection retires during loading, request a fresh selection once (an image error may obscure HTTP status). Keep the previous card and report failure accessibly when exhausted. Preserve document URL, scroll and button focus. The Worker never writes GitHub state on this path.

Bound ID/version lengths and alphabet, validate membership before loading keys, escape all SVG text/attributes, restrict raster types and rate-limit costly routes. Upstream URLs and redirect destinations are controlled by the service. Private bucket binding for Worker reads and current-state writes, scoped collector write credentials in Actions secrets, no public admin routes or browser secrets.

## Retention, development and operating tests

Start with an adjustable **8 GB** active-storage target. Inventory actual bytes including shared resources, pending batches, previous generations, grace objects, current SVG and cleanup headroom. Cap batches before hard capacity is reached. If necessary retire FIFO by original catalog-entry time with ID as a stable tie-break. Publish the reduced generation first, wait a grace interval covering in-flight reads and manifest staleness, then recheck references from active, pending and grace manifests before deleting. Keep small outcomes to prevent immediate reingestion. The self-contained current card survives eviction. Defer ingest if cleanup cannot safely free enough space. A delayed batch should leave the previous catalog usable.

Develop the TypeScript renderer against local scene bundles, the Worker with Wrangler and local storage, and the collector against a local destination. Use native fetch, SVG templates, d3-geo and an explicit orbital projection. The Hugo shortcode belongs to the portfolio. Deployments of the Worker, collector workflow and portfolio are separate milestones. No visitor request starts a job, downloads a FITS or calls Horizons.

Benchmark Worker CPU, cold render, bytes per object/card, storage and operation counts on real traffic paths. Measure desktop/mobile rendering and GitHub proxy compatibility. If SVG embedding fails, test PNG rasterized from the same design, with matching MIME and URL. Consider bounded pre-rendering only if measured first-render cost requires it. Validate prices, limits, schedule reliability, sampling cadence and display thresholds during their respective increments. [R2 pricing](https://developers.cloudflare.com/r2/pricing/) · [Worker limits](https://developers.cloudflare.com/workers/platform/limits/)
