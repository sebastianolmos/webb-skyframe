import fs from "node:fs";

const sourceRoot = "docs/evidence/increment-4/sky-sources/";
const stars = JSON.parse(fs.readFileSync(`${sourceRoot}hyg-v4.1-stars-mag6.json`, "utf8"));
const lines = JSON.parse(fs.readFileSync(`${sourceRoot}d3-celestial/data/constellations.lines.json`, "utf8"));

const starIds = new Set();
const starBounds = { ra: [Infinity, -Infinity], dec: [Infinity, -Infinity], magnitude: [Infinity, -Infinity] };
for (const star of stars) {
  if (!Number.isInteger(star.id) || starIds.has(star.id)) throw new Error(`Invalid or duplicate HYG id: ${star.id}`);
  starIds.add(star.id);
  for (const [field, value] of [["ra", star.raDeg], ["dec", star.decDeg], ["magnitude", star.visualMagnitude]]) {
    if (!Number.isFinite(value)) throw new Error(`Non-finite ${field} for HYG id ${star.id}`);
    starBounds[field][0] = Math.min(starBounds[field][0], value);
    starBounds[field][1] = Math.max(starBounds[field][1], value);
  }
  if (star.raDeg < 0 || star.raDeg >= 360 || star.decDeg < -90 || star.decDeg > 90 || star.visualMagnitude > 6) {
    throw new Error(`HYG id ${star.id} is outside the retained catalogue contract`);
  }
}
if (stars.length !== 5070) throw new Error(`Expected 5070 retained stars, found ${stars.length}`);

if (lines.type !== "FeatureCollection" || lines.features.length !== 89) {
  throw new Error("Unexpected constellation line collection shape or feature count");
}
const lineBounds = { ra: [Infinity, -Infinity], dec: [Infinity, -Infinity] };
let lineVertices = 0;
for (const feature of lines.features) {
  if (feature.geometry.type !== "MultiLineString") throw new Error(`Unexpected geometry for ${feature.id}`);
  for (const segment of feature.geometry.coordinates) {
    for (const [ra, dec] of segment) {
      if (!Number.isFinite(ra) || !Number.isFinite(dec) || ra < -180 || ra > 180 || dec < -90 || dec > 90) {
        throw new Error(`Out-of-range constellation coordinate in ${feature.id}`);
      }
      lineVertices += 1;
      lineBounds.ra[0] = Math.min(lineBounds.ra[0], ra);
      lineBounds.ra[1] = Math.max(lineBounds.ra[1], ra);
      lineBounds.dec[0] = Math.min(lineBounds.dec[0], dec);
      lineBounds.dec[1] = Math.max(lineBounds.dec[1], dec);
    }
  }
}

console.log(JSON.stringify({
  result: "PASS",
  stars: stars.length,
  uniqueStarIds: starIds.size,
  starBounds,
  constellationFeatures: lines.features.length,
  lineVertices,
  lineBounds,
}, null, 2));
