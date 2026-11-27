# Increment 5 Worker routes: local evidence

## Scope

This exercises the published six-card package using Wrangler's local R2 simulation. It does not write to the Cloudflare account or deploy the Worker. Local R2 objects persist under `worker/.wrangler/state/` between Wrangler commands.

## Reproduce

From the repository root:

```powershell
python scripts/prepare-increment-5-catalog.py
cd worker
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\seed-increment-5-local-r2.ps1
npx.cmd wrangler types
npx.cmd tsc --noEmit
npm.cmd test -- --run
npm.cmd run dev -- --local --ip 127.0.0.1 --port 8787
```

Keep `wrangler dev` running, open a second terminal in `worker/`, then run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-increment-5-local.ps1
```

The seed script always passes Wrangler's `--local` flag, writes all immutable objects first, the immutable manifest next and the mutable pointer last. The HTTP check renders every manifest entry, checks CORS and `no-store`, immediate-repeat exclusion, malformed `exclude`, blocked origin, unknown card version, portfolio/GitHub state isolation and the GitHub redirect/current-card path.

## Observed results (2026-11-27)

- Package: generation `published-demo-1`, manifest SHA-256 `c3c0352262eac9d9cb3b8ae5c0dc11ab6920cecb517e7e8d3312763cde14df2c`, 6 entries, 24 immutable scene/photo/observation objects totaling 3,974,780 bytes; plus the manifest and pointer (26 R2 objects total).
- Wrangler 4.168.0 loaded all 26 objects into local `webb-skyframe-bucket`. Local log-file permission warnings appeared because the sandbox blocks Wrangler's configured per-user log directory, but each upload reported `Upload complete` and the subsequent Worker read all dependencies successfully.
- `npx.cmd wrangler types` passed and regenerated the environment types for `PORTFOLIO_ORIGINS`. `npx.cmd tsc --noEmit` passed.
- `npm.cmd test -- --run` passed: 16 tests in 3 files. This includes route tests for singleton exclusion, configured CORS, empty catalog, blocked origin, unknown version, retired card and a missing dependency. The Cloudflare Vitest plugin printed its known sandbox static-analysis warning (`Access is denied` while scanning a parent directory); Vitest still ran the Worker runtime tests successfully.
- `npx.cmd tsc --noEmit -p test/tsconfig.json` passed for the test files.
- `check-increment-5-local.ps1` returned PASS. All six real card URLs returned HTTP 200 as self-contained `image/svg+xml` with embedded PNGs. Observed SVG sizes: 979,094; 804,882; 756,097; 811,562; 939,756; and 832,625 bytes.
- `/api/random` returned 200, `Access-Control-Allow-Origin: https://solmos.dev`, and `Cache-Control: no-store`. Excluding its returned ID selected another entry. Invalid exclude returned 400; unconfigured origin returned 403; an unknown card version returned 404.
- The smoke check confirmed `/api/random` left `/github/current.svg`'s ETag unchanged. `/github/next` returned 302 to `https://github.com/sebastianolmos`; the following `/github/current.svg` was a real catalog card, not a synthetic fixture.

The empty-catalog, retired-pair and missing-dependency errors were exercised with in-memory R2 test objects; the HTTP smoke check separately exercised all six actual local R2 entries.

## Relationship to production evidence

The six-entry manifest itself has no retired entries, so retirement behavior was tested with a focused in-memory catalog fixture. This report documents only local R2 behavior. The Worker deployment, remote R2 publication and portfolio integration were completed afterward; see [Worker production evidence](worker-production.md) and [portfolio evidence](portfolio-live.md). The owner accepted increment 5 after testing the final Spanish and English portfolio experience.
