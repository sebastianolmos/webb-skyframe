"""Inspect a JWST cal FITS WCS and compare its geocentric position with Horizons."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import warnings
from datetime import datetime, timezone
from pathlib import Path

import asdf
import asdf_astropy  # noqa: F401 - registers Astropy ASDF converters
import asdf_wcs_schemas  # noqa: F401 - registers GWCS ASDF schemas
import gwcs  # noqa: F401 - registers GWCS ASDF converters
import numpy as np
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.time import Time
from astroquery.jplhorizons import Horizons


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "fits_path",
        nargs="?",
        default="jw09438007001_03103_00002_nrca3_cal.fits",
        help="local calibrated JWST FITS product",
    )
    args = parser.parse_args()
    fits_path = Path(args.fits_path)
    digest = hashlib.sha256()
    with fits_path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        with fits.open(fits_path, memmap=False) as hdus:
            primary = hdus[0].header
            science = hdus["SCI"].header
            sci_data = np.asarray(hdus["SCI"].data)
            dq_data = np.asarray(hdus["DQ"].data) if "DQ" in hdus else None
            if sci_data.ndim != 2 or (dq_data is not None and sci_data.shape != dq_data.shape):
                raise ValueError("SCI must be 2-D and match DQ dimensions when DQ is present")
            height, width = sci_data.shape
            valid = np.isfinite(sci_data) if dq_data is None else np.isfinite(sci_data) & ((dq_data & 1) == 0)
            if int(valid.sum()) < 100:
                raise ValueError("Fewer than 100 finite usable SCI pixels")
            science_measurements = {
                "shape": list(sci_data.shape),
                "unit": str(hdus["SCI"].header.get("BUNIT")),
                "finite_fraction": float(np.isfinite(sci_data).mean()),
                "dq_present": dq_data is not None,
                "dq_do_not_use_clear_fraction": float(((dq_data & 1) == 0).mean()) if dq_data is not None else None,
                "valid_fraction": float(valid.mean()),
                "valid_median": float(np.median(sci_data[valid])),
                "valid_p99": float(np.percentile(sci_data[valid], 99)),
                "center_sci": float(sci_data[(height - 1) // 2, (width - 1) // 2]),
                "center_dq": int(dq_data[(height - 1) // 2, (width - 1) // 2]) if dq_data is not None else None,
            }
            payload = hdus["ASDF"].data["ASDF_METADATA"][0].tobytes()
            with asdf.open(io.BytesIO(payload)) as af:
                wcs = af.tree["meta"]["wcs"]

                # The first four coordinates are the outer detector boundaries;
                # the last is the geometric center. GWCS pixel coordinates are
                # zero-based, so boundaries lie half a pixel outside edge centers.
                xs = np.array([-0.5, width - 0.5, width - 0.5, -0.5, (width - 1) / 2])
                ys = np.array([-0.5, -0.5, height - 0.5, height - 0.5, (height - 1) / 2])
                ras, decs = wcs(xs, ys)
                # FITS CRPIX values are 1-based; GWCS detector pixels are
                # 0-based. RA_REF/DEC_REF describe this reference point, which
                # may differ from the geometric center of a subarray.
                reference_x = float(hdus["SCI"].header["CRPIX1"]) - 1.0
                reference_y = float(hdus["SCI"].header["CRPIX2"]) - 1.0
                reference_ra, reference_dec = wcs(reference_x, reference_y)

    if primary["TELESCOP"] != "JWST" or primary["INSTRUME"] != "NIRCAM":
        raise ValueError("The input is not a JWST NIRCam product")
    if not str(primary["DETECTOR"]).startswith("NRC") or not str(primary.get("FILTER", "")).strip():
        raise ValueError("The input does not identify a NIRCam detector and filter")
    if wcs.output_frame.name != "world" or len(wcs.available_frames) < 3:
        raise ValueError("The FITS ASDF extension did not yield a celestial GWCS")
    if not np.isfinite(ras).all() or not np.isfinite(decs).all():
        raise ValueError("Non-finite coordinates returned by the FITS GWCS")

    center = SkyCoord(ras[-1] * u.deg, decs[-1] * u.deg, frame="icrs")
    reference = SkyCoord(science["RA_REF"] * u.deg, science["DEC_REF"] * u.deg, frame="icrs")
    center_offset_arcsec = float(center.separation(reference).arcsec)
    wcs_reference = SkyCoord(reference_ra * u.deg, reference_dec * u.deg, frame="icrs")
    reference_offset_arcsec = float(wcs_reference.separation(reference).arcsec)
    # This is a diagnostic only. Header rounding and pipeline conventions can
    # produce a small offset; it is not an image eligibility criterion.

    # Horizons vector epochs are TDB. Convert the local exposure midpoint
    # MJD-AVG from UTC. JWST TDB-MID/BMIDTIME are barycentric-corrected times
    # and are not the spacecraft's local midpoint epoch for this vector query.
    time_utc = Time(science["MJD-AVG"], format="mjd", scale=primary["TIMESYS"].lower())
    time_tdb = time_utc.tdb
    epoch_tdb = float(time_tdb.mjd)
    query = Horizons(id="-170", location="@399", epochs=float(time_tdb.jd))
    vector = query.vectors(refplane="earth")
    horizons_xyz_km = [float(vector[0][axis]) * u.au.to(u.km) for axis in ("x", "y", "z")]
    fits_xyz_km = [float(science[key]) / 1000.0 for key in ("OBSGEO-X", "OBSGEO-Y", "OBSGEO-Z")]
    component_delta_km = [h - f for h, f in zip(horizons_xyz_km, fits_xyz_km, strict=True)]
    position_delta_km = float(np.linalg.norm(component_delta_km))
    if position_delta_km > 1.0:
        raise ValueError(f"Horizons and FITS OBSGEO differ by {position_delta_km:.3f} km")

    result = {
        "status": "PASS",
        "file": fits_path.name,
        "mast_uri": f"mast:JWST/product/{fits_path.name}",
        "file_bytes": fits_path.stat().st_size,
        "file_sha256": digest.hexdigest(),
        "horizons_retrieved_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "versions": {
            "python": __import__("platform").python_version(),
            "astropy": __import__("astropy").__version__,
            "astroquery": __import__("astroquery").__version__,
            "gwcs": __import__("gwcs").__version__,
        },
        "product": {
            "detector": primary["DETECTOR"],
            "filter": primary["FILTER"],
            "science_shape": [int(science["NAXIS2"]), int(science["NAXIS1"])],
            "science_measurements": science_measurements,
            "wcs_frames": list(wcs.available_frames),
            "wcs_corner_and_center_icrs_deg": [
                [round(float(ra), 9), round(float(dec), 9)] for ra, dec in zip(ras, decs, strict=True)
            ],
            "wcs_reference_pixel_sci_xy_zero_based": [reference_x, reference_y],
            "wcs_reference_pixel_icrs_deg": [float(reference_ra), float(reference_dec)],
            "reference_pixel_offset_from_ra_ref_arcsec": reference_offset_arcsec,
            "center_offset_from_ra_ref_arcsec": center_offset_arcsec,
            "center_constellation_roman_1987": center.get_constellation(),
        },
        "time": {
            "timesys": primary["TIMESYS"],
            "mjd_avg_utc": float(science["MJD-AVG"]),
            "mjd_avg_to_tdb_mjd": epoch_tdb,
            "mjd_avg_to_tdb_isot": time_tdb.isot,
            "barycentric_tdb_mid_header_mjd": float(science["TDB-MID"]),
            "barycentric_correction_seconds": float(primary["BARTDELT"]),
        },
        "jwst_geocentric_position": {
            "horizons_target": str(vector[0]["targetname"]),
            "horizons_target_id": "-170",
            "horizons_center": "Earth center (@399)",
            "horizons_reference_frame": "ICRF, Earth-equator reference plane",
            "horizons_correction": "geometric; no light-time or aberration correction",
            "horizons_xyz_km": horizons_xyz_km,
            "fits_obsgeo_xyz_km": fits_xyz_km,
            "component_delta_horizons_minus_fits_km": component_delta_km,
            "vector_delta_norm_km": position_delta_km,
            "note": "Within 1 km after converting local MJD-AVG UTC to TDB; barycentric TDB-MID is retained separately.",
        },
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
