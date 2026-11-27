import { describe, expect, it } from "vitest";
import worker from "../src/index";

const BASE_URL = "https://worker.example";
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const encoder = new TextEncoder();

class MemoryBucket {
  private objects = new Map<string, Uint8Array>();

  async get(key: string): Promise<unknown> {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    const copy = bytes.slice();
    return {
      size: copy.byteLength,
      arrayBuffer: async () => copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
    };
  }

  async head(key: string): Promise<unknown> {
    const bytes = this.objects.get(key);
    return bytes ? { size: bytes.byteLength } : null;
  }

  async put(key: string, value: string | ArrayBuffer | ArrayBufferView): Promise<unknown> {
    if (typeof value === "string") this.objects.set(key, encoder.encode(value));
    else if (value instanceof ArrayBuffer) this.objects.set(key, new Uint8Array(value));
    else this.objects.set(key, new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice());
    return {};
  }
}

async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function testEnv(options: { entries?: unknown[]; retired?: unknown[] } = {}): Promise<Env> {
  const bucket = new MemoryBucket();
  if (options.entries !== undefined) {
    const manifest = {
      schemaVersion: "published-catalog-1",
      generation: "route-test-1",
      renderVersion: "real-card-1",
      entries: options.entries,
      ...(options.retired ? { retired: options.retired } : {}),
    };
    const manifestBytes = encoder.encode(JSON.stringify(manifest));
    const manifestSha256 = await hash(manifestBytes);
    const manifestKey = `catalog/${manifestSha256}.json`;
    await bucket.put(manifestKey, manifestBytes);
    await bucket.put("catalog/published.json", JSON.stringify({
      schemaVersion: "published-pointer-1",
      generation: manifest.generation,
      manifestKey,
      manifestSha256,
    }));
  }
  return { CARDS_BUCKET: bucket, PORTFOLIO_ORIGINS: "https://solmos.dev" } as unknown as Env;
}

async function validEntry() {
  const id = "jw00000000001_01001_00001_nrca1_cal";
  const digests = {
    observation: { bytes: 1, sha256: await hash(encoder.encode("o")) },
    photo: { bytes: 1, sha256: await hash(encoder.encode("p")) },
    sky: { bytes: 1, sha256: await hash(encoder.encode("s")) },
    orbit: { bytes: 1, sha256: await hash(encoder.encode("r")) },
  };
  const cardVersion = await hash(encoder.encode(JSON.stringify({
    observation: digests.observation.sha256,
    orbit: digests.orbit.sha256,
    photo: digests.photo.sha256,
    render: "real-card-1",
    sky: digests.sky.sha256,
  })));
  return {
    id,
    cardVersion,
    versions: { schema: "real-exposure-1", data: "real-sky-1", render: "real-card-1", filter: "visual-filter-1", catalog: "route-test-1" },
    objectKeys: {
      observation: `observation/${id}/${digests.observation.sha256}/observation.json`,
      photo: `photo/${id}/${digests.photo.sha256}/photo.png`,
      sky: `sky/${id}/${digests.sky.sha256}/sky.json`,
      orbit: `orbit/${id}/${digests.orbit.sha256}/orbit.json`,
    },
    digests,
    alt: "A real Webb observation.",
    entryTime: "2025-01-01T00:00:00Z",
  };
}

async function call(path: string, targetEnv: Env, headers?: HeadersInit): Promise<Response> {
  return worker.fetch(new IncomingRequest(`${BASE_URL}${path}`, { headers }), targetEnv);
}

describe("published catalog Worker routes", () => {
  it("returns a singleton even when it is the excluded ID and applies configured CORS", async () => {
    const entry = await validEntry();
    const response = await call(`/api/random?exclude=${entry.id}`, await testEnv({ entries: [entry] }), { Origin: "https://solmos.dev" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://solmos.dev");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ id: entry.id, imageUrl: `${BASE_URL}/cards/${entry.cardVersion}/${entry.id}.svg`, alt: entry.alt });
  });

  it("reports an empty or absent catalog and rejects an unconfigured browser origin", async () => {
    const empty = await call("/api/random", await testEnv());
    expect(empty.status).toBe(503);
    expect(await empty.json()).toEqual({ error: "empty_catalog" });

    const blocked = await call("/api/random", await testEnv({ entries: [] }), { Origin: "https://evil.example" });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "origin_not_allowed" });
  });

  it("returns 404 for an unknown version and 410 for a listed retired card", async () => {
    const entry = await validEntry();
    const unknown = await call(`/cards/${"0".repeat(64)}/${entry.id}.svg`, await testEnv({ entries: [entry] }));
    expect(unknown.status).toBe(404);

    const retiredEnv = await testEnv({ entries: [], retired: [{ id: entry.id, cardVersion: entry.cardVersion }] });
    const retired = await call(`/cards/${entry.cardVersion}/${entry.id}.svg`, retiredEnv);
    expect(retired.status).toBe(410);
    expect(retired.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns an uncached 503 when a published card dependency is missing", async () => {
    const entry = await validEntry();
    const response = await call(`/cards/${entry.cardVersion}/${entry.id}.svg`, await testEnv({ entries: [entry] }));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
