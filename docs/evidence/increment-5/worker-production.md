# Increment 5 Worker and catalog: production evidence

## Deployment

- Worker: `webb-skyframe-github-card`
- Public base URL: `https://webb-skyframe-github-card.sebastianolmos.workers.dev`
- Deployed Worker version: `e24d156b-913f-4b33-b49d-df3a871fa09c`
- Catalog generation: `published-demo-1`
- Manifest: `catalog/c3c0352262eac9d9cb3b8ae5c0dc11ab6920cecb517e7e8d3312763cde14df2c.json`
- Manifest SHA-256: `c3c0352262eac9d9cb3b8ae5c0dc11ab6920cecb517e7e8d3312763cde14df2c`

The remote publisher verified every uploaded object by reading it back and checking its byte count and SHA-256. It checked 26 objects totaling 3,985,930 bytes: 24 immutable observation/photo/sky/orbit dependencies, one immutable manifest and the mutable pointer. The pointer was written last. No remote objects were deleted.

## Live route checks (2026-11-27)

Requests were made against the public Worker, with `Origin: https://solmos.dev` where applicable.

| Check | Observed result |
|---|---|
| `GET /api/random` | 200 JSON, `Cache-Control: no-store`, `Access-Control-Allow-Origin: https://solmos.dev`; returned a catalog ID, versioned SVG URL and localized-ready alt text. |
| Fetch URL returned by `/api/random` | 200 `image/svg+xml`; self-contained rendered SVG. |
| Fetch each of six manifest card URLs | All six returned 200. |
| Unknown version/card pair | 404. |
| `GET /github/next` | 302 to `https://github.com/sebastianolmos`. |
| `GET /github/current.svg` after Next | 200 `image/svg+xml`. |

Reproduce the main selection and image request:

```powershell
$base = 'https://webb-skyframe-github-card.sebastianolmos.workers.dev'
curl.exe -i -H 'Origin: https://solmos.dev' "$base/api/random"
curl.exe -i -H 'Origin: https://solmos.dev' "$base/cards/<cardVersion>/<id>.svg"
```

For the six-card check, use the manifest at `docs/evidence/increment-5/catalog/manifests/c3c0352262eac9d9cb3b8ae5c0dc11ab6920cecb517e7e8d3312763cde14df2c.json` and request `https://webb-skyframe-github-card.sebastianolmos.workers.dev/cards/<cardVersion>/<id>.svg` for each entry.

## Boundary of this evidence

This confirms the Worker deployment and remote catalog publication. It does not confirm the Hugo page's browser interaction: the portfolio's `workerBaseURL` is still empty in its repository configuration, so its Next button remains intentionally disabled. Set that value to the Worker URL and deploy the portfolio site before checking independent tab selection, keyboard behavior, image-preload commit, focus and scroll preservation.
