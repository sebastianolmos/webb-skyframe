# Increment 5 portfolio integration: live evidence

Initial read-only snapshot checked: 2026-11-27, before the portfolio's final dynamic-initial-card update.

## Public page baseline before the final update

Read-only HTTP inspection of the published Hugo pages observed:

| Page | Result |
|---|---|
| `https://solmos.dev/projects/webb-skyframe/` | HTTP 200. Spanish widget markup names the production Worker, initial observation `jw06662007001_03101_00002_nrcblong_cal`, localized `Siguiente` labels and the image URL `/projects/webb-skyframe/card-initial.svg`. |
| `https://solmos.dev/en/projects/webb-skyframe/` | HTTP 200. English widget markup names the production Worker, the same initial observation, localized `Next` labels and `/en/projects/webb-skyframe/card-initial.svg`. |
| Spanish `card-initial.svg` | HTTP 200, `image/svg+xml`, 979,044 bytes, 1080x570. |
| Widget JavaScript | Loaded at `/js/webb-skyframe.min.8496a3753cebe1885d444cc2157bfd4e28c018422cb645530c8489951bf78671.js`; SHA-256 matches the fingerprint in its filename. |

The deployed script was inspected. Each widget instance keeps its displayed ID and request sequence locally. Next requests `/api/random?exclude=<displayed-id>`, validates the returned same-origin, versioned card URL, preloads the SVG in an offscreen `Image`, and updates `src`, `alt` and the displayed ID together only when that request remains the newest. If loading a selected SVG fails, it retries selection once while excluding the failed selection. Errors are placed in the widget's `aria-live` status. The portfolio path does not call `/github/next` or write GitHub's shared current-card object.

At this checkpoint the owner reported that Next worked on `solmos.dev`. Separately, the Worker `/api/random` endpoint was confirmed live with the portfolio CORS origin; all six deployed versioned card URLs returned HTTP 200 in [Worker production evidence](worker-production.md).

An additional live read-only check made two consecutive `/api/random` requests, passing the first ID as `exclude` to the second. The returned IDs differed. The ETag of `/github/current.svg` was identical before and after a portfolio selection request, confirming this route did not mutate the shared GitHub card during the check.

## Owner's final acceptance (2026-11-27)

After this baseline inspection, the owner updated and deployed the portfolio so the initial observation is dynamically selected from the Worker catalog. The owner reports that the completed behavior works and has been tested on `solmos.dev` in both Spanish and English, and explicitly accepts increment 5 as complete. This includes the dynamic initial card and subsequent Next interaction.

The browser automation bridge was unavailable to this agent, so this final interaction evidence is explicitly owner-reported rather than independently captured here. The owner acceptance is the completion signal for the interaction checks.

The live catalog has six entries, so the deployed UI cannot naturally exercise singleton/empty catalogs or retired-card responses. Those Worker outcomes are covered by local route tests and in-memory fixtures recorded in [worker-local.md](worker-local.md).
