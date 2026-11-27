import { renderCard } from "../../src/card";
import { REAL_CARD_SKY_PRESENTATION } from "../../src/real-card-presentation";
import type { PhysicalOrbitScene } from "../../src/physical-orbit";
import type { SkyPanelScene } from "../../src/sky-renderer";

const POINTER_KEY = "catalog/published.json";
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const GENERATION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const OBJECT_KEY_PATTERN = /^(?:observation|photo|sky|orbit)\/[a-z0-9][a-z0-9_-]{0,99}\/[a-f0-9]{64}\/[A-Za-z0-9._-]{1,80}$/;
const MAX_POINTER_BYTES = 16_384;
const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_RESOURCE_BYTES = 8_000_000;
const CARD_CACHE_CONTROL = "public, max-age=86400, s-maxage=86400, immutable";

export type CatalogEntry = {
  id: string;
  cardVersion: string;
  versions: { schema: string; data: string; render: string; filter: string; catalog: string };
  objectKeys: { observation: string; photo: string; sky: string; orbit: string };
  digests: Record<string, { bytes: number; sha256: string }>;
  alt: string;
  entryTime: string;
};

export type PublishedCatalog = {
  schemaVersion: "published-catalog-1";
  generation: string;
  renderVersion: string;
  entries: CatalogEntry[];
  retired?: Array<{ id: string; cardVersion: string }>;
};

export type CatalogEnv = Env & { PORTFOLIO_ORIGINS?: string };

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate));
}

function isTupleList(value: unknown, length: number, minimum = 0): value is number[][] {
  return Array.isArray(value) && value.length >= minimum && value.every((item) => isTuple(item, length));
}

function isSegmentList(value: unknown): boolean {
  return Array.isArray(value) && value.every((segment) => Array.isArray(segment) && segment.length === 2 &&
    isTuple(segment[0], 2) && isTuple(segment[1], 2));
}

async function readSmallObject(env: CatalogEnv, key: string, maximum: number): Promise<Uint8Array | null> {
  const object = await env.CARDS_BUCKET.get(key);
  if (!object) return null;
  if (object.size > maximum) throw new Error(`R2 object exceeds the size limit: ${key}`);
  return new Uint8Array(await object.arrayBuffer());
}

function validEntry(value: unknown): value is CatalogEntry {
  if (!isRecord(value) || typeof value.id !== "string" || !ID_PATTERN.test(value.id) ||
      typeof value.cardVersion !== "string" || !HASH_PATTERN.test(value.cardVersion) ||
      typeof value.alt !== "string" || value.alt.length < 1 || value.alt.length > 1000 ||
      typeof value.entryTime !== "string" || !isRecord(value.versions) || !isRecord(value.objectKeys) || !isRecord(value.digests)) return false;
  for (const kind of ["observation", "photo", "sky", "orbit"] as const) {
    const key = value.objectKeys[kind];
    const digest = value.digests[kind];
    if (typeof key !== "string" || !OBJECT_KEY_PATTERN.test(key) || !isRecord(digest) ||
        !Number.isSafeInteger(digest.bytes) || digest.bytes <= 0 || digest.bytes > MAX_RESOURCE_BYTES ||
        typeof digest.sha256 !== "string" || !HASH_PATTERN.test(digest.sha256)) return false;
  }
  return ["schema", "data", "render", "filter", "catalog"].every((key) =>
    typeof value.versions[key] === "string" && value.versions[key].length > 0 && value.versions[key].length <= 100,
  );
}

