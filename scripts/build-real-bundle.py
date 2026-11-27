"""Build the local, versioned real-exposure preload bundle.

Reading the already-downloaded FITS and sky sources is offline. Horizons is
queried here, during bundle construction; rendering consumes only the files
written by this script.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import shutil
import socket
from datetime import datetime, timezone
from pathlib import Path

import asdf
import asdf_astropy  # noqa: F401
import asdf_wcs_schemas  # noqa: F401
import gwcs  # noqa: F401
import numpy as np
from astropy import units as u
from astropy.coordinates import GeocentricMeanEcliptic, SkyCoord
from astropy.io import fits
from astropy.time import Time
from astroquery.jplhorizons import Horizons
from PIL import Image
from visual_eligibility import FILTER_VERSION, es_apta


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FITS = ROOT / "jw09438007001_03103_00002_nrca3_cal.fits"
SKY_ROOT = ROOT / "docs/evidence/increment-4/sky-sources"
DEFAULT_OUT = ROOT / "docs/evidence/increment-4/real-bundle"
ASTRONOMICAL_UNIT_KM = u.au.to(u.km)
AU_DAY_TO_KM_SECOND = (u.au / u.day).to(u.km / u.s)
L2_DISTANCE_KM = 1_500_000.0
LOCAL_MAGNIFICATION = 20.0
OBLIQUITY_2000_DEG = 23.439291111


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")


def unit(vector: np.ndarray) -> np.ndarray:
    length = float(np.linalg.norm(vector))
    if not math.isfinite(length) or length == 0:
        raise ValueError("Cannot normalize an empty/non-finite vector")
    return vector / length


def projection_basis(ra_deg: float, dec_deg: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    ra, dec = math.radians(ra_deg), math.radians(dec_deg)
    center = np.array([math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)])
    east = np.array([-math.sin(ra), math.cos(ra), 0.0])
    north = unit(np.cross(center, east))
    return center, east, north


def gnomonic(point: tuple[float, float], basis: tuple[np.ndarray, ...]) -> tuple[float, float] | None:
    center, east, north = basis
    ra, dec = map(math.radians, point)
    vector = np.array([math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)])
    denominator = float(np.dot(vector, center))
    if denominator <= 1e-12:
        return None
    return -float(np.dot(vector, east)) / denominator, -float(np.dot(vector, north)) / denominator


def inverse_gnomonic(x: float, y: float, center: tuple[float, float], basis: tuple[np.ndarray, ...]) -> list[float]:
    c, east, north = basis
    vector = unit(c - x * east - y * north)
    return [float(math.degrees(math.atan2(vector[1], vector[0])) % 360.0), float(math.degrees(math.atan2(vector[2], math.hypot(vector[0], vector[1]))))]


def dot(vector: np.ndarray, axis: np.ndarray) -> float:
    return float(np.dot(vector, axis))


def moving_basis(position: np.ndarray, velocity: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    radial = unit(position)
    normal = unit(np.cross(position, velocity))
    tangent = unit(np.cross(normal, radial))
    return radial, tangent, normal


def local_offset_in_reference(offset: np.ndarray, sampled_basis: tuple[np.ndarray, ...], reference_basis: tuple[np.ndarray, ...]) -> np.ndarray:
    coefficients = np.array([dot(offset, axis) for axis in sampled_basis])
    return sum((coefficient * axis for coefficient, axis in zip(coefficients, reference_basis, strict=True)), start=np.zeros(3))


def query_vectors(target_id: str, epochs_jd_tdb: list[float]) -> list[dict[str, object]]:
    table = Horizons(id=target_id, location="@10", epochs=epochs_jd_tdb).vectors(refplane="ecliptic")
    if len(table) != len(epochs_jd_tdb):
        raise ValueError(f"Horizons returned {len(table)} rows for {len(epochs_jd_tdb)} {target_id} epochs")
    output = []
    for expected, row in zip(epochs_jd_tdb, table, strict=True):
        actual = float(row["datetime_jd"])
        if abs(actual - expected) > 1e-8:
            raise ValueError(f"Horizons epoch mismatch for {target_id}: {actual} != {expected}")
        output.append({
            "jdTdb": actual,
            "positionKm": [float(row[key]) * ASTRONOMICAL_UNIT_KM for key in ("x", "y", "z")],
            "velocityKmS": [float(row[key]) * AU_DAY_TO_KM_SECOND for key in ("vx", "vy", "vz")],
            "target": str(row["targetname"]),
        })
    return output


def line_segments(feature_collection: dict, center: tuple[float, float], max_distance_deg: float) -> tuple[list[list[list[float]]], set[str]]:
    basis = projection_basis(*center)
    c = basis[0]
    segments: list[list[list[float]]] = []
    feature_ids: set[str] = set()
    threshold = math.cos(math.radians(max_distance_deg))
    for feature in feature_collection["features"]:
        selected = []
        for path in feature["geometry"]["coordinates"]:
            points = [[float(ra) % 360.0, float(dec)] for ra, dec in path]
            for first, second in zip(points, points[1:]):
                # Endpoints and the normalized great-circle midpoint keep wrap-crossing
                # segments that pass through the requested field radius.
                vectors = []
                for ra, dec in (first, second):
                    r, d = math.radians(ra), math.radians(dec)
                    vectors.append(np.array([math.cos(d) * math.cos(r), math.cos(d) * math.sin(r), math.sin(d)]))
                midpoint = unit(vectors[0] + vectors[1])
                if max(float(np.dot(c, v)) for v in (*vectors, midpoint)) >= threshold:
                    selected.append([first, second])
        if selected:
            segments.extend(selected)
            feature_ids.add(str(feature["id"]))
    return segments, feature_ids


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fits", type=Path, default=DEFAULT_FITS)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--source-png", type=Path, default=DEFAULT_FITS.with_suffix(".png"))
    parser.add_argument("--target-name", help="MAST target label fallback when FITS TARGNAME is absent")
    parser.add_argument("--offline", action="store_true", help="build only from the retained Horizons response snapshot")
    args = parser.parse_args()
    if args.offline:
        def deny_network(*_args, **_kwargs):
            raise RuntimeError("Network access is disabled for an offline bundle build")
        socket.create_connection = deny_network
        socket.socket.connect = deny_network
    fits_path = args.fits.resolve()
    out = args.out.resolve()
    if not fits_path.is_file():
        raise FileNotFoundError(f"Local FITS not found: {fits_path}")
    out.mkdir(parents=True, exist_ok=True)

    with fits.open(fits_path, memmap=False) as hdus:
        primary = hdus[0].header
        header = primary.copy()
        header.extend(hdus["SCI"].header, update=True)
        program_id = str(header.get("PROGRAM") or "unknown").zfill(5)
        fits_target = str(header.get("TARGNAME") or "").strip()
        mast_target = str(args.target_name or "").strip()
        target_name = fits_target or mast_target or "unknown"
        target_name_source = "FITS TARGNAME" if fits_target else "MAST observation" if mast_target else "unknown"
        pupil_name = str(header.get("PUPIL") or "unknown")
        science_header = hdus["SCI"].header
        science = np.asarray(hdus["SCI"].data, dtype=np.float32)
        dq = np.asarray(hdus["DQ"].data) if "DQ" in hdus else None
        if science.ndim != 2 or (dq is not None and science.shape != dq.shape):
            raise ValueError("Expected 2-D SCI and, when present, same-shaped DQ arrays")
        if header.get("EXP_TYPE") != "NRC_IMAGE":
            raise ValueError(f"Unsupported exposure type {header.get('EXP_TYPE')!r}")
        try:
            payload = hdus["ASDF"].data["ASDF_METADATA"][0].tobytes()
            with asdf.open(io.BytesIO(payload)) as af:
                wcs = af.tree["meta"]["wcs"]
                if not callable(wcs):
                    raise ValueError("ASDF meta.wcs is not callable")
                height, width = science.shape
                pixel_x = np.array([-0.5, width - 0.5, width - 0.5, -0.5, (width - 1) / 2])
                pixel_y = np.array([-0.5, -0.5, height - 0.5, height - 0.5, (height - 1) / 2])
                ra_values, dec_values = wcs(pixel_x, pixel_y)
        except (KeyError, IndexError, TypeError, OSError, ValueError) as error:
            raise ValueError("Calibrated FITS is missing readable ASDF metadata with its GWCS") from error

    if not np.isfinite(ra_values).all() or not np.isfinite(dec_values).all():
        raise ValueError("GWCS does not cover all four detector boundaries and center")
    finite = np.isfinite(science)
    # Match probar_webb.leer_exposicion: finite SCI, excluding only DQ bit 0
    # when a DQ plane exists. Other informational DQ flags remain usable.
    valid = finite if dq is None else finite & ((dq & 1) == 0)
    if int(valid.sum()) < 100:
        raise ValueError("Too few finite usable SCI samples")

    p1, p997 = np.percentile(science[valid], [1, 99.7])
    if not math.isfinite(float(p1)) or not float(p997) > float(p1):
        raise ValueError("Degenerate SCI contrast range")
    display = np.array(science, copy=True)
    display[~valid] = p1
    normalized = np.clip((display - p1) / (p997 - p1), 0.0, 1.0)
    display_u8 = np.uint8(255 * np.arcsinh(10 * normalized) / math.asinh(10))
    full_image = Image.fromarray(display_u8, mode="L")
    supplied_png_match = None
    if args.source_png.is_file():
        supplied = np.asarray(Image.open(args.source_png).convert("L"))
        supplied_png_match = bool(supplied.shape == display_u8.shape and np.array_equal(supplied, display_u8))
        if not supplied_png_match:
            raise ValueError("Rebuilt SCI raster differs from the retained PNG regression reference")
    max_dimension = 1024
    resized_size = (max(1, round(width * min(1.0, max_dimension / width))), max(1, round(height * min(1.0, max_dimension / height))))
    image_path = out / "photo-1024.png"
    full_image.resize(resized_size, Image.Resampling.LANCZOS).save(image_path, format="PNG", optimize=True)

    p10, p80 = np.percentile(science[valid], [10, 80])
    background = valid & (science >= p10) & (science <= p80)
    background_dispersion = float(np.median(np.abs(science[background] - np.median(science[background]))))

    def robust_profile_score(axis: int, *, jumps: bool) -> float | None:
        if background_dispersion == 0:
            return None
        masked = np.ma.array(science, mask=~background)
        profile = np.ma.median(masked, axis=axis)
        deviations = np.ma.abs(profile - np.ma.median(profile)) if not jumps else np.ma.abs(np.ma.diff(profile))
        vals = deviations.compressed()
        return round(float(np.median(vals) / background_dispersion), 4) if vals.size else None

    # The original background mask is used to measure its rendered 8-bit brightness.
    background_brightness = round(float(np.median(display_u8[background])), 1) if background.any() else None
    row_variation = robust_profile_score(1, jumps=False)
    column_variation = robust_profile_score(0, jumps=False)
    row_jump = robust_profile_score(1, jumps=True)
    column_jump = robust_profile_score(0, jumps=True)
    total_jump = round(row_jump + column_jump, 4) if row_jump is not None and column_jump is not None else None
    visual_metrics = {
        "brillo_mediano_fondo_png": background_brightness,
        "salto_total": total_jump,
    }
    visually_accepted = es_apta(visual_metrics)
    metrics = {
        "validFraction": round(float(valid.mean()), 4),
        "rowVariation": row_variation,
        "columnVariation": column_variation,
        "rowJump": row_jump,
        "columnJump": column_jump,
        "totalJump": total_jump,
        "brightness": background_brightness,
        "stripesWarning": total_jump >= 0.19 if total_jump is not None else None,
        "accepted": visually_accepted,
        "eligibilityApplied": True,
        "metricsVersion": "visual-metrics-1",
        "filterVersion": FILTER_VERSION,
        "dqPresent": dq is not None,
    }
    if not visually_accepted:
        raise ValueError(
            "Exposure failed visual-filter-1 "
            f"(background brightness={background_brightness!r}, total jump={total_jump!r})"
        )

    center = [float(ra_values[-1]) % 360.0, float(dec_values[-1])]
    footprint = [[float(ra) % 360.0, float(dec)] for ra, dec in zip(ra_values[:4], dec_values[:4], strict=True)]
    tangent = projection_basis(*center)
    footprint_projected = [gnomonic(tuple(point), tangent) for point in footprint]
    if any(point is None for point in footprint_projected):
        raise ValueError("Detector footprint crosses the gnomonic horizon")
    projected = np.asarray(footprint_projected, dtype=float)
    star_path = SKY_ROOT / "hyg-v4.1-stars-mag6.json"
    line_path = SKY_ROOT / "d3-celestial/data/constellations.lines.json"
    lines = json.loads(line_path.read_text(encoding="utf-8"))
    region = SkyCoord(center[0] * u.deg, center[1] * u.deg, frame="icrs").get_constellation()
    abbreviation = SkyCoord(center[0] * u.deg, center[1] * u.deg, frame="icrs").get_constellation(short_name=True)
    target_figure = {"features": [feature for feature in lines["features"] if feature.get("id") == abbreviation]}
    if not target_figure["features"]:
        raise ValueError(f"No stick figure available for the field constellation {abbreviation}")
    target_vertices = [point for feature in target_figure["features"] for path in feature["geometry"]["coordinates"] for point in path]
    target_coords = SkyCoord([float(point[0]) % 360 for point in target_vertices] * u.deg, [float(point[1]) for point in target_vertices] * u.deg, frame="icrs")
    field_coord = SkyCoord(center[0] * u.deg, center[1] * u.deg, frame="icrs")
    closest_index = int(np.argmin(field_coord.separation(target_coords).deg))
    nearest_figure_point = target_coords[closest_index]
    local_center = field_coord.directional_offset_by(field_coord.position_angle(nearest_figure_point), field_coord.separation(nearest_figure_point) / 3)
    detail_center = [float(local_center.ra.deg) % 360.0, float(local_center.dec.deg)]
    detail_tangent = projection_basis(*detail_center)
    # A moderate five-degree local context includes the field and nearby figure.
    # The detector's measured WCS corners are not scaled to this display window.
    half_width = math.tan(math.radians(2.5))
    half_height = math.tan(math.radians(2.5))
    detail_corners = [
        inverse_gnomonic(-half_width, half_height, tuple(detail_center), detail_tangent),
        inverse_gnomonic(half_width, half_height, tuple(detail_center), detail_tangent),
        inverse_gnomonic(half_width, -half_height, tuple(detail_center), detail_tangent),
        inverse_gnomonic(-half_width, -half_height, tuple(detail_center), detail_tangent),
    ]
    detail_size = [math.degrees(2 * math.atan(half_width)), math.degrees(2 * math.atan(half_height))]
    overview_segments, feature_ids = line_segments(target_figure, tuple(center), 180.0)
    detail_segments, detail_feature_ids = line_segments(target_figure, tuple(detail_center), 2.5)
    figure_stars = sorted({
        (round(float(ra) % 360.0, 6), round(float(dec), 6))
        for feature in target_figure["features"]
        for path in feature["geometry"]["coordinates"]
        for ra, dec in path
    })
    overview_stars: list[list[float]] = []
    detail_stars: list[list[float]] = []
    sky_scene = {
        "center": center,
        "footprint": footprint,
        "figureEdges": overview_segments,
        "figureStars": [list(point) for point in figure_stars],
        "overviewStars": overview_stars,
        "detail": {
            "center": detail_center,
            "sizeDeg": detail_size,
            "corners": detail_corners,
            "stars": detail_stars,
            "segments": detail_segments,
        },
    }
    sky_metadata = {
        "schemaVersion": "resolved-sky-1",
        "scene": sky_scene,
        "region": region,
        "abbreviation": abbreviation,
        "reference": [float(science_header["RA_REF"]), float(science_header["DEC_REF"])],
        "centerOffsetArcsec": float(SkyCoord(*center, unit="deg", frame="icrs").separation(SkyCoord(science_header["RA_REF"] * u.deg, science_header["DEC_REF"] * u.deg, frame="icrs")).arcsec),
        "catalog": {
            "stars": {"source": "HYG v4.1 (audited, not rendered in this card)", "revision": "3bf37f4b2d5460e1278286320d1d62fab9b493c1", "sha256": sha256_file(star_path), "sourceEpoch": "J2000.0", "frame": "ICRS", "magnitude": "apparent visual", "selected": 0, "detailSelected": 0, "displayPolicy": "constellation figure only; no contextual catalog stars", "license": "CC BY-SA 4.0"},
            "figures": {"source": "d3-celestial constellations.lines.json", "revision": "7e720a3de062059d4c5400a379146a601d9010e0", "sha256": sha256_file(line_path), "sourceCoordinates": "RA degrees signed about zero; Dec degrees", "selectedFeatures": sorted(feature_ids), "detailFeatures": sorted(detail_feature_ids), "license": "BSD-3-Clause"},
            "constellationClassifier": {"implementation": "astropy.coordinates.get_constellation", "version": "8.0.3", "reference": "Roman 1987 / Delporte B1875"},
        },
    }
    sky_path = out / "sky.json"
    write_json(sky_path, sky_metadata)

    time_utc = Time(float(science_header["MJD-AVG"]), format="mjd", scale="utc")
    time_tdb = time_utc.tdb
    epoch_jd_tdb = float(time_tdb.jd)
    earth_epoch = np.linspace(epoch_jd_tdb - 183.0, epoch_jd_tdb + 183.0, 25).tolist()
    moon_epoch = np.linspace(epoch_jd_tdb - 30.0, epoch_jd_tdb + 30.0, 13).tolist()
    webb_epoch = np.linspace(epoch_jd_tdb - 90.0, epoch_jd_tdb + 90.0, 19).tolist()
    july_epoch = float(Time("2025-07-01T00:00:00", scale="tdb").jd)
    all_earth_epochs = sorted(set(earth_epoch + moon_epoch + webb_epoch + [july_epoch, epoch_jd_tdb]))
    horizons_cache_path = out / "horizons-inputs.json"
    expected_queries = {
        "earth": {"targetId": "399", "epochsJdTdb": all_earth_epochs},
        "moon": {"targetId": "301", "epochsJdTdb": moon_epoch},
        "webb": {"targetId": "-170", "epochsJdTdb": webb_epoch},
    }
    if horizons_cache_path.is_file():
        horizons_cache = json.loads(horizons_cache_path.read_text(encoding="utf-8"))
        if horizons_cache.get("fitsSha256") != sha256_file(fits_path) or horizons_cache.get("queries") != expected_queries:
            raise ValueError("Cached Horizons inputs do not match this FITS digest and exact epoch grid")
        earth_samples = horizons_cache["responses"]["earth"]
        moon_samples = horizons_cache["responses"]["moon"]
        webb_samples = horizons_cache["responses"]["webb"]
        for target_id, epochs, samples in (("399", all_earth_epochs, earth_samples), ("301", moon_epoch, moon_samples), ("-170", webb_epoch, webb_samples)):
            if len(samples) != len(epochs) or any(abs(float(row["jdTdb"]) - epoch) > 1e-8 for row, epoch in zip(samples, epochs, strict=True)):
                raise ValueError(f"Cached Horizons response for target {target_id} is incomplete or unordered")
    else:
        if args.offline:
            raise FileNotFoundError(f"Offline build needs the retained Horizons input snapshot: {horizons_cache_path}")
        earth_samples = query_vectors("399", all_earth_epochs)
        moon_samples = query_vectors("301", moon_epoch)
        webb_samples = query_vectors("-170", webb_epoch)
        horizons_cache = {
            "schemaVersion": "horizons-vector-inputs-1",
            "fitsSha256": sha256_file(fits_path),
            "retrievedUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "api": "https://ssd-api.jpl.nasa.gov/api/horizons.api",
            "apiVersion": "1.3",
            "query": {"center": "@10", "referencePlane": "ecliptic", "timeScale": "TDB", "corrections": "geometric / NONE", "inputUnits": {"position": "AU", "velocity": "AU/day"}, "outputUnits": {"position": "km", "velocity": "km/s"}},
            "queries": expected_queries,
            "responses": {"earth": earth_samples, "moon": moon_samples, "webb": webb_samples},
        }
        write_json(horizons_cache_path, horizons_cache)
    horizons_retrieved_utc = str(horizons_cache.get("retrievedUtc", "unknown"))
    earth_by_epoch = {round(float(sample["jdTdb"]), 9): sample for sample in earth_samples}

    def earth_at(epoch: float) -> dict[str, object]:
        try:
            return earth_by_epoch[round(epoch, 9)]
        except KeyError as error:
            raise ValueError(f"Missing Earth reference vector at JD TDB {epoch}") from error

    earth_now = earth_at(epoch_jd_tdb)
    moon_now = next(sample for sample in moon_samples if abs(float(sample["jdTdb"]) - epoch_jd_tdb) < 1e-8)
    webb_now = next(sample for sample in webb_samples if abs(float(sample["jdTdb"]) - epoch_jd_tdb) < 1e-8)
    earth_pos = np.asarray(earth_now["positionKm"], dtype=float)
    earth_vel = np.asarray(earth_now["velocityKmS"], dtype=float)
    camera_ref = np.asarray(earth_at(july_epoch)["positionKm"], dtype=float)
    camera_u = unit(np.array([camera_ref[0], camera_ref[1], 0.0]))
    north_ecliptic = np.array([0.0, 0.0, 1.0])
    camera_p = unit(np.cross(north_ecliptic, camera_u))
    tilt = math.radians(25.0)
    camera_v = math.sin(tilt) * camera_p + math.cos(tilt) * north_ecliptic
    basis_now = moving_basis(earth_pos, earth_vel)
    l2_now = earth_pos + L2_DISTANCE_KM * basis_now[0]
    moon_offset = np.asarray(moon_now["positionKm"], dtype=float) - earth_pos
    webb_offset = np.asarray(webb_now["positionKm"], dtype=float) - l2_now

    moon_scene_track = []
    for sample in moon_samples:
        sampled_earth = earth_at(float(sample["jdTdb"]))
        local = np.asarray(sample["positionKm"], dtype=float) - np.asarray(sampled_earth["positionKm"], dtype=float)
        ref_local = local_offset_in_reference(local, moving_basis(np.asarray(sampled_earth["positionKm"], dtype=float), np.asarray(sampled_earth["velocityKmS"], dtype=float)), basis_now)
        moon_scene_track.append((earth_pos + ref_local).tolist())

    webb_scene_track = []
    for sample in webb_samples:
        sampled_earth = earth_at(float(sample["jdTdb"]))
        sampled_earth_pos = np.asarray(sampled_earth["positionKm"], dtype=float)
        sampled_l2 = sampled_earth_pos + L2_DISTANCE_KM * unit(sampled_earth_pos)
        local = np.asarray(sample["positionKm"], dtype=float) - sampled_l2
        ref_local = local_offset_in_reference(local, moving_basis(sampled_earth_pos, np.asarray(sampled_earth["velocityKmS"], dtype=float)), basis_now)
        webb_scene_track.append((l2_now + ref_local).tolist())

    pointing_eq = SkyCoord(center[0] * u.deg, center[1] * u.deg, frame="icrs")
    pointing_ecl = pointing_eq.transform_to(GeocentricMeanEcliptic(equinox=Time("J2000")))
    lon, lat = pointing_ecl.lon.to_value(u.rad), pointing_ecl.lat.to_value(u.rad)
    pointing = [math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)]
    orbit_scene = {
        "kind": "physical",
        "sun": [0.0, 0.0, 0.0],
        "earth": earth_pos.tolist(),
        "earthTrack": [earth_at(epoch)["positionKm"] for epoch in earth_epoch],
        "earthTrackEpochsJdTdb": earth_epoch,
        "moon": (earth_pos + moon_offset).tolist(),
        "moonOffset": moon_offset.tolist(),
        "moonTrack": moon_scene_track,
        "l2": l2_now.tolist(),
        "webb": (l2_now + webb_offset).tolist(),
        "webbOffset": webb_offset.tolist(),
        "webbTrack": webb_scene_track,
        "pointing": pointing,
        "camera": {"u": camera_u.tolist(), "v": camera_v.tolist(), "referenceEpoch": "2025-07-01T00:00:00 TDB", "obliquityTiltDeg": 25.0},
        "localMagnification": LOCAL_MAGNIFICATION,
    }
    orbit_path = out / "orbit.json"
    moon_track_rows = [[float(sample["jdTdb"]), *track] for sample, track in zip(moon_samples, moon_scene_track, strict=True)]
    webb_track_rows = [[float(sample["jdTdb"]), *track] for sample, track in zip(webb_samples, webb_scene_track, strict=True)]
    earth_track_rows = [[float(epoch), *earth_at(epoch)["positionKm"]] for epoch in earth_epoch]
    write_json(orbit_path, {
        "schemaVersion": "resolved-orbit-1",
        "epochJdTdb": epoch_jd_tdb,
        "epochIsotTdb": time_tdb.isot,
        "source": "JPL Horizons API via Astroquery",
        "retrievedUtc": horizons_retrieved_utc,
        "api": {"url": "https://ssd-api.jpl.nasa.gov/api/horizons.api", "version": "1.3"},
        "software": {"astroquery": "0.4.11", "astropy": "8.0.3"},
        "targetIds": {"earth": "399", "moon": "301", "webb": "-170", "center": "@10"},
        "frame": "heliocentric-ecliptic-J2000",
        "units": {"position": "km", "velocity": "km/s"},
        "corrections": "geometric vectors; no light-time or aberration correction",
        "queryInput": {"timeScale": "TDB", "referencePlane": "ecliptic", "rawPositionUnits": "AU", "rawVelocityUnits": "AU/day", "queryCenter": "Sun center (@10)"},
        "l2Method": "radial-1,500,000-km-from-Sun estimate",
        "tracks": {
            "earth": {"coverageJdTdb": [earth_epoch[0], earth_epoch[-1]], "cadenceDays": (earth_epoch[-1] - earth_epoch[0]) / (len(earth_epoch) - 1), "samples": earth_track_rows},
            "moon": {"coverageJdTdb": [moon_epoch[0], moon_epoch[-1]], "cadenceDays": (moon_epoch[-1] - moon_epoch[0]) / (len(moon_epoch) - 1), "samples": moon_track_rows, "offsetFrame": "exposure-epoch RTN about Earth"},
            "webb": {"coverageJdTdb": [webb_epoch[0], webb_epoch[-1]], "cadenceDays": (webb_epoch[-1] - webb_epoch[0]) / (len(webb_epoch) - 1), "samples": webb_track_rows, "offsetFrame": "exposure-epoch RTN about radial L2"},
        },
        "state": {"earthVelocityKmS": earth_vel.tolist(), "basisRTN": [axis.tolist() for axis in basis_now], "earth": earth_pos.tolist(), "moon": orbit_scene["moon"], "webb": orbit_scene["webb"], "sun": [0.0, 0.0, 0.0], "l2": l2_now.tolist(), "pointing": pointing, "camera": orbit_scene["camera"]},
        "scene": orbit_scene,
        "fitsEphemeris": {
            "xyzKm": [float(science_header[key]) for key in ("JWST_X", "JWST_Y", "JWST_Z")],
            "frame": str(science_header["REFFRAME"]),
            "epochMjd": float(science_header["EPH_TIME"]),
            "epochScale": "UTC (EPH_TIME matches UTC MJD-AVG per STScI keyword definition)",
            "type": str(science_header["EPH_TYPE"]),
        },
    })

    licenses = out / "licenses"
    licenses.mkdir(exist_ok=True)
    shutil.copyfile(SKY_ROOT / "hyg-v4.1/LICENSE", licenses / "HYG-Database-LICENSE")
    shutil.copyfile(SKY_ROOT / "d3-celestial/LICENSE", licenses / "d3-celestial-LICENSE")
    shutil.copyfile(SKY_ROOT / "hyg-v4.1/README.md", licenses / "HYG-Database-README.md")
    shutil.copyfile(SKY_ROOT / "d3-celestial/data/readme.md", licenses / "d3-celestial-data-README.md")

    image_size = list(Image.open(image_path).size)
    obs_path = out / "observation.json"
    observation = {
        "schemaVersion": "real-exposure-1",
        "versions": {"data": "real-sky-1", "render": "real-card-1", "filter": FILTER_VERSION, "catalog": "local-evidence-only"},
        "product": {"id": fits_path.stem, "uri": f"mast:JWST/product/{fits_path.name}", "file": fits_path.name, "program": program_id, "mission": "JWST", "instrument": str(header["INSTRUME"]), "target": target_name, "detector": str(header["DETECTOR"]), "filter": str(header["FILTER"]), "pupil": pupil_name},
        "time": {"begin": Time(float(header["EXPSTART"]), format="mjd", scale="utc").isot + "Z", "middle": time_utc.isot + "Z", "end": Time(float(header["EXPEND"]), format="mjd", scale="utc").isot + "Z", "method": "MJD-AVG UTC from SCI header", "queryEpochJdTdb": epoch_jd_tdb},
        "provenance": {"mastUri": f"mast:JWST/product/{fits_path.name}", "fitsSha256": sha256_file(fits_path), "fitsBytes": fits_path.stat().st_size, "sourcePngSha256": sha256_file(args.source_png) if args.source_png.is_file() else None, "rebuiltPngMatchedSource": supplied_png_match, "pipelineVersion": str(header.get("CAL_VER", "unknown")), "crdsContext": str(header.get("CRDS_CTX", "unknown")), "targetNameSource": target_name_source, "hygRevision": "3bf37f4b2d5460e1278286320d1d62fab9b493c1", "constellationRevision": "7e720a3de062059d4c5400a379146a601d9010e0", "horizonsRetrievedUtc": horizons_retrieved_utc, "credit": f"NASA/ESA/CSA James Webb Space Telescope; observing program {program_id}; Mikulski Archive for Space Telescopes (MAST) at STScI."},
        "fitsOrbit": {"xyz": [float(science_header[key]) for key in ("JWST_X", "JWST_Y", "JWST_Z")], "frame": str(science_header["REFFRAME"]), "epochMjd": float(science_header["EPH_TIME"]), "epochScale": "UTC", "type": str(science_header["EPH_TYPE"])},
        "image": {"key": image_path.name, "format": "image/png", "size": image_size, "sourceSize": [width, height], "mapping": "full-frame-unflipped; Pillow LANCZOS resize", "stretch": "p1-p99.7-asinh10-v1"},
        "metrics": metrics,
        "sky": {"center": center, "corners": footprint, "reference": [float(science_header["RA_REF"]), float(science_header["DEC_REF"])], "region": region, "abbreviation": abbreviation, "figureKey": "sky.json#scene.figureEdges", "starsKey": "sky.json#scene.overviewStars", "detailStars": len(detail_stars), "overviewStars": len(overview_stars), "detailSegments": len(detail_segments), "detail": {"center": detail_center, "size": detail_size, "corners": detail_corners}},
        "orbit": {"epochJdTdb": epoch_jd_tdb, "source": "JPL Horizons API via Astroquery", "frame": "heliocentric-ecliptic-J2000", "unit": "km", "l2Method": "radial-1,500,000-km-from-Sun estimate", "localMagnification": LOCAL_MAGNIFICATION, "sceneKey": "orbit.json#scene"},
        "processors": {"python": "3.13.5", "astropy": "8.0.3", "astroquery": "0.4.11", "gwcs": "1.0.3", "pillow": Image.__version__},
        "members": {},
    }
    member_paths = [image_path, sky_path, orbit_path, horizons_cache_path, *(licenses / name for name in ("HYG-Database-LICENSE", "d3-celestial-LICENSE", "HYG-Database-README.md", "d3-celestial-data-README.md"))]
    observation["members"] = {str(path.relative_to(out)).replace("\\", "/"): {"bytes": path.stat().st_size, "sha256": sha256_file(path)} for path in member_paths}
    write_json(obs_path, observation)
    print(json.dumps({"status": "PASS", "output": str(out), "product": observation["product"], "image": observation["image"], "metrics": metrics, "sky": {"region": region, "overviewStars": len(overview_stars), "detailStars": len(detail_stars), "overviewSegments": len(overview_segments), "detailSegments": len(detail_segments)}, "orbit": {"epochJdTdb": epoch_jd_tdb, "earthTrack": len(orbit_scene["earthTrack"]), "moonTrack": len(moon_scene_track), "webbTrack": len(webb_scene_track)}, "sourcePngMatched": supplied_png_match}, indent=2))


if __name__ == "__main__":
    main()
