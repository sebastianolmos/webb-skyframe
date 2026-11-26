import { describe, expect, it } from "vitest";
import { SKY_FIXTURES, type SkyPoint } from "../../src/sky-fixtures";
import { renderSkyPanel } from "../../src/sky-renderer";

const radians = (degrees: number) => degrees * Math.PI / 180;
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const skyVector = ([ra, dec]: SkyPoint) => [Math.cos(radians(dec)) * Math.cos(radians(ra)), Math.cos(radians(dec)) * Math.sin(radians(ra)), Math.sin(radians(dec))];

function fixture(id: string) {
  const selected = SKY_FIXTURES.find((item) => item.id === id);
  if (!selected) throw new Error(`Missing synthetic sky fixture: ${id}`);
  return selected;
}

function pathCoordinates(svg: string): number[][] {
  return [...svg.matchAll(/<path d="([^"]+)"/g)].map(([, path]) =>
    [...path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].flatMap(([, x, y]) => [Number(x), Number(y)]),
  );
}

describe("synthetic celestial panel edge cases", () => {
  it("projects RA=0 wrap edges within the overview instead of drawing across the panel", () => {
    const svg = renderSkyPanel(fixture("ra-zero-wrap"));
    expect(svg).toContain("ra-zero-wrap · SKY OVERVIEW");
    const coordinates = pathCoordinates(svg);
    expect(coordinates.flat().length).toBeGreaterThan(0);
    expect(coordinates.flat().every(Number.isFinite)).toBe(true);
    const figureGroup = svg.match(/<g fill="none" stroke="#8999be" stroke-opacity="\.82" stroke-width="1\.4">([\s\S]*?)<\/g>/)?.[1] ?? "";
    expect([...figureGroup.matchAll(/<path /g)]).toHaveLength(fixture("ra-zero-wrap").figureEdges.length);
    const maxStep = [...figureGroup.matchAll(/<path d="([^"]+)"/g)].reduce((largest, [, path]) => {
      const points = [...path.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)]
        .map(([, x, y]) => [Number(x), Number(y)]);
      return Math.max(largest, ...points.slice(1).map((point, index) => Math.hypot(point[0] - points[index][0], point[1] - points[index][1])));
    }, 0);
    expect(maxStep).toBeLessThan(200);
    // Paths remain in the card's sky panel; no 0°/360° screen-spanning stroke appears.
    for (const [x, y] of coordinates) {
      expect(x).toBeGreaterThan(578);
      expect(x).toBeLessThan(1062);
      expect(y).toBeGreaterThan(18);
      expect(y).toBeLessThan(278);
    }
  });

  it("uses the rotated field's short side for the reference-width mode cutoff", () => {
    expect(renderSkyPanel(fixture("wide-field"))).toContain("wide-field · SKY OVERVIEW</text>");
    expect(renderSkyPanel(fixture("tiny-sparse-crossing"))).toContain("tiny-sparse-crossing · SKY OVERVIEW + DETAIL");
    const svg = renderSkyPanel(fixture("rotated-footprint"));
    expect(svg).toContain("rotated-footprint · SKY OVERVIEW + DETAIL");
  });

  it("places north up and east left in the gnomonic detail", () => {
    const base = fixture("tiny-sparse-crossing");
    const oriented = {
      ...base,
      id: "cardinal-orientation",
      detail: {
        ...base.detail,
        stars: [[120, 22, 1], [120.02, 22, 1], [120, 22.02, 1]] as const,
      },
    };
    const svg = renderSkyPanel(oriented);
    const markers = [...svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)"[^>]*fill="#d8e3ff"/g)]
      .map(([, x, y]) => [Number(x), Number(y)]);
    const [center, east, north] = markers.slice(-3);
    expect(east[0]).toBeLessThan(center[0]);
    expect(north[1]).toBeLessThan(center[1]);
  });

  it("keeps every recorded inverse window corner on the detail's angular rectangle", () => {
    for (const sky of SKY_FIXTURES) {
      const center = skyVector(sky.detail.center);
      const [ra, dec] = sky.detail.center.map(radians) as [number, number];
      const east = [-Math.sin(ra), Math.cos(ra), 0];
      const north = [-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)];
      const halfWidth = Math.tan(radians(sky.detail.sizeDeg[0] / 2));
      const halfHeight = Math.tan(radians(sky.detail.sizeDeg[1] / 2));
      for (const corner of sky.detail.corners) {
        const point = skyVector(corner);
        const denominator = dot(point, center);
        const x = -dot(point, east) / denominator;
        const y = -dot(point, north) / denominator;
        expect(Math.abs(Math.abs(x) - halfWidth)).toBeLessThan(2e-7);
        expect(Math.abs(Math.abs(y) - halfHeight)).toBeLessThan(2e-7);
      }
    }
  });

  it("checks the detail scale bar against the inverse-projected sky distance", () => {
    const sky = fixture("tiny-sparse-crossing");
    const svg = renderSkyPanel(sky);
    const bar = svg.match(/<path d="M([\d.]+),([\d.]+) h([\d.]+)" stroke="#f3f4f8"[^>]*\/><text [^>]*>([^<]+)<\/text>/);
    expect(bar).not.toBeNull();
    const [, xText, yText, lengthText, label] = bar!;
    const width = 240, height = 178, centerX = 806 + width / 2, centerY = 77 + height / 2;
    const scale = Math.min((width - 18) / (2 * Math.tan(radians(sky.detail.sizeDeg[0] / 2))), (height - 18) / (2 * Math.tan(radians(sky.detail.sizeDeg[1] / 2))));
    const [ra, dec] = sky.detail.center.map(radians) as [number, number];
    const center = skyVector(sky.detail.center);
    const east = [-Math.sin(ra), Math.cos(ra), 0];
    const north = [-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)];
    const inverse = (px: number, py: number) => {
      const gx = (px - centerX) / scale, gy = (py - centerY) / scale;
      const raw = center.map((value, index) => value - gx * east[index] - gy * north[index]);
      const length = Math.hypot(...raw);
      return raw.map((value) => value / length);
    };
    const start = inverse(Number(xText), Number(yText));
    const end = inverse(Number(xText) + Number(lengthText), Number(yText));
    const actualDegrees = Math.acos(Math.min(1, dot(start, end))) * 180 / Math.PI;
    const value = Number(label.match(/[\d.]+/)?.[0]);
    const isDegrees = label.includes("°") || label.includes("Â°");
    const reportedDegrees = isDegrees ? value : value / 60;
    const roundingToleranceDegrees = isDegrees ? 0.051 : 0.051 / 60;
    expect(Math.abs(actualDegrees - reportedDegrees)).toBeLessThanOrEqual(roundingToleranceDegrees);
  });

  it("keeps near-pole geometry finite and does not invent stars or segments for an empty detail", () => {
    const sky = fixture("north-pole-empty-detail");
    const svg = renderSkyPanel(sky);
    expect(svg).toContain("north-pole-empty-detail · SKY OVERVIEW + DETAIL");
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect([...svg.matchAll(/<circle /g)]).toHaveLength(sky.overviewStars.length);
    expect(svg).not.toContain('stroke="#9daecc"');
  });

  it("clips a catalog segment through the detail window when both endpoints are outside", () => {
    const sky = fixture("tiny-sparse-crossing");
    const svg = renderSkyPanel(sky);
    const match = svg.match(/<path d="([^"]+)" fill="none" stroke="#9daecc"/);
    expect(match).not.toBeNull();
    const points = [...match![1].matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)]
      .map(([, x, y]) => [Number(x), Number(y)]);
    expect(points).toHaveLength(2);
    // The clipped endpoints land on the detail's left and right inner bounds.
    expect(points[0][0]).toBeCloseTo(1037, 1);
    expect(points[1][0]).toBeCloseTo(815, 1);
    expect(points.every(([, y]) => y >= 77 && y <= 255)).toBe(true);
    // Only the supplied overview and sparse detail stars are rendered.
    expect([...svg.matchAll(/<circle /g)]).toHaveLength(sky.overviewStars.length + sky.detail.stars.length);
  });
});