/** Read one complete, digest-checked catalog generation per request. */
export async function loadPublishedCatalog(env: CatalogEnv): Promise<PublishedCatalog | null> {
  const pointerBytes = await readSmallObject(env, POINTER_KEY, MAX_POINTER_BYTES);
  if (!pointerBytes) return null;
  const pointer = JSON.parse(new TextDecoder().decode(pointerBytes)) as Record<string, unknown>;
  if (pointer.schemaVersion !== "published-pointer-1" || typeof pointer.generation !== "string" ||
      !GENERATION_PATTERN.test(pointer.generation) || typeof pointer.manifestSha256 !== "string" ||
      !HASH_PATTERN.test(pointer.manifestSha256) || pointer.manifestKey !== `catalog/${pointer.manifestSha256}.json`) {
    throw new Error("Published catalog pointer is invalid");
  }

  const manifestBytes = await readSmallObject(env, pointer.manifestKey, MAX_MANIFEST_BYTES);
  if (!manifestBytes) throw new Error("Published catalog manifest is missing");
  if (await sha256(manifestBytes) !== pointer.manifestSha256) throw new Error("Published catalog digest mismatch");
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown;
  if (!isRecord(manifest)) throw new Error("Published catalog manifest must be an object");
  if (manifest.schemaVersion !== "published-catalog-1" || manifest.generation !== pointer.generation ||
      typeof manifest.renderVersion !== "string") throw new Error("Published catalog manifest header is invalid");
  if (!Array.isArray(manifest.entries)) throw new Error("Published catalog manifest entries must be an array");
  const invalidEntry = manifest.entries.findIndex((entry: unknown) => !validEntry(entry));
  if (invalidEntry >= 0) throw new Error(`Published catalog entry ${invalidEntry} has an invalid shape`);
  if (manifest.retired !== undefined && (!Array.isArray(manifest.retired) || !manifest.retired.every((entry: unknown) =>
    isRecord(entry) && typeof entry.id === "string" && ID_PATTERN.test(entry.id) &&
    typeof entry.cardVersion === "string" && HASH_PATTERN.test(entry.cardVersion),
  ))) throw new Error("Published catalog retired list is invalid");
  const activeIds = new Set<string>();
  for (const entry of manifest.entries as CatalogEntry[]) {
    if (activeIds.has(entry.id)) throw new Error("Published catalog contains duplicate observation IDs");
    if (entry.versions.render !== manifest.renderVersion) throw new Error("Catalog entry render version does not match its manifest");
    const expectedVersion = await sha256(new TextEncoder().encode(JSON.stringify({
      observation: entry.digests.observation.sha256,
      orbit: entry.digests.orbit.sha256,
      photo: entry.digests.photo.sha256,
      render: entry.versions.render,
      sky: entry.digests.sky.sha256,
    })));
    if (entry.cardVersion !== expectedVersion) throw new Error("Catalog card version does not cover its rendering inputs");
    activeIds.add(entry.id);
  }
  return manifest as PublishedCatalog;
}

export function chooseEntry<T extends { id: string }>(entries: readonly T[], exclude?: string): T | undefined {
  if (entries.length === 0) return undefined;
  const alternatives = exclude ? entries.filter((entry) => entry.id !== exclude) : [...entries];
  const pool = alternatives.length > 0 ? alternatives : entries;
  // Rejection sampling avoids the modulo bias of a raw random integer.
  const range = 0x1_0000_0000;
  const ceiling = Math.floor(range / pool.length) * pool.length;
  let value: number;
  do {
    const sample = new Uint32Array(1);
    crypto.getRandomValues(sample);
    value = sample[0];
  } while (value >= ceiling);
  return pool[value % pool.length];
}

async function readEntryObject(env: CatalogEnv, entry: CatalogEntry, kind: "observation" | "photo" | "sky" | "orbit"): Promise<Uint8Array> {
  const { objectKeys, digests } = entry;
  const key = objectKeys[kind];
  if (!OBJECT_KEY_PATTERN.test(key) || !key.startsWith(`${kind}/${entry.id}/`)) throw new Error(`Invalid ${kind} object key`);
  const object = await env.CARDS_BUCKET.get(key);
  if (!object) throw new Error(`Published ${kind} object is missing`);
  const expected = digests[kind];
  if (object.size !== expected.bytes || object.size > MAX_RESOURCE_BYTES) throw new Error(`Published ${kind} object size mismatch`);
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== expected.bytes) throw new Error(`Published ${kind} object body size mismatch`);
  if (await sha256(bytes) !== expected.sha256) throw new Error(`Published ${kind} object digest mismatch`);
  return bytes;
}

function parseJson(bytes: Uint8Array): Record<string, any> {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (!isRecord(value)) throw new Error("Published scene JSON must be an object");
  return value;
}

function pngDataUrl(bytes: Uint8Array, expectedWidth: number, expectedHeight: number): string {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < signature.length || signature.some((byte, index) => bytes[index] !== byte)) {
    throw new Error("Published photo is not a PNG");
  }
  const readUint32 = (offset: number) => bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
  if (bytes.length < 24 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR" ||
      readUint32(16) !== expectedWidth || readUint32(20) !== expectedHeight) {
    throw new Error("Published PNG dimensions do not match the observation manifest");
  }
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

