import type { SkyFixture, SkyPoint, SkySegment, SkyStar } from "./sky-fixtures";

/** Resolved spherical inputs required by the pure celestial-panel renderer. */
export type SkyPanelScene = Pick<SkyFixture, "center" | "footprint" | "figureEdges" | "overviewStars" | "detail"> &
  Partial<Pick<SkyFixture, "id">> & { figureStars?: readonly SkyPoint[] };

/** Data-driven labels keep the production panel independent of synthetic fixture IDs. */
export type SkyPanelDisplay = {
  heading?: string;
  coordinateCaption?: string;
  symbolicPointingSquare?: boolean;
  constellationOverviewZoom?: number;
  pointingReferenceSquareSize?: number;
};

type V3 = readonly [number, number, number];
type P2 = readonly [number, number];
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const rad = (degrees: number) => degrees * Math.PI / 180;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: V3): V3 => {
  const length = Math.hypot(...v);
  return length ? [v[0] / length, v[1] / length, v[2] / length] : [1, 0, 0];
};
const vector = ([ra, dec]: SkyPoint): V3 => [Math.cos(rad(dec)) * Math.cos(rad(ra)), Math.cos(rad(dec)) * Math.sin(rad(ra)), Math.sin(rad(dec))];
const skyPoint = ([x, y, z]: V3): SkyPoint => [((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360, Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI];
const xml = (value: string) => value.replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch]!);
const fmt = (n: number) => Number.isFinite(n) ? n.toFixed(2) : "0";

function basis(center: SkyPoint): { c: V3; east: V3; north: V3 } {
  const c = vector(center);
  // The recorded RA fixes roll at a pole where the usual cross-product basis is ambiguous.
  const east = unit([-Math.sin(rad(center[0])), Math.cos(rad(center[0])), 0]);
  const north = unit([
    c[1] * east[2] - c[2] * east[1],
    c[2] * east[0] - c[0] * east[2],
    c[0] * east[1] - c[1] * east[0],
  ]);
  return { c, east, north };
}

