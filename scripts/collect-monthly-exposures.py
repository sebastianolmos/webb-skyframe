"""Find, download, validate and render real public JWST/NIRCam exposures by month.

This is an explicit one-off acceptance collector, not a scheduled ingest job.
MAST discovery/download and Horizons verification happen here, before rendering.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from astropy.io import fits
from astropy.time import Time
from astroquery.mast import Observations, conf as mast_conf


ROOT = Path(__file__).resolve().parents[1]
BASE_FITS = ROOT / "jw09438007001_03103_00002_nrca3_cal.fits"
BUILDER = ROOT / "scripts/build-real-bundle.py"
VERIFIER = ROOT / "scripts/verify-real-fits.py"
RENDERER = ROOT / "scripts/render-real-card.cjs"
NODE = shutil.which("node") or "node"
MONTHS = ("2025-05", "2025-07")
sys.path.insert(0, str(ROOT))
from probar_webb import leer_exposicion  # noqa: E402
from visual_eligibility import FILTER_VERSION, es_apta  # noqa: E402


class VisualIneligibleError(ValueError):
    def __init__(self, metrics: dict[str, object]) -> None:
        self.metrics = metrics
        super().__init__(
            "visual-filter-1 rejected exposure "
            f"(background brightness={metrics.get('brillo_mediano_fondo_png')!r}, "
            f"total jump={metrics.get('salto_total')!r})"
        )


def original_sampler_result(path: Path, uri: str) -> dict[str, object]:
    preview, info = leer_exposicion(path, uri)
    preview.close()
    return info


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def month_bounds(month: str) -> tuple[float, float]:
    year, number = map(int, month.split("-"))
    following = f"{year + 1:04d}-01-01" if number == 12 else f"{year:04d}-{number + 1:02d}-01"
    return Time(f"{month}-01", scale="utc").mjd, Time(following, scale="utc").mjd


def call(command: list[str], label: str) -> subprocess.CompletedProcess[str]:
    print(f"    Iniciando: {label}...", flush=True)
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=False)
    if result.returncode:
        detail = (result.stderr or result.stdout)[-2500:]
        raise RuntimeError(f"{label} failed ({result.returncode}): {detail}")
    print(f"    Terminado: {label}.", flush=True)
    return result


def bundle_snapshot(bundle: Path) -> dict[str, str]:
    observation = json.loads((bundle / "observation.json").read_text(encoding="utf-8"))
    files = {"observation.json": sha256(bundle / "observation.json")}
    files.update({key: sha256(bundle / key) for key in observation["members"]})
    return files


def verify_offline_reproducibility(fits_path: Path, bundle: Path, target_name: str | None = None) -> dict[str, object]:
    # Build in a sibling staging directory. A bundle created by the previous
    # collector version may legitimately change schema/metrics on rebuild; do
    # not compare it to the new output or mutate it before reproducibility passes.
    with tempfile.TemporaryDirectory(prefix="monthly-bundle-check-", dir=bundle.parent) as scratch_name:
        stage = Path(scratch_name) / bundle.name
        shutil.copytree(bundle, stage)
        call([
            sys.executable, str(BUILDER), "--offline", "--fits", str(fits_path), "--target-name", target_name or "unknown",
            "--source-png", str(stage / "no-regression-reference.png"), "--out", str(stage),
        ], "first offline bundle rebuild")
        first_dependencies = bundle_snapshot(stage)
        call([
            sys.executable, str(BUILDER), "--offline", "--fits", str(fits_path), "--target-name", target_name or "unknown",
            "--source-png", str(stage / "no-regression-reference.png"), "--out", str(stage),
        ], "second offline bundle rebuild")
        second_dependencies = bundle_snapshot(stage)
        if first_dependencies != second_dependencies:
            raise ValueError("Two offline bundle rebuilds produced different dependency bytes")
        first = json.loads(call([NODE, str(RENDERER), str(stage)], "first offline render").stdout)
        second = json.loads(call([NODE, str(RENDERER), str(stage)], "second offline render").stdout)
        if first["svg"]["sha256"] != second["svg"]["sha256"] or first["png"]["sha256"] != second["png"]["sha256"]:
            raise ValueError("Offline card render changed bytes for unchanged dependencies")
        # Publish only after both deterministic builds and renders pass. Merge
        # files to preserve any owner-added evidence not managed by the builder.
        shutil.copytree(stage, bundle, dirs_exist_ok=True)
        if bundle_snapshot(bundle) != second_dependencies:
            raise ValueError("Published bundle dependency digests differ from the validated staging bundle")
    return {"bundleMemberDigestsStable": True, "memberCount": len(second_dependencies), "svgSha256": second["svg"]["sha256"], "pngSha256": second["png"]["sha256"], "network": "disabled for both rebuilds and renders", "updatedFromPriorBundleVersion": True}


def reuse_month_bundle(month: str, bundle: Path) -> tuple[dict[str, object] | None, dict[str, object] | None]:
    observation = json.loads((bundle / "observation.json").read_text(encoding="utf-8"))
    filename = observation["product"]["file"]
    local_fits = ROOT / "downloads" / "increment-4" / month / filename
    if not local_fits.is_file() or sha256(local_fits) != observation["provenance"]["fitsSha256"]:
        raise ValueError(f"Existing monthly bundle has no matching ignored FITS input: {local_fits}")
    legacy_info = original_sampler_result(local_fits, observation["product"]["uri"])
    visual_metrics = legacy_info["metricas_visuales"]
    if not es_apta(visual_metrics):
        return None, {
            "month": month,
            "product": observation["product"],
            "reason": "visual-filter-1",
            "accepted": False,
            "filterVersion": FILTER_VERSION,
            "originalSampler": legacy_info,
            "bundle": str(bundle.relative_to(ROOT)).replace("\\", "/"),
            "card": str((bundle / "real-card.png").relative_to(ROOT)).replace("\\", "/"),
        }
    check = json.loads((bundle / "real-fits-check.json").read_text(encoding="utf-8"))
    reproducibility = verify_offline_reproducibility(local_fits, bundle, observation["product"].get("target"))
    observation = json.loads((bundle / "observation.json").read_text(encoding="utf-8"))
    receipt = json.loads((bundle / "render-receipt.json").read_text(encoding="utf-8"))
    return {
        "month": month, "mastObservationId": None, "mastDataUri": observation["product"]["uri"],
        "mastTarget": observation["product"]["target"],
        "fits": {"name": filename, "bytes": local_fits.stat().st_size, "mastListedBytes": None, "mastSizeDeltaBytes": None, "sha256": sha256(local_fits), "ignoredLocalPath": str(local_fits.relative_to(ROOT))},
        "bundle": str(bundle.relative_to(ROOT)).replace("\\", "/"), "product": observation["product"],
        "metrics": observation["metrics"], "originalSampler": legacy_info, "wcsReferencePixelOffsetArcsec": check["product"].get("reference_pixel_offset_from_ra_ref_arcsec", check["product"]["center_offset_from_ra_ref_arcsec"]),
        "visualDecision": {"filterVersion": FILTER_VERSION, "accepted": True},
        "webbPositionDeltaKm": check["jwst_geocentric_position"]["vector_delta_norm_km"],
        "utcMjdAvgToTdb": check["time"]["mjd_avg_to_tdb_isot"], "horizons": observation["orbit"],
        "render": receipt, "reproducibility": reproducibility,
    }, None


def candidates(month: str, limit: int | None, skip_uris: set[str] | None = None):
    start, end = month_bounds(month)
    print(f"  Consultando el listado de observaciones MAST para {month}...", flush=True)
    try:
        observations = Observations.query_criteria(
            obs_collection="JWST",
            instrument_name="NIRCAM*",
            dataproduct_type="image",
            intentType="science",
            dataRights="PUBLIC",
            t_min=[start, end],
        )
    except Exception as error:
        raise RuntimeError(f"La consulta de observaciones MAST para {month} falló o agotó su tiempo límite: {error}") from error
    print(f"  MAST devolvió {len(observations)} observaciones; consultando productos por observación.", flush=True)
    order = sorted(range(len(observations)), key=lambda i: (str(observations[i]["obs_id"]), float(observations[i]["t_min"])))
    # Similar to probar_webb.py, inspect observation products incrementally;
    # avoid downloading a giant all-month product table before trying a FITS.
    random.Random(f"increment-4:{month}").shuffle(order)
    yielded = 0
    consecutive_lookup_errors = 0
    skip_uris = skip_uris or set()
    for position, index in enumerate(order, start=1):
        row = observations[index]
        if position == 1 or position % 10 == 0:
            print(f"  MAST: productos de observación {position}/{len(order)}; {yielded} candidatas _cal.fits encontradas.", flush=True)
        try:
            product_table = Observations.get_product_list(observations[index:index + 1])
            consecutive_lookup_errors = 0
        except Exception as error:
            consecutive_lookup_errors += 1
            print(f"  MAST no respondió para observación {row['obs_id']}: {error}", flush=True)
            if consecutive_lookup_errors >= 3:
                raise RuntimeError("Tres consultas MAST consecutivas fallaron; se detiene para evitar aparentar que el recolector sigue avanzando.") from error
            continue
        products_for_observation = []
        for product in product_table:
            filename = Path(str(product["productFilename"])).name
            if not filename.lower().endswith("_cal.fits"):
                continue
            try:
                size = int(product["size"])
            except (TypeError, ValueError):
                size = None
            mast_target = str(row["target_name"]).strip()
            if mast_target.lower() in {"", "none", "--", "n/a"}:
                mast_target = "unknown"
            products_for_observation.append((str(row["obs_id"]), float(row["t_min"]), mast_target, str(product["dataURI"]), filename, size))
        random.Random(str(row["obs_id"])).shuffle(products_for_observation)
        for candidate in products_for_observation:
            if candidate[3] in skip_uris:
                continue
            yield candidate
            yielded += 1
            if limit is not None and yielded >= limit:
                return


def validate_download(path: Path) -> None:
    # Avoid lingering Windows mmap handles when the temporary download is removed.
    with fits.open(path, memmap=False) as hdus:
        primary = hdus[0].header
        science = hdus["SCI"]
        header = primary.copy()
        header.extend(science.header, update=True)
        if header.get("TELESCOP") != "JWST" or header.get("INSTRUME") != "NIRCAM":
            raise ValueError("not a JWST NIRCam FITS product")
        if header.get("EXP_TYPE") != "NRC_IMAGE":
            raise ValueError(f"unsupported EXP_TYPE={header.get('EXP_TYPE')!r}")
        if science.data is None or science.data.ndim != 2:
            raise ValueError("SCI extension is not a 2-D image")
        if "DQ" in hdus and hdus["DQ"].data.shape != science.data.shape:
            raise ValueError("DQ dimensions do not match SCI")
        if "ASDF" not in hdus or "ASDF_METADATA" not in hdus["ASDF"].data.names:
            raise ValueError("calibrated ASDF/GWCS metadata is missing")


def process_candidate(month: str, candidate, final_root: Path) -> dict[str, object]:
    obs_id, _mjd, target, uri, filename, expected_bytes = candidate
    final_bundle = final_root / month / Path(filename).stem
    if final_bundle.exists():
        local_fits = ROOT / "downloads" / "increment-4" / month / filename
        observation = json.loads((final_bundle / "observation.json").read_text(encoding="utf-8"))
        if not local_fits.is_file() or observation["product"]["uri"] != uri:
            raise FileExistsError(f"Existing evidence does not match the MAST candidate: {final_bundle}")
        if sha256(local_fits) != observation["provenance"]["fitsSha256"]:
            raise ValueError(f"Stored FITS digest differs from its bundle: {local_fits}")
        legacy_info = original_sampler_result(local_fits, uri)
        if not es_apta(legacy_info["metricas_visuales"]):
            raise VisualIneligibleError(legacy_info["metricas_visuales"])
        check = json.loads((final_bundle / "real-fits-check.json").read_text(encoding="utf-8"))
        reproducibility = verify_offline_reproducibility(local_fits, final_bundle, target)
        observation = json.loads((final_bundle / "observation.json").read_text(encoding="utf-8"))
        receipt = json.loads((final_bundle / "render-receipt.json").read_text(encoding="utf-8"))
        return {
            "month": month, "mastObservationId": obs_id, "mastDataUri": uri, "mastTarget": target,
        "fits": {"name": filename, "bytes": local_fits.stat().st_size, "mastListedBytes": expected_bytes, "sha256": sha256(local_fits), "ignoredLocalPath": str(local_fits.relative_to(ROOT))},
            "bundle": str(final_bundle.relative_to(ROOT)).replace("\\", "/"), "product": observation["product"],
            "metrics": observation["metrics"], "originalSampler": legacy_info, "wcsReferencePixelOffsetArcsec": check["product"].get("reference_pixel_offset_from_ra_ref_arcsec", check["product"]["center_offset_from_ra_ref_arcsec"]),
            "visualDecision": {"filterVersion": FILTER_VERSION, "accepted": True},
            "webbPositionDeltaKm": check["jwst_geocentric_position"]["vector_delta_norm_km"],
            "utcMjdAvgToTdb": check["time"]["mjd_avg_to_tdb_isot"], "horizons": observation["orbit"],
            "render": receipt, "reproducibility": reproducibility,
        }
    with tempfile.TemporaryDirectory(prefix="webb-monthly-acceptance-") as scratch_name:
        scratch = Path(scratch_name)
        fits_path = scratch / filename
        status, message, _ = Observations.download_file(uri, local_path=str(fits_path))
        if status != "COMPLETE" or not fits_path.is_file():
            raise RuntimeError(f"MAST download status={status}: {message}")
        actual_bytes = fits_path.stat().st_size
        if actual_bytes == 0:
            raise ValueError("downloaded FITS is empty")
        validate_download(fits_path)
        # Apply the original image usability check, then the owner's independent
        # brightness/stripe eligibility rule before the costly bundle build.
        print("  Evaluando la imagen con leer_exposicion del metodo original...", flush=True)
        legacy_info = original_sampler_result(fits_path, uri)
        if not es_apta(legacy_info["metricas_visuales"]):
            raise VisualIneligibleError(legacy_info["metricas_visuales"])

        bundle = scratch / "bundle"
        # Do not compare a different exposure against the baseline product's
        # root-level regression PNG; this sample gets its own raster from SCI.
        build = call([
            sys.executable, str(BUILDER), "--fits", str(fits_path), "--target-name", target,
            "--source-png", str(scratch / "no-reference.png"), "--out", str(bundle),
        ], "real bundle build")
        verification = call([sys.executable, str(VERIFIER), str(fits_path)], "independent FITS/Horizons verification")
        (bundle / "real-fits-check.json").write_text(verification.stdout + "\n", encoding="utf-8")
        reproducibility = verify_offline_reproducibility(fits_path, bundle, target)
        observation = json.loads((bundle / "observation.json").read_text(encoding="utf-8"))
        receipt = json.loads((bundle / "render-receipt.json").read_text(encoding="utf-8"))
        check = json.loads(verification.stdout)
        if check.get("status") != "PASS" or receipt.get("result") != "PASS":
            raise ValueError("FITS/Horizons verification or card render did not report PASS")

        local_fits_dir = ROOT / "downloads" / "increment-4" / month
        local_fits_dir.mkdir(parents=True, exist_ok=True)
        local_fits = local_fits_dir / filename
        shutil.copy2(fits_path, local_fits)
        final_bundle.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(bundle, final_bundle)
        return {
            "month": month,
            "mastObservationId": obs_id,
            "mastDataUri": uri,
            "mastTarget": target,
            "fits": {"name": filename, "bytes": local_fits.stat().st_size, "mastListedBytes": expected_bytes, "sha256": sha256(local_fits), "ignoredLocalPath": str(local_fits.relative_to(ROOT))},
            "bundle": str(final_bundle.relative_to(ROOT)).replace("\\", "/"),
            "product": observation["product"],
            "metrics": observation["metrics"],
            "originalSampler": legacy_info,
            "visualDecision": {"filterVersion": FILTER_VERSION, "accepted": True},
            "wcsReferencePixelOffsetArcsec": check["product"].get("reference_pixel_offset_from_ra_ref_arcsec", check["product"]["center_offset_from_ra_ref_arcsec"]),
            "webbPositionDeltaKm": check["jwst_geocentric_position"]["vector_delta_norm_km"],
            "utcMjdAvgToTdb": check["time"]["mjd_avg_to_tdb_isot"],
            "horizons": observation["orbit"],
            "render": receipt,
            "reproducibility": reproducibility,
            "commands": {"build": "build-real-bundle.py", "verification": "verify-real-fits.py", "render": "render-real-card.cjs (network disabled)"},
            "buildSummary": build.stdout[-1200:],
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--months", default=",".join(MONTHS), help="comma-separated UTC exposure months; defaults to 2025-05,2025-07")
    parser.add_argument("--max-candidates-per-month", type=int, default=None, help="optional diagnostic limit; by default enumerate all candidates")
    parser.add_argument("--mast-timeout-seconds", type=int, default=90, help="MAST request timeout (default: 90 seconds)")
    parser.add_argument("--output", type=Path, default=ROOT / "docs/evidence/increment-4/monthly-exposures")
    args = parser.parse_args()
    if not BASE_FITS.is_file():
        raise FileNotFoundError(f"Reference exposure is missing: {BASE_FITS}")
    months = [value.strip() for value in args.months.split(",") if value.strip()]
    if len(months) != len(set(months)) or any(len(value) != 7 or value[4] != "-" for value in months):
        raise ValueError("Months must be unique YYYY-MM values")
    if not months or (args.max_candidates_per_month is not None and args.max_candidates_per_month < 1):
        raise ValueError("At least one month and a positive optional candidate limit are required")
    if args.mast_timeout_seconds < 1:
        raise ValueError("MAST timeout must be a positive number of seconds")
    mast_conf.timeout = args.mast_timeout_seconds

    report: dict[str, object] = {
        "schemaVersion": "increment-4-monthly-acceptance-2",
        "runUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "selection": {"archive": "MAST public JWST collection", "criteria": ["science image", "public", "NIRCam", "product filename ends with _cal.fits"], "visualFilterVersion": FILTER_VERSION, "visualRule": "brightness <= 45 OR (brightness < 90 AND totalJump <= 0.10)", "technicalChecks": ["original leer_exposicion method succeeds", "increment-4 scene has evaluable ASDF/GWCS and spacecraft ephemeris"], "maxFitsBytes": None, "detectorPreference": None, "filterPreference": None, "months": months},
        "reference": {"product": BASE_FITS.name, "month": "2025-09", "sha256": sha256(BASE_FITS)},
        "tools": {"python": sys.version.split()[0], "astroquery": __import__("astroquery").__version__, "astropy": __import__("astropy").__version__, "mastTimeoutSeconds": args.mast_timeout_seconds},
        "exposures": [],
        "visuallyRejected": [],
        "technicalOmissions": [],
    }
    exposures: list[dict[str, object]] = report["exposures"]  # type: ignore[assignment]
    visually_rejected: list[dict[str, object]] = report["visuallyRejected"]  # type: ignore[assignment]
    technical_omissions: list[dict[str, object]] = report["technicalOmissions"]  # type: ignore[assignment]
    output_root = args.output.resolve()
    for month in months:
        existing = sorted((output_root / month).glob("*/observation.json")) if (output_root / month).is_dir() else []
        skip_uris: set[str] = set()
        found_existing_eligible = False
        for observation_path in existing:
            bundle = observation_path.parent
            previous = json.loads(observation_path.read_text(encoding="utf-8"))
            skip_uris.add(str(previous["product"]["uri"]))
            print(f"Revisando bundle existente de {month}: {bundle.name}", flush=True)
            exposure, rejection = reuse_month_bundle(month, bundle)
            if rejection is not None:
                visually_rejected.append(rejection)
                print(f"  No apta visualmente: {rejection['product']['file']}", flush=True)
            elif exposure is not None and not found_existing_eligible:
                exposures.append(exposure)
                found_existing_eligible = True
        if found_existing_eligible:
            continue
        print(f"Buscando imágenes públicas de ciencia NIRCam en {month}…", flush=True)
        options = candidates(month, args.max_candidates_per_month, skip_uris)
        tried = 0
        found_candidate = False
        for candidate in options:
            tried += 1
            size_label = f"{candidate[5]} bytes" if candidate[5] is not None else "MAST size unavailable"
            print(f"  [{tried}] {candidate[4]} ({size_label})", flush=True)
            try:
                exposures.append(process_candidate(month, candidate, output_root))
                print(f"  Accepted: {candidate[4]}", flush=True)
                found_candidate = True
                break
            except VisualIneligibleError as error:
                visually_rejected.append({
                    "month": month,
                    "productFile": candidate[4],
                    "mastUri": candidate[3],
                    "mastTarget": candidate[2],
                    "mastListedBytes": candidate[5],
                    "filterVersion": FILTER_VERSION,
                    "accepted": False,
                    "reason": str(error),
                    "visualMetrics": error.metrics,
                })
                print(f"  Rechazada por {FILTER_VERSION}: {error}", flush=True)
            except Exception as error:  # report rejected candidates and continue deterministically
                technical_omissions.append({"month": month, "productFile": candidate[4], "mastUri": candidate[3], "reason": str(error)})
                print(f"  Rejected: {error}", flush=True)
        if not found_candidate:
            print(f"  No se encontro una exposicion apta en {month} tras revisar {tried} candidatas.", flush=True)

    output_root.mkdir(parents=True, exist_ok=True)
    report_path = output_root / "monthly-coverage.json"
    current_exposures = list(exposures)
    preserved: dict[str, dict[str, object]] = {}
    preserved_visual_rejections: list[dict[str, object]] = []
    preserved_technical_omissions: list[dict[str, object]] = []
    if report_path.is_file():
        previous = json.loads(report_path.read_text(encoding="utf-8"))
        for item in previous.get("exposures", []):
            if item.get("month") not in months:
                legacy_info = item.get("originalSampler")
                if legacy_info is None:
                    fits_info = item.get("fits", {})
                    local_fits = ROOT / str(fits_info.get("ignoredLocalPath", ""))
                    if not local_fits.is_file():
                        local_fits = ROOT / "downloads" / "increment-4" / str(item["month"]) / str(fits_info.get("name", ""))
                    if local_fits.is_file():
                        legacy_info = original_sampler_result(local_fits, item.get("mastDataUri", item.get("product", {}).get("uri", "")))
                        item["originalSampler"] = legacy_info
                visual_metrics = (legacy_info or {}).get("metricas_visuales")
                if visual_metrics is not None and not es_apta(visual_metrics):
                    preserved_visual_rejections.append({
                        "month": item["month"],
                        "product": item.get("product"),
                        "reason": "visual-filter-1",
                        "accepted": False,
                        "filterVersion": FILTER_VERSION,
                        "originalSampler": legacy_info,
                        "bundle": item.get("bundle"),
                    })
                    continue
                if visual_metrics is not None:
                    fits_info = item.get("fits", {})
                    local_fits = ROOT / str(fits_info.get("ignoredLocalPath", ""))
                    if not local_fits.is_file():
                        local_fits = ROOT / "downloads" / "increment-4" / str(item["month"]) / str(fits_info.get("name", ""))
                    bundle_path = ROOT / str(item.get("bundle", ""))
                    current_filter = item.get("visualDecision", {}).get("filterVersion") == FILTER_VERSION
                    if local_fits.is_file() and bundle_path.is_dir() and not current_filter:
                        print(f"  Actualizando bundle apto de {item['month']} bajo {FILTER_VERSION}...", flush=True)
                        reproducibility = verify_offline_reproducibility(local_fits, bundle_path, item.get("product", {}).get("target"))
                        observation = json.loads((bundle_path / "observation.json").read_text(encoding="utf-8"))
                        item["metrics"] = observation["metrics"]
                        item["reproducibility"] = reproducibility
                        if (bundle_path / "render-receipt.json").is_file():
                            item["render"] = json.loads((bundle_path / "render-receipt.json").read_text(encoding="utf-8"))
                    item["visualDecision"] = {"filterVersion": FILTER_VERSION, "accepted": True}
                    item.setdefault("metrics", {}).update({"accepted": True, "eligibilityApplied": True, "filterVersion": FILTER_VERSION})
                preserved[str(item["month"])] = item
        preserved_visual_rejections.extend(item for item in previous.get("visuallyRejected", []) if item.get("month") not in months)
        preserved_technical_omissions = [item for item in previous.get("technicalOmissions", []) if item.get("month") not in months]
    merged = [*preserved.values(), *current_exposures]
    merged.sort(key=lambda item: str(item["month"]))
    report["exposures"] = merged
    report["visuallyRejected"] = [*preserved_visual_rejections, *visually_rejected]
    report["technicalOmissions"] = [*preserved_technical_omissions, *technical_omissions]
    reported_months = sorted({str(item["month"]) for item in merged})
    report["summary"] = {
        "requiredNewMonths": len(months),
        "acceptedNewMonths": len(current_exposures),
        "preservedPreviousMonths": len(preserved),
        "reportedMonthlyExposures": len(merged),
        "visuallyRejectedCandidates": len(report["visuallyRejected"]),
        "technicalOmissions": len(report["technicalOmissions"]),
        "distinctMonthsIncludingReference": len({"2025-09", *reported_months}),
        "monthsWithoutEligibleExposure": [month for month in months if not any(item["month"] == month for item in current_exposures)],
        "status": "PASS" if len(current_exposures) == len(months) else "PARTIAL",
    }
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["summary"]["status"], "evidence": str(report_path), "exposures": [{"month": item["month"], "product": item["product"]["id"], "sha256": item["fits"]["sha256"], "bundle": item["bundle"]} for item in exposures], "visuallyRejected": len(report["visuallyRejected"]), "monthsWithoutEligibleExposure": report["summary"]["monthsWithoutEligibleExposure"]}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