export async function renderCatalogEntry(env: CatalogEnv, entry: CatalogEntry): Promise<string> {
  const [observationBytes, photoBytes, skyBytes, orbitBytes] = await Promise.all([
    readEntryObject(env, entry, "observation"), readEntryObject(env, entry, "photo"),
    readEntryObject(env, entry, "sky"), readEntryObject(env, entry, "orbit"),
  ]);
  const observation = parseJson(observationBytes);
  const skyBundle = parseJson(skyBytes);
  const orbitBundle = parseJson(orbitBytes);
  const skyScene = skyBundle.scene;
  const orbitScene = orbitBundle.scene;
  if (observation.schemaVersion !== "real-exposure-1" || observation.product?.id !== entry.id ||
      observation.metrics?.accepted !== true || observation.metrics?.filterVersion !== "visual-filter-1" ||
      observation.image?.format !== "image/png" || !Array.isArray(observation.image.size) ||
      observation.versions?.render !== entry.versions.render ||
      skyBundle.schemaVersion !== "resolved-sky-1" || orbitBundle.schemaVersion !== "resolved-orbit-1" ||
      !isTuple(skyScene?.center, 2) || !isTupleList(skyScene?.footprint, 2, 4) || skyScene.footprint.length !== 4 ||
      !isSegmentList(skyScene?.figureEdges) || !isTupleList(skyScene?.figureStars, 2, 1) ||
      !isTupleList(skyScene?.overviewStars, 3) || !isRecord(skyScene?.detail) ||
      !isTuple(skyScene.detail.center, 2) || !isTuple(skyScene.detail.sizeDeg, 2) ||
      !isTupleList(skyScene.detail.corners, 2, 4) || skyScene.detail.corners.length !== 4 ||
      !isTupleList(skyScene.detail.stars, 3) || !isSegmentList(skyScene.detail.segments) ||
      orbitScene?.kind !== "physical" || !isTuple(orbitScene.sun, 3) || !isTuple(orbitScene.earth, 3) ||
      !isTuple(orbitScene.moon, 3) || !isTuple(orbitScene.l2, 3) || !isTuple(orbitScene.webb, 3) ||
      !isTuple(orbitScene.pointing, 3) || !isRecord(orbitScene.camera) || !isTuple(orbitScene.camera.u, 3) ||
      !isTuple(orbitScene.camera.v, 3) || !isTupleList(orbitScene.earthTrack, 3, 2) ||
      !isTupleList(orbitScene.moonTrack, 3, 2) || !isTupleList(orbitScene.webbTrack, 3, 2) ||
      !Array.isArray(orbitScene.earthTrackEpochsJdTdb) ||
      orbitScene.earthTrackEpochsJdTdb.length !== orbitScene.earthTrack.length ||
      !orbitScene.earthTrackEpochsJdTdb.every((epoch: unknown) => typeof epoch === "number" && Number.isFinite(epoch)) ||
      typeof orbitScene.localMagnification !== "number" || !Number.isFinite(orbitScene.localMagnification) ||
      typeof skyBundle.region !== "string" || skyBundle.region.length < 1) {
    throw new Error("Published card dependencies do not form a complete real scene");
  }

  const [width, height] = observation.image.size;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192) {
    throw new Error("Published image dimensions are invalid");
  }
  const region = String(skyBundle.region ?? "Unknown region");
  const center = skyBundle.scene.center;
  if (!Array.isArray(center) || center.length !== 2 || !center.every(Number.isFinite)) throw new Error("Published sky center is invalid");
  const date = String(observation.time?.middle ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Published observation date is invalid");
  const product = observation.product;
  const details = {
    id: entry.id, date, field: String(product.target ?? "Unknown field"),
    detector: String(product.detector ?? "Unknown detector"), filter: String(product.filter ?? "Unknown filter"),
    variant: String(product.target ?? region), seed: 0, mode: "real" as const,
    credit: String(observation.provenance?.credit ?? "NASA/ESA/CSA James Webb Space Telescope · MAST/STScI"),
  };
  const skyDisplay = {
    heading: `${region} · JWST field`,
    coordinateCaption: `ICRS ${center[0].toFixed(4)}°, ${center[1].toFixed(4)}°`,
    symbolicPointingSquare: true,
    constellationOverviewZoom: REAL_CARD_SKY_PRESENTATION.constellationOverviewZoom,
    pointingReferenceSquareSize: REAL_CARD_SKY_PRESENTATION.pointingReferenceSquareSize,
  };
  const svg = renderCard(orbitScene as PhysicalOrbitScene, details, pngDataUrl(photoBytes, width, height), skyScene as SkyPanelScene, skyDisplay);
  if (!svg.startsWith("<svg ") || !svg.endsWith("</svg>") || !svg.includes("data:image/png;base64,") ||
      /<script\b|(?:href|src)=["']https?:|url\(https?:/i.test(svg)) throw new Error("Renderer returned an incomplete or externally linked SVG");
  return svg;
}

export function findRetired(catalog: PublishedCatalog, id: string, version: string): boolean {
  return catalog.retired?.some((entry) => entry.id === id && entry.cardVersion === version) ?? false;
}

export function catalogResponseHeaders(origin: string | null, env: CatalogEnv): Headers {
  const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
  if (origin && allowedOrigin(origin, env)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

export function allowedOrigin(origin: string, env: CatalogEnv): boolean {
  return (env.PORTFOLIO_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean).includes(origin);
}

export function cardResponse(svg: string, version: string): Response {
  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": CARD_CACHE_CONTROL,
      ETag: `"${version}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export { ID_PATTERN, HASH_PATTERN };