function projectionCenter(fixture: SkyPanelScene): SkyPoint {
  const points: SkyPoint[] = [fixture.center, ...fixture.footprint, ...fixture.figureEdges.flat(), ...fixture.overviewStars.map(([ra, dec]) => [ra, dec] as const), ...fixture.detail.corners];
  const mean = points.reduce<V3>((sum, p) => {
    const v = vector(p);
    return [sum[0] + v[0], sum[1] + v[1], sum[2] + v[2]];
  }, [0, 0, 0]);
  const [x, y, z] = unit(mean);
  return [((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360, Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI];
}

function stereographic(point: SkyPoint, frame: ReturnType<typeof basis>): P2 | null {
  const p = vector(point);
  const denominator = 1 + dot(frame.c, p);
  if (denominator < 1e-8) return null;
  // East is left on a sky chart; north is up.
  return [-2 * dot(p, frame.east) / denominator, -2 * dot(p, frame.north) / denominator];
}

function gnomonic(point: SkyPoint, frame: ReturnType<typeof basis>): P2 | null {
  const p = vector(point);
  const denominator = dot(p, frame.c);
  if (denominator <= 1e-8) return null;
  return [-dot(p, frame.east) / denominator, -dot(p, frame.north) / denominator];
}

function bounds(points: readonly P2[]): Bounds {
  return points.reduce<Bounds>((b, [x, y]) => ({ minX: Math.min(b.minX, x), minY: Math.min(b.minY, y), maxX: Math.max(b.maxX, x), maxY: Math.max(b.maxY, y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function mapToRect(p: P2, b: Bounds, x: number, y: number, width: number, height: number, pad = 10, zoom = 1): P2 {
  const sx = (width - 2 * pad) / Math.max(b.maxX - b.minX, 1e-12);
  const sy = (height - 2 * pad) / Math.max(b.maxY - b.minY, 1e-12);
  const scale = Math.min(sx, sy) * zoom;
  return [x + width / 2 + (p[0] - (b.minX + b.maxX) / 2) * scale, y + height / 2 + (p[1] - (b.minY + b.maxY) / 2) * scale];
}

function minOrientedShortSide(points: readonly P2[]): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(angle), s = Math.sin(angle);
    const projected = points.map(([x, y]) => [x * c + y * s, -x * s + y * c] as P2);
    const box = bounds(projected);
    best = Math.min(best, Math.min(box.maxX - box.minX, box.maxY - box.minY));
  }
  return Number.isFinite(best) ? best : 0;
}

function segmentPath(segment: SkySegment, frame: ReturnType<typeof basis>, toScreen: (point: P2) => P2, clip?: Bounds): string {
  const a = gnomonic(segment[0], frame), b = gnomonic(segment[1], frame);
  if (!a || !b) return "";
  if (!clip) {
    const [p, q] = [toScreen(a), toScreen(b)];
    return `M${fmt(p[0])},${fmt(p[1])} L${fmt(q[0])},${fmt(q[1])}`;
  }
  // Liang-Barsky clipping in the detail's tangent plane preserves crossing segments
  // even when neither catalog endpoint lies inside the visible window.
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy], q = [a[0] - clip.minX, clip.maxX - a[0], a[1] - clip.minY, clip.maxY - a[1]];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) { if (q[i] < 0) return ""; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return "";
  }
  const r = toScreen([a[0] + t0 * dx, a[1] + t0 * dy]);
  const s = toScreen([a[0] + t1 * dx, a[1] + t1 * dy]);
  return `M${fmt(r[0])},${fmt(r[1])} L${fmt(s[0])},${fmt(s[1])}`;
}

function pathFromSky(points: readonly SkyPoint[], frame: ReturnType<typeof basis>, toScreen: (p: P2) => P2, close = false): string {
  const sampled: SkyPoint[] = [];
  const edges = close ? points.length : points.length - 1;
  for (let i = 0; i < edges; i++) {
    const a = vector(points[i]), b = vector(points[(i + 1) % points.length]);
    const omega = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
    const sinOmega = Math.sin(omega);
    const steps = Math.max(1, Math.ceil(omega / rad(0.25)));
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      const v: V3 = sinOmega < 1e-10
        ? unit([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
        : unit([
          a[0] * Math.sin((1 - t) * omega) / sinOmega + b[0] * Math.sin(t * omega) / sinOmega,
          a[1] * Math.sin((1 - t) * omega) / sinOmega + b[1] * Math.sin(t * omega) / sinOmega,
          a[2] * Math.sin((1 - t) * omega) / sinOmega + b[2] * Math.sin(t * omega) / sinOmega,
        ]);
      sampled.push(skyPoint(v));
    }
  }
  if (!close) sampled.push(points[points.length - 1]);
  const projected = sampled.map((point) => stereographic(point, frame)).filter((p): p is P2 => p !== null);
  if (projected.length < 2) return "";
  const screen = projected.map(toScreen);
  return screen.map(([x, y], index) => `${index ? "L" : "M"}${fmt(x)},${fmt(y)}`).join(" ") + (close ? " Z" : "");
}

function starMarks(stars: readonly SkyStar[], project: (point: SkyPoint) => P2 | null, radius: number): string {
  return stars.map(([ra, dec, magnitude]) => {
    const p = project([ra, dec]);
    if (!p) return "";
    const r = Math.max(1.1, Math.min(radius, radius * (4.5 / Math.max(1, magnitude))));
    return `<circle cx="${fmt(p[0])}" cy="${fmt(p[1])}" r="${fmt(r)}" fill="#d8e3ff"/>`;
  }).join("");
}

function figureStarMarks(points: readonly SkyPoint[] | undefined, project: (point: SkyPoint) => P2 | null, radius: number): string {
  return (points ?? []).map((point) => {
    const p = project(point);
    return p ? `<circle cx="${fmt(p[0])}" cy="${fmt(p[1])}" r="${radius}" fill="#fff" stroke="#d8e3ff" stroke-width=".65"/>` : "";
  }).join("");
}

function overviewContent(fixture: SkyPanelScene, x: number, y: number, width: number, height: number, includeDetailOutline: boolean, symbolicFootprint = false, zoom = 1): { svg: string; outline: P2[]; shortSideAtReference: number } {
  const center = projectionCenter(fixture), frame = basis(center);
  const project = (p: SkyPoint) => stereographic(p, frame);
  const allPoints = [...fixture.footprint, ...fixture.figureEdges.flat(), ...fixture.detail.corners, ...fixture.overviewStars.map(([ra, dec]) => [ra, dec] as const)];
  const projected = allPoints.map(project).filter((p): p is P2 => p !== null);
  const b = bounds(projected);
  const fieldPoints = fixture.footprint.map(project).filter((p): p is P2 => p !== null);
  const shortSide = minOrientedShortSide(fieldPoints);
  const referenceScale = Math.min(540 / Math.max(b.maxX - b.minX, 1e-12), 250 / Math.max(b.maxY - b.minY, 1e-12));
  const toScreen = (p: P2) => mapToRect(p, b, x, y, width, height, 9, zoom);
  const outline = fixture.detail.corners.map(project).filter((p): p is P2 => p !== null).map(toScreen);
  const footprint = pathFromSky(fixture.footprint, frame, toScreen, true);
  const edges = fixture.figureEdges.map((edge) => {
    const path = pathFromSky(edge, frame, toScreen);
    return path ? `<path d="${path}"/>` : "";
  }).join("");
  const outlineSvg = includeDetailOutline && outline.length === 4 ? `<path d="${outline.map(([px, py], i) => `${i ? "L" : "M"}${fmt(px)},${fmt(py)}`).join(" ")} Z" fill="#7a8799" fill-opacity=".08" stroke="#e4d6ff" stroke-dasharray="4 3" stroke-width="1.4"/>` : "";
  const stars = starMarks(fixture.overviewStars, (p) => { const q = project(p); return q ? toScreen(q) : null; }, 2.4);
  const figureStars = figureStarMarks(fixture.figureStars, (p) => { const q = project(p); return q ? toScreen(q) : null; }, 3.2);
  const selectionSvg = includeDetailOutline && outline.length === 4
    ? `<path d="${outline.map(([px, py], i) => `${i ? "L" : "M"}${fmt(px)},${fmt(py)}`).join(" ")} Z" fill="#a976e8" fill-opacity=".08" stroke="#bd83ff" stroke-width="1.7"/>`
    : outlineSvg;
  const trueFootprint = symbolicFootprint ? "" : `<path d="${footprint}" fill="#a976e8" fill-opacity=".18" stroke="#bd83ff" stroke-width="2"/>`;
  return {
    svg: `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="5" fill="#090d18"/>${selectionSvg}<g fill="none" stroke="#8999be" stroke-opacity=".82" stroke-width="1.4">${edges}</g>${stars}${figureStars}${trueFootprint}`,
    outline,
    shortSideAtReference: shortSide * referenceScale,
  };
}

function detailContent(fixture: SkyPanelScene, x: number, y: number, width: number, height: number, symbolicFootprint = false, referenceSquareSize = 30): string {
  const frame = basis(fixture.detail.center);
  const windowWidth = Math.tan(rad(fixture.detail.sizeDeg[0] / 2));
  const windowHeight = Math.tan(rad(fixture.detail.sizeDeg[1] / 2));
  const clip: Bounds = { minX: -windowWidth, maxX: windowWidth, minY: -windowHeight, maxY: windowHeight };
  const pad = 9;
  const scale = Math.min((width - 2 * pad) / (clip.maxX - clip.minX), (height - 2 * pad) / (clip.maxY - clip.minY));
  const toScreen = ([eastLeft, northUp]: P2): P2 => [x + width / 2 + eastLeft * scale, y + height / 2 + northUp * scale];
  const field = fixture.footprint.map((p) => gnomonic(p, frame)).filter((p): p is P2 => p !== null).map(toScreen);
  const footprint = field.length === 4 ? `${field.map(([px, py], i) => `${i ? "L" : "M"}${fmt(px)},${fmt(py)}`).join(" ")} Z` : "";
  const center = gnomonic(fixture.center, frame);
  const locator = symbolicFootprint && center
    ? (() => { const [cx, cy] = toScreen(center); return `<rect x="${fmt(cx - referenceSquareSize / 2)}" y="${fmt(cy - referenceSquareSize / 2)}" width="${referenceSquareSize}" height="${referenceSquareSize}" fill="#a976e8" fill-opacity=".35" stroke="#ead8ff" stroke-width="1.3"/>`; })()
    : "";
  const segments = fixture.detail.segments.map((segment) => segmentPath(segment, frame, toScreen, clip)).filter(Boolean).map((d) => `<path d="${d}" fill="none" stroke="#9daecc" stroke-width="1.3"/>`).join("");
  const stars = starMarks(fixture.detail.stars, (point) => {
    const p = gnomonic(point, frame);
    if (!p || p[0] < clip.minX || p[0] > clip.maxX || p[1] < clip.minY || p[1] > clip.maxY) return null;
    return toScreen(p);
  }, 3.2);
  const figureStars = figureStarMarks(fixture.figureStars, (point) => {
    const p = gnomonic(point, frame);
    if (!p || p[0] < clip.minX || p[0] > clip.maxX || p[1] < clip.minY || p[1] > clip.maxY) return null;
    return toScreen(p);
  }, 3.8);
  const barPx = Math.min(38, width * 0.2);
  const barX = x + width - barPx - 13;
  const barY = y + height - 17;
  const skyVectorAt = (screenX: number, screenY: number): V3 => {
    const gnomonicX = (screenX - (x + width / 2)) / scale;
    const gnomonicY = (screenY - (y + height / 2)) / scale;
    return unit([
      frame.c[0] - gnomonicX * frame.east[0] - gnomonicY * frame.north[0],
      frame.c[1] - gnomonicX * frame.east[1] - gnomonicY * frame.north[1],
      frame.c[2] - gnomonicX * frame.east[2] - gnomonicY * frame.north[2],
    ]);
  };
  const barStart = skyVectorAt(barX, barY);
  const barEnd = skyVectorAt(barX + barPx, barY);
  const cross: V3 = [
    barStart[1] * barEnd[2] - barStart[2] * barEnd[1],
    barStart[2] * barEnd[0] - barStart[0] * barEnd[2],
    barStart[0] * barEnd[1] - barStart[1] * barEnd[0],
  ];
  const angleDeg = Math.atan2(Math.hypot(...cross), dot(barStart, barEnd)) * 180 / Math.PI;
  const label = angleDeg >= 1 ? `${angleDeg.toFixed(1)}°` : `${(angleDeg * 60).toFixed(1)}′`;
  const trueFootprint = symbolicFootprint ? "" : `<path d="${footprint}" fill="#a976e8" fill-opacity=".2" stroke="#bd83ff" stroke-width="1.8"/>`;
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="5" fill="#090d18"/>${trueFootprint}${segments}${figureStars}${stars}${locator}<path d="M${fmt(barX)},${fmt(barY)} h${fmt(barPx)}" stroke="#f3f4f8" stroke-width="2"/><text x="${fmt(x + width - 13)}" y="${fmt(y + height - 21)}" fill="#d8deeb" text-anchor="end" font-size="8" font-family="Arial,sans-serif">${label}</text>`;
}

export function renderSkyPanel(fixture: SkyPanelScene, display: SkyPanelDisplay = {}): string {
  const panelX = 578, panelY = 18, panelW = 484, panelH = 260;
  const zoom = display.constellationOverviewZoom ?? 1;
  const referenceSquareSize = display.pointingReferenceSquareSize ?? 30;
  if (!Number.isFinite(zoom) || zoom <= 0) throw new RangeError("Constellation overview zoom must be a positive finite value");
  if (!Number.isFinite(referenceSquareSize) || referenceSquareSize <= 0) throw new RangeError("Pointing reference square size must be a positive finite value");
  const overview = overviewContent(fixture, 594, 59, 452, 198, false, display.symbolicPointingSquare, zoom);
  const mode = overview.shortSideAtReference >= 12 ? "single" : "double";
  const heading = display.heading ?? fixture.id ?? "Sky field";
  const coordinateCaption = display.coordinateCaption ?? (fixture.id ? "synthetic ICRS" : "ICRS");
  const headerLabel = mode === "single" ? "SKY OVERVIEW" : "CONSTELLATION + LOCAL REFERENCE";
  const header = `<rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="12" fill="#101523" stroke="#343c50"/><text x="598" y="46" fill="#f3f4f8" font-size="15" font-weight="700" font-family="Arial,sans-serif">${xml(heading)} · ${headerLabel}</text>`;
  if (mode === "single") {
    return `${header}${overview.svg}<text x="1040" y="269" text-anchor="end" fill="#8992a2" font-size="8" font-family="Arial,sans-serif">north ↑ · east ← · ${xml(coordinateCaption)}</text>`;
  }
  const left = overviewContent(fixture, 594, 63, 185, 192, true, display.symbolicPointingSquare, zoom);
  const rightX = 806, rightY = 63, rightW = 240, rightH = 192;
  const overviewLabel = `<text x="686" y="76" text-anchor="middle" fill="#b7c2d7" font-size="11" font-family="Arial,sans-serif">CONSTELLATION</text>`;
  const detailLabel = `<text x="926" y="75" text-anchor="middle" fill="#b7c2d7" font-size="9" font-family="Arial,sans-serif">LOCAL REFERENCE · NORTH UP / EAST LEFT</text>`;
  let connector = "";
  if (left.outline.length === 4) {
    const rightEdge = [...left.outline].sort((a, b) => b[0] - a[0]).slice(0, 2);
    const upper = [...rightEdge].sort((a, b) => a[1] - b[1])[0];
    const lower = [...rightEdge].sort((a, b) => b[1] - a[1])[0];
    connector = `<path d="M${fmt(upper[0])},${fmt(upper[1])} L${rightX},${rightY + 20} M${fmt(lower[0])},${fmt(lower[1])} L${rightX},${rightY + rightH - 20}" fill="none" stroke="#e4d6ff" stroke-opacity=".72" stroke-width="1"/>`;
  }
  const map = left.svg;
  const locatorNote = display.symbolicPointingSquare ? " · detail square not to scale" : "";
  return `${header}${map}${connector}${detailContent(fixture, rightX, rightY + 14, rightW, rightH - 14, display.symbolicPointingSquare, referenceSquareSize)}${overviewLabel}${detailLabel}<text x="598" y="269" fill="#8992a2" font-size="8" font-family="Arial,sans-serif">north ↑ · east ← · ${xml(coordinateCaption + locatorNote)}</text>`;
}
