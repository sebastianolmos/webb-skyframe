"""Run reproducibility and failure checks for the increment 4 real bundle."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from astropy.io import fits


ROOT = Path(__file__).resolve().parents[1]
FITS = ROOT / "jw09438007001_03103_00002_nrca3_cal.fits"
SOURCE_PNG = FITS.with_suffix(".png")
BUNDLE = ROOT / "docs/evidence/increment-4/real-bundle"
BUILDER = ROOT / "scripts/build-real-bundle.py"
RENDERER = ROOT / "scripts/render-real-card.cjs"
NODE = shutil.which("node") or "node"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str], *, label: str) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=False)
    if result.returncode not in (0, 1):
        raise RuntimeError(f"{label} returned unexpected exit code {result.returncode}: {result.stderr[-2000:]}")
    return result


def expect_failure(command: list[str], *, label: str, expected: str, no_pointer: Path | None = None) -> dict[str, object]:
    result = run(command, label=label)
    combined = result.stdout + "\n" + result.stderr
    if result.returncode == 0:
        raise AssertionError(f"{label} unexpectedly succeeded")
    if expected.casefold() not in combined.casefold():
        raise AssertionError(f"{label} failed for the wrong reason; expected {expected!r}: {combined[-3000:]}")
    if no_pointer is not None and (no_pointer / "observation.json").exists():
        raise AssertionError(f"{label} published an observation pointer after failure")
    return {"name": label, "status": "PASS", "expectedFailure": expected, "exitCode": result.returncode}


def member_snapshot() -> dict[str, str]:
    observation = json.loads((BUNDLE / "observation.json").read_text(encoding="utf-8"))
    paths = [Path("observation.json"), *(Path(key) for key in observation["members"])]
    return {str(key).replace("\\", "/"): sha256_file(BUNDLE / key) for key in paths}


def make_small_fits(path: Path, *, include_asdf: bool, invalid_science: bool = False) -> None:
    primary_header = fits.Header()
    primary_header["EXP_TYPE"] = "NRC_IMAGE"
    science = np.full((16, 16), np.nan if invalid_science else 1.0, dtype=np.float32)
    if invalid_science:
        with fits.open(FITS, memmap=True) as source:
            asdf_hdu = source["ASDF"].copy()
    else:
        asdf_hdu = None
    hdus = [
        fits.PrimaryHDU(header=primary_header),
        fits.ImageHDU(science, name="SCI"),
        fits.ImageHDU(np.zeros((16, 16), dtype=np.uint32), name="DQ"),
    ]
    if include_asdf:
        if asdf_hdu is None:
            raise AssertionError("Invalid-SCI fixture needs the calibrated ASDF WCS")
        hdus.append(asdf_hdu)
    fits.HDUList(hdus).writeto(path, output_verify="silentfix")


def main() -> None:
    if not FITS.is_file() or not SOURCE_PNG.is_file():
        raise FileNotFoundError("Step 8 needs the ignored real calibrated FITS and its PNG regression reference at the repository root")
    if not (BUNDLE / "horizons-inputs.json").is_file():
        raise FileNotFoundError("Step 8 needs the retained Horizons response snapshot")

    records: dict[str, object] = {
        "schemaVersion": "increment-4-acceptance-1",
        "runUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {"fits": FITS.name, "fitsSha256": sha256_file(FITS), "pngRegressionSha256": sha256_file(SOURCE_PNG)},
        "versions": {"python": sys.version.split()[0], "numpy": np.__version__, "astropy": __import__("astropy").__version__},
        "checks": [],
    }
    checks: list[dict[str, object]] = records["checks"]  # type: ignore[assignment]

    # The normal offline path must rebuild byte-identical dependencies from the retained snapshot.
    builder_command = [sys.executable, str(BUILDER), "--offline"]
    build1 = run(builder_command, label="first offline bundle build")
    if build1.returncode != 0:
        raise RuntimeError(f"First offline bundle build failed: {build1.stderr[-3000:]}")
    snapshot1 = member_snapshot()
    build2 = run(builder_command, label="second offline bundle build")
    if build2.returncode != 0:
        raise RuntimeError(f"Second offline bundle build failed: {build2.stderr[-3000:]}")
    snapshot2 = member_snapshot()
    if snapshot1 != snapshot2:
        changed = sorted(key for key in set(snapshot1) | set(snapshot2) if snapshot1.get(key) != snapshot2.get(key))
        raise AssertionError(f"Offline bundle rebuild was not byte-reproducible: {changed}")
    checks.append({"name": "offline rebuild is byte-reproducible", "status": "PASS", "members": len(snapshot2)})

    renderer_command = [NODE, str(RENDERER)]
    render1 = run(renderer_command, label="first offline card render")
    if render1.returncode != 0:
        raise RuntimeError(f"First offline card render failed: {render1.stderr[-3000:]}")
    receipt_path = BUNDLE / "render-receipt.json"
    receipt1 = json.loads(receipt_path.read_text(encoding="utf-8"))
    render2 = run(renderer_command, label="second offline card render")
    if render2.returncode != 0:
        raise RuntimeError(f"Second offline card render failed: {render2.stderr[-3000:]}")
    receipt2 = json.loads(receipt_path.read_text(encoding="utf-8"))
    if receipt1["svg"]["sha256"] != receipt2["svg"]["sha256"] or receipt1["png"]["sha256"] != receipt2["png"]["sha256"]:
        raise AssertionError("Offline card render changed bytes for unchanged inputs")
    if receipt2["bundleMemberDigests"] != json.loads((BUNDLE / "observation.json").read_text(encoding="utf-8"))["members"]:
        raise AssertionError("Rendered card receipt does not identify the current resolved bundle")
    checks.append({
        "name": "network-disabled render is byte-reproducible",
        "status": "PASS",
        "svgSha256": receipt2["svg"]["sha256"],
        "pngSha256": receipt2["png"]["sha256"],
        "browser": receipt2["browser"],
        "typescript": receipt2["renderer"],
    })

    failures: list[dict[str, object]] = []
    with tempfile.TemporaryDirectory(prefix="webb-skyframe-increment-4-") as temp_name:
        temp = Path(temp_name)

        missing_input_out = temp / "missing-input-out"
        failures.append(expect_failure(
            [sys.executable, str(BUILDER), "--offline", "--fits", str(temp / "absent.fits"), "--out", str(missing_input_out)],
            label="missing required FITS", expected="Local FITS not found", no_pointer=missing_input_out,
        ))

        missing_wcs = temp / "missing-asdf-wcs.fits"
        make_small_fits(missing_wcs, include_asdf=False)
        missing_wcs_out = temp / "missing-wcs-out"
        failures.append(expect_failure(
            [sys.executable, str(BUILDER), "--offline", "--fits", str(missing_wcs), "--source-png", str(temp / "absent.png"), "--out", str(missing_wcs_out)],
            label="missing calibrated GWCS", expected="missing readable ASDF metadata with its GWCS", no_pointer=missing_wcs_out,
        ))

        invalid_sci = temp / "invalid-sci.fits"
        make_small_fits(invalid_sci, include_asdf=True, invalid_science=True)
        invalid_sci_out = temp / "invalid-sci-out"
        failures.append(expect_failure(
            [sys.executable, str(BUILDER), "--offline", "--fits", str(invalid_sci), "--source-png", str(temp / "absent.png"), "--out", str(invalid_sci_out)],
            label="SCI has no usable pixels", expected="Too few finite usable SCI samples", no_pointer=invalid_sci_out,
        ))

        # Remove optional software-version tags only from a temporary FITS copy.
        # The reused snapshot is still scientifically identical; its identity digest
        # is updated only in this isolated test directory.
        optional_fits = temp / FITS.name
        shutil.copy2(FITS, optional_fits)
        with fits.open(optional_fits, mode="update", memmap=True) as hdus:
            for key in ("CAL_VER", "CRDS_CTX"):
                if key in hdus[0].header:
                    del hdus[0].header[key]
        optional_out = temp / "optional-metadata-out"
        optional_out.mkdir()
        optional_cache = json.loads((BUNDLE / "horizons-inputs.json").read_text(encoding="utf-8"))
        optional_cache["fitsSha256"] = sha256_file(optional_fits)
        (optional_out / "horizons-inputs.json").write_text(json.dumps(optional_cache, indent=2) + "\n", encoding="utf-8")
        optional_result = run([
            sys.executable, str(BUILDER), "--offline", "--fits", str(optional_fits),
            "--source-png", str(SOURCE_PNG), "--out", str(optional_out),
        ], label="optional metadata fallback")
        if optional_result.returncode != 0:
            raise RuntimeError(f"Optional metadata fallback failed: {optional_result.stderr[-3000:]}")
        optional_observation = json.loads((optional_out / "observation.json").read_text(encoding="utf-8"))
        if optional_observation["provenance"]["pipelineVersion"] != "unknown" or optional_observation["provenance"]["crdsContext"] != "unknown":
            raise AssertionError("Absent optional CAL_VER/CRDS_CTX metadata was not recorded as unknown")
        checks.append({"name": "absent optional software metadata is recorded as unknown", "status": "PASS", "fields": ["CAL_VER", "CRDS_CTX"]})

        missing_ephem_out = temp / "missing-ephemeris-out"
        missing_ephem_out.mkdir()
        incomplete_cache = json.loads((BUNDLE / "horizons-inputs.json").read_text(encoding="utf-8"))
        incomplete_cache["responses"]["webb"].pop()
        (missing_ephem_out / "horizons-inputs.json").write_text(json.dumps(incomplete_cache, indent=2) + "\n", encoding="utf-8")
        failures.append(expect_failure(
            [sys.executable, str(BUILDER), "--offline", "--fits", str(FITS), "--source-png", str(SOURCE_PNG), "--out", str(missing_ephem_out)],
            label="incomplete Webb ephemeris", expected="Cached Horizons response for target -170 is incomplete or unordered", no_pointer=missing_ephem_out,
        ))

        incomplete_bundle = temp / "incomplete-bundle"
        shutil.copytree(BUNDLE, incomplete_bundle)
        (incomplete_bundle / "real-card.svg").unlink(missing_ok=True)
        (incomplete_bundle / "real-card.png").unlink(missing_ok=True)
        (incomplete_bundle / "photo-1024.png").unlink()
        failures.append(expect_failure(
            [NODE, str(RENDERER), str(incomplete_bundle)], label="bundle missing embedded raster",
            expected="Missing bundle member: photo-1024.png", no_pointer=None,
        ))
        if (incomplete_bundle / "real-card.svg").exists() or (incomplete_bundle / "real-card.png").exists():
            raise AssertionError("Renderer wrote a card despite the missing raster dependency")

    checks.extend(failures)
    records["bundle"] = {"productId": receipt2["productId"], "members": snapshot2, "render": receipt2}
    records["summary"] = {"passed": len(checks), "failed": 0, "networkDisabledForBuildAndRender": True}
    evidence_path = ROOT / "docs/evidence/increment-4/acceptance.json"
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.write_text(json.dumps(records, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "checks": checks, "evidence": str(evidence_path.relative_to(ROOT))}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
