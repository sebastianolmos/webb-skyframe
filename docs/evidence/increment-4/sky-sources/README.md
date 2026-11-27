# Increment 4 sky-source audit

Audit date: 2026-11-26. Source files were fetched from fixed Git commit URLs. The 34 MB raw HYG CSV was streamed to a temporary workspace file, hashed, reduced to the retained catalogue below, then removed; source identity remains reproducible from its immutable URL and SHA-256.

## Decisions

| Use | Source and fixed revision | Terms and treatment |
|---|---|---|
| Reference stars | HYG v4.1, `astronexus/HYG-Database` commit `3bf37f4b2d5460e1278286320d1d62fab9b493c1`, `hyg/CURRENT/hygdata_v41.csv` | CC BY-SA 4.0. Retain attribution and licence; treat the filtered/adapted subset under CC BY-SA 4.0. HYG documents RA/Dec at epoch 2000.0 and apparent visual magnitude. |
| Constellation figures | `ofrohn/d3-celestial` commit `7e720a3de062059d4c5400a379146a601d9010e0`, `data/constellations.lines.json` | BSD 3-Clause notice retained. Its data README attributes western constellation lines to IAU material with modifications by Olaf Frohn. |
| Region name | `astropy.coordinates.get_constellation` | Use the implementation that precesses to B1875 and applies the Roman (1987) Delporte table. Astropy 8.0.3 was exercised against the real FITS center and returned Scutum; cite Roman/Astropy in each generated bundle. Do not distribute the internal boundary table separately. |

### Rejected candidate and CDS terms

The d3-celestial `data/stars.6.json` candidate was downloaded from the same d3 commit and then discarded. Its project README identifies XHIP / VizieR V/137D as the star source. CDS's current legal terms state that each dataset's specific user licence applies and that data must be cited; VizieR usage guidance limits use to scientific context unless the underlying catalogue's terms permit more. Neither the XHIP ReadMe nor the material available in this audit established clear terms for redistributing that catalogue through public card bundles. Its SHA-256 was `0297B8FA3ADFBCE1DC26566F61C4ABCC1DF4F29C6A28729CA06B56D1C6D25602` (656,721 bytes). It is not retained or used.

VI/49 (Davenhall & Leggett 1989), also referenced by d3-celestial for boundaries, was not selected as a separately redistributed resource. CDS's legal page requires dataset-specific terms; the VI/49 catalogue ReadMe identifies its bibliographic origin and revisions but does not state a clear redistribution licence. Region labels instead come from Astropy's documented Roman (1987) implementation. The CDS legal page snapshot retained below records the terms reviewed. Its SHA-256 is `E36FB11140717D60027653751091B5B3132FA710B855E5EFF37C40BD2086AC06` (43,532 bytes).

## HYG subset construction

Source URL: <https://raw.githubusercontent.com/astronexus/HYG-Database/3bf37f4b2d5460e1278286320d1d62fab9b493c1/hyg/CURRENT/hygdata_v41.csv>

Raw source size: 33,932,548 bytes. Raw source SHA-256: `D9F69FD86BBF90A4E4D52B4C5C53EACFA6DFC0BFDEF85BFD94F095E0BEBE4EBD`.

Deterministic selection: keep rows with `mag <= 6.0` and `dist > 0` (excludes the Sun); convert `ra` hours to degrees (`raDeg = (ra * 15) mod 360`); retain `dec` degrees and apparent visual magnitude; use the source row's stable integer `id`. Round RA/Dec to 8 decimal places and magnitude to 3. This produced 5,070 stars. The resulting JSON parsed successfully and is retained at [hyg-v4.1-stars-mag6.json](hyg-v4.1-stars-mag6.json), 371,986 bytes, SHA-256 `2B4D54F0A83DB866C6D2EDA76CD78BBCC713CC14E1CE8812093FB3EE586DF673`.

The subset is a share-alike derivative: preserve David Nash / Astronexus attribution and the full CC BY-SA 4.0 licence with every source or binary distribution. It is an initial full-sky reference list; the exposure bundle builder will select only stars within each exposure's sky window.

## Archived audit files and hashes

All paths below are relative to this directory. These exact upstream files were downloaded from commit `7e720a3de062059d4c5400a379146a601d9010e0` for d3-celestial or `3bf37f4b2d5460e1278286320d1d62fab9b493c1` for HYG.

| File | Bytes | SHA-256 |
|---|---:|---|
| `hyg-v4.1-stars-mag6.json` | 371,986 | `2B4D54F0A83DB866C6D2EDA76CD78BBCC713CC14E1CE8812093FB3EE586DF673` |
| `hyg-v4.1/LICENSE` | 422 | `F404190403D31E0CE7223F4CB7AF954485AD88077358330754DC5C892A856627` |
| `hyg-v4.1/README.md` | 3,930 | `19D40E234334C781E07D15C8673F930597875ACA914DB5B5783ABB738A1085B7` |
| `hyg-v4.1/hyg/version-info.md` | 19,933 | `B7C87B3730B2F225793F5835E9AFAB8E548AE9DC04969A671EB43B1EF90BB394` |
| `d3-celestial/data/constellations.lines.json` | 27,136 | `294F66BEF5D5CF50B1E17F16D2EFA1D97A15131612C68DD935ADEF6E7373E13C` |
| `d3-celestial/data/readme.md` | 7,563 | `F222A083836789455ED88726EFB88AD80FA6A5A50538DD59D4600F2240E5A387` |
| `d3-celestial/LICENSE` | 1,480 | `A8C79239001AD4BEA243D1796B85084E1FC39309C5C5A663930A1B46320254C6` |
| `d3-celestial/readme.md` | 40,558 | `C3D77EA7E64565A31876CD2BE3C2BC71919712E0379ECD1D98B490AFC68703E2` |
| `cds-vi49/cds-legals.html` | 43,532 | `E36FB11140717D60027653751091B5B3132FA710B855E5EFF37C40BD2086AC06` |

## References

- [HYG v4.1 source](https://github.com/astronexus/HYG-Database/tree/3bf37f4b2d5460e1278286320d1d62fab9b493c1/hyg/CURRENT)
- [HYG CC BY-SA 4.0 licence](https://github.com/astronexus/HYG-Database/blob/3bf37f4b2d5460e1278286320d1d62fab9b493c1/LICENSE)
- [d3-celestial source revision](https://github.com/ofrohn/d3-celestial/tree/7e720a3de062059d4c5400a379146a601d9010e0)
- [CDS legal terms](https://cds.unistra.fr/legals/)
- [VI/49 catalogue ReadMe](https://cdsarc.cds.unistra.fr/viz-bin/ReadMe/VI/49?format=html&tex=true)
- [VizieR XHIP V/137D ReadMe](https://cdsarc.cds.unistra.fr/viz-bin/ReadMe/V/137D?format=html&tex=true)
- [Astropy constellation classifier](https://docs.astropy.org/en/stable/api/astropy.coordinates.get_constellation.html)
- Roman, N. G. 1987, “Identification of a Constellation from a Position,” *Publications of the Astronomical Society of the Pacific*, 99, 695–699.
