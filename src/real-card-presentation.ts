/** User-tunable display controls for the real exposure card (not science inputs). */
export const REAL_CARD_SKY_PRESENTATION = {
  /** 1 fits the constellation; values above 1 zoom in, below 1 zoom out. */
  constellationOverviewZoom: 1.0,
  /** Purple Webb-pointing reference square size in the local panel's SVG units. */
  pointingReferenceSquareSize: 20,
} as const;
