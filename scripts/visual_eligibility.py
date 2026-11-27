"""Owner's visual acceptance rule for JWST exposure samples."""

from __future__ import annotations

import math
FILTER_VERSION = "visual-filter-1"


def es_apta(metricas):
    brillo = metricas["brillo_mediano_fondo_png"]
    salto = metricas["salto_total"]
    if brillo is None or not math.isfinite(brillo):
        return False
    if brillo <= 45:
        return True
    return brillo < 90 and salto is not None and math.isfinite(salto) and salto <= 0.10
