"""Package the six accepted increment-4 bundles as an immutable demo catalog.

This prepares local publication inputs only. It does not write to Cloudflare R2;
the Worker catalog routes and remote publication are subsequent increment-5 work.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
COVERAGE = ROOT / "docs/evidence/increment-4/monthly-exposures/monthly-coverage.json"
DEFAULT_OUTPUT = ROOT / "docs/evidence/increment-5/catalog"
EXPECTED_MONTHS = ("2025-01", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08")
CATALOG_VERSION = "published-demo-1"
SCHEMA_VERSION = "real-exposure-1"
RENDER_VERSION = "real-card-1"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")


def alt_text(observation: dict) -> str:
    product = observation["product"]
    sky = observation["sky"]
    target = product.get("target") or "unnamed field"
    region = sky["region"]
    date = observation["time"]["middle"][:10]
    return (f"James Webb Space Telescope NIRCam exposure of {target} on {date}; "
            f"{product.get('detector', 'unknown detector')} {product.get('filter', 'unknown filter')}, "
            f"in {region}, with Webb's position at exposure midpoint.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or ROOT not in output.parents:
        raise ValueError(f"Output must be a child of the repository: {output}")

    coverage = read_json(COVERAGE)
    accepted = {
        exposure["month"]: exposure
        for exposure in coverage["exposures"]
        if exposure.get("visualDecision", {}).get("accepted") is True
    }
    missing = [month for month in EXPECTED_MONTHS if month not in accepted]
    if missing:
        raise ValueError(f"Expected accepted increment-4 entries are missing: {', '.join(missing)}")

    entries = []
    objects: dict[str, bytes] = {}
    source_records = []
    for month in EXPECTED_MONTHS:
        record = accepted[month]
        bundle = ROOT / record["bundle"]
        observation_path = bundle / "observation.json"
        sky_path = bundle / "sky.json"
        orbit_path = bundle / "orbit.json"
        observation = read_json(observation_path)
        sky = read_json(sky_path)
        orbit = read_json(orbit_path)
        product_id = observation["product"]["id"]
        if observation["versions"].get("filter") != "visual-filter-1":
            raise ValueError(f"{product_id}: unexpected filter version")
        if observation["metrics"].get("accepted") is not True or observation["metrics"].get("eligibilityApplied") is not True:
            raise ValueError(f"{product_id}: observation is not explicitly accepted")
        if observation.get("schemaVersion") != SCHEMA_VERSION:
            raise ValueError(f"{product_id}: unsupported observation schema")
        if sky.get("schemaVersion") != "resolved-sky-1" or orbit.get("schemaVersion") != "resolved-orbit-1":
            raise ValueError(f"{product_id}: missing resolved sky/orbit bundle")
        if not sky.get("scene", {}).get("figureStars") or not orbit.get("scene", {}).get("webbTrack"):
            raise ValueError(f"{product_id}: required sky or spacecraft scene data is empty")

        source_members = observation.get("members")
        if not isinstance(source_members, dict) or not source_members:
            raise ValueError(f"{product_id}: bundle has no member digest table")
        for relative_key, expected in source_members.items():
            source = (bundle / relative_key).resolve()
            if bundle.resolve() not in source.parents:
                raise ValueError(f"{product_id}: unsafe bundle member path {relative_key!r}")
            payload = source.read_bytes()
            actual_digest = digest(payload)
            if len(payload) != expected["bytes"] or actual_digest != expected["sha256"]:
                raise ValueError(f"{product_id}: bundle member digest mismatch: {relative_key}")

        source_paths = {
            "observation": observation_path,
            "photo": bundle / observation["image"]["key"],
            "sky": sky_path,
            "orbit": orbit_path,
        }
        hashes = {}
        object_keys = {}
        for kind, path in source_paths.items():
            payload = path.read_bytes()
            sha = digest(payload)
            key = f"{kind}/{product_id}/{sha}/{path.name}"
            objects[key] = payload
            object_keys[kind] = key
            hashes[kind] = {"bytes": len(payload), "sha256": sha}

        card_basis = json.dumps(
            {"render": RENDER_VERSION, "observation": hashes["observation"]["sha256"],
             "photo": hashes["photo"]["sha256"], "sky": hashes["sky"]["sha256"],
             "orbit": hashes["orbit"]["sha256"]},
            sort_keys=True, separators=(",", ":"),
        ).encode("utf-8")
        card_version = digest(card_basis)
        entries.append({
            "id": product_id,
            "cardVersion": card_version,
            "versions": {"schema": SCHEMA_VERSION, "data": observation["versions"]["data"],
                         "render": RENDER_VERSION, "filter": "visual-filter-1", "catalog": CATALOG_VERSION},
            "objectKeys": object_keys,
            "digests": hashes,
            "alt": alt_text(observation),
            "entryTime": observation["time"]["middle"],
            "sourceMonth": month,
        })
        source_records.append({"month": month, "id": product_id, "sourceBundle": record["bundle"],
                               "sourcePngSha256": record["render"]["sourcePhoto"]["sha256"],
                               "cardVersion": card_version})

    catalog_body = {"schemaVersion": "published-catalog-1", "generation": CATALOG_VERSION,
                    "renderVersion": RENDER_VERSION, "entries": entries}
    catalog_bytes = (json.dumps(catalog_body, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
    manifest_sha256 = digest(catalog_bytes)
    manifest_key = f"catalog/{manifest_sha256}.json"
    pointer = {"schemaVersion": "published-pointer-1", "generation": CATALOG_VERSION,
               "manifestKey": manifest_key, "manifestSha256": manifest_sha256}

    output.mkdir(parents=True, exist_ok=True)
    for key, payload in objects.items():
        destination = output / "objects" / key
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)
    manifest_path = output / "manifests" / f"{manifest_sha256}.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_bytes(catalog_bytes)
    # The mutable pointer is deliberately the final write in this preparation run.
    write_json(output / "published.json", pointer)
    write_json(output / "preparation-receipt.json", {
        "result": "PASS", "mode": "local publication package; no remote R2 writes",
        "catalogGeneration": CATALOG_VERSION, "manifestSha256": manifest_sha256, "manifestKey": manifest_key,
        "entryCount": len(entries), "entries": source_records,
        "objectCount": len(objects), "objectBytes": sum(map(len, objects.values())),
    })
    print(json.dumps({"result": "PASS", "catalogGeneration": CATALOG_VERSION, "manifestSha256": manifest_sha256,
                      "entryCount": len(entries), "objectCount": len(objects),
                      "objectBytes": sum(map(len, objects.values())), "output": str(output)}, indent=2))


if __name__ == "__main__":
    main()
