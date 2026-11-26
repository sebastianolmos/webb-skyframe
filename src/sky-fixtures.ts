/** Synthetic, versioned inputs for celestial geometry and rendering work.
 * Coordinates are ICRS degrees; all stars and stick-figure edges are invented.
 */
export type SkyPoint = readonly [raDeg: number, decDeg: number];
export type SkyStar = readonly [raDeg: number, decDeg: number, magnitude: number];
export type SkySegment = readonly [SkyPoint, SkyPoint];

export type SkyFixture = {
  readonly id: string;
  readonly version: string;
  readonly purpose: string;
  readonly tags: readonly string[];
  readonly center: SkyPoint;
  /** Detector footprint corners in top-left clockwise order. */
  readonly footprint: readonly [SkyPoint, SkyPoint, SkyPoint, SkyPoint];
  readonly figureEdges: readonly SkySegment[];
  readonly overviewStars: readonly SkyStar[];
  readonly detail: {
    readonly center: SkyPoint;
    readonly sizeDeg: readonly [width: number, height: number];
    /** Inverse-projected window corners in top-left clockwise order. */
    readonly corners: readonly [SkyPoint, SkyPoint, SkyPoint, SkyPoint];
    readonly stars: readonly SkyStar[];
    readonly segments: readonly SkySegment[];
  };
};

const VERSION = "synthetic-sky-1";

export const SKY_FIXTURES: readonly SkyFixture[] = [
  {
    id: "wide-field",
    version: VERSION,
    purpose: "Large field whose projected short side should remain legible in a single overview.",
    tags: ["large", "dense-detail", "inside-figure"],
    center: [83.8, -5.4],
    footprint: [[84.9, -4.7], [82.7, -4.7], [82.7, -6.1], [84.9, -6.1]],
    figureEdges: [
      [[82.1, -4.2], [83.0, -3.8]], [[83.0, -3.8], [83.7, -4.4]],
      [[83.7, -4.4], [84.4, -3.9]], [[84.4, -3.9], [85.2, -4.5]],
    ],
    overviewStars: [[82.1, -4.2, 2.1], [83.0, -3.8, 2.8], [83.7, -4.4, 3.0], [84.4, -3.9, 2.4], [85.2, -4.5, 3.2]],
    detail: {
      center: [83.8, -5.4], sizeDeg: [0.75, 0.52],
      corners: [[84.176510, -5.139890], [83.423490, -5.139890], [83.423167, -5.659878], [84.176833, -5.659878]],
      stars: [[83.55, -5.3, 5.1], [83.82, -5.46, 6.4], [84.02, -5.58, 4.8], [83.7, -5.62, 7.0]],
      segments: [[[83.48, -5.5], [84.12, -5.35]]],
    },
  },
  {
    id: "tiny-sparse-crossing",
    version: VERSION,
    purpose: "Tiny field requiring double zoom; sparse detail with a segment crossing the window while both endpoints stay outside.",
    tags: ["tiny", "sparse-detail", "crossing-segment", "outside-endpoints"],
    center: [120.0, 22.0],
    footprint: [[120.002, 22.001], [119.998, 22.001], [119.998, 21.999], [120.002, 21.999]],
    figureEdges: [
      [[118.0, 23.0], [118.7, 23.4]], [[118.7, 23.4], [119.3, 22.8]],
      [[119.3, 22.8], [119.7, 23.2]],
    ],
    overviewStars: [[118.0, 23.0, 2.4], [118.7, 23.4, 3.1], [119.3, 22.8, 2.8], [119.7, 23.2, 3.3]],
    detail: {
      center: [120.0, 22.0], sizeDeg: [0.18, 0.12],
      corners: [[120.097109, 22.059971], [119.902891, 22.059971], [119.902973, 21.939972], [120.097027, 21.939972]],
      stars: [[120.015, 22.008, 8.2]],
      segments: [[[119.82, 21.98], [120.18, 22.02]]],
    },
  },
  {
    id: "rotated-footprint",
    version: VERSION,
    purpose: "Moderate field rotated on the sky to exercise rotation-aware short-side thresholding and orientation.",
    tags: ["rotated", "threshold-boundary"],
    center: [201.2, 16.4],
    footprint: [[201.2293, 16.4471], [201.1439, 16.3897], [201.1707, 16.3529], [201.2561, 16.4103]],
    figureEdges: [
      [[200.1, 17.3], [200.8, 17.6]], [[200.8, 17.6], [201.4, 17.0]],
      [[201.4, 17.0], [202.0, 17.4]], [[202.0, 17.4], [202.5, 16.8]],
    ],
    overviewStars: [[200.1, 17.3, 2.2], [200.8, 17.6, 2.9], [201.4, 17.0, 2.5], [202.0, 17.4, 3.0], [202.5, 16.8, 3.4]],
    detail: {
      center: [201.2, 16.4], sizeDeg: [0.24, 0.16],
      corners: [[201.325141, 16.479963], [201.074859, 16.479963], [201.074962, 16.319963], [201.325038, 16.319963]],
      stars: [[201.14, 16.43, 6.0], [201.26, 16.37, 7.1]],
      segments: [[[201.1, 16.35], [201.3, 16.45]]],
    },
  },
  {
    id: "ra-zero-wrap",
    version: VERSION,
    purpose: "Field and stick figure straddling RA=0 degrees; coordinates deliberately normalize on both sides of the wrap.",
    tags: ["ra-wrap", "double-zoom"],
    center: [359.96, 4.0],
    footprint: [[0.04, 4.06], [359.88, 4.06], [359.88, 3.94], [0.04, 3.94]],
    figureEdges: [
      [[359.5, 4.6], [359.8, 4.8]], [[359.8, 4.8], [0.1, 4.5]],
      [[0.1, 4.5], [0.4, 4.7]],
    ],
    overviewStars: [[359.5, 4.6, 2.6], [359.8, 4.8, 2.9], [0.1, 4.5, 3.2], [0.4, 4.7, 3.4]],
    detail: {
      center: [359.96, 4.0], sizeDeg: [0.12, 0.1],
      corners: [[0.020150, 4.049998], [359.899850, 4.049998], [359.899857, 3.949998], [0.020143, 3.949998]],
      stars: [[359.94, 4.02, 6.4], [0.0, 3.98, 7.0]],
      segments: [[[359.91, 4.0], [0.01, 4.0]]],
    },
  },
  {
    id: "north-pole-empty-detail",
    version: VERSION,
    purpose: "Near-pole field outside the conventional figure, with an empty detail subset to ensure no geometry is invented.",
    tags: ["near-pole", "outside-figure", "empty-detail"],
    center: [42.0, 89.7],
    footprint: [[42.2, 89.71], [41.8, 89.71], [41.8, 89.69], [42.2, 89.69]],
    figureEdges: [
      [[10.0, 88.0], [14.0, 88.3]], [[14.0, 88.3], [18.0, 87.9]],
    ],
    overviewStars: [[10.0, 88.0, 2.7], [14.0, 88.3, 3.0], [18.0, 87.9, 3.2]],
    detail: {
      center: [42.0, 89.7], sizeDeg: [0.8, 0.2],
      corners: [[105.43533, 89.55279], [338.56467, 89.55279], [356.99935, 89.43432], [87.00065, 89.43432]],
      stars: [], segments: [],
    },
  },
] as const;
