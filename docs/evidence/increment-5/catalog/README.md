# Increment 5 local catalog package

This is the six-entry demonstration catalog prepared from the accepted increment-4 monthly bundles. It is a local publication package; it has **not** been uploaded to Cloudflare R2. Increment 6 remains responsible for ongoing discovery and scheduled ingestion.

Recreate it from the repository root with:

```powershell
python scripts/prepare-increment-5-catalog.py
```

The script checks the monthly acceptance record, the versioned visual-filter decision, the complete sky and orbit scenes, and every recorded source-bundle member size and SHA-256 digest before packaging. It writes four immutable objects per entry (observation JSON, PNG, sky JSON and orbit JSON), then a content-addressed six-entry manifest, then the small `published.json` pointer. The science observation JSON files remain unchanged; publication object keys, catalog versions and per-card versions live in the manifest.

The source months are January, April, May, June, July and August 2025. February, March and September candidates were visually rejected by `visual-filter-1` and are excluded. The catalog contains 24 immutable data objects totaling 3,974,780 bytes. Its logical generation is `published-demo-1`; the manifest's content digest is `c3c0352262eac9d9cb3b8ae5c0dc11ab6920cecb517e7e8d3312763cde14df2c`. The pointer stores these as separate values so the manifest does not need to contain its own hash. See `preparation-receipt.json`, `published.json` and `manifests/` for exact IDs, card versions, object keys and digests.

The worker-facing manifest records each observation's image, sky and orbit resource keys. The Worker adapter resolves those keys and passes the resulting real scene to the shared `renderCard` entry point. Local R2/Worker route evidence is in [worker-local.md](../worker-local.md); no remote publication has been made.
