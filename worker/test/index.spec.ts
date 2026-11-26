import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";

const CURRENT_KEY = "state/github-current.svg";
const BASE_URL = "https://example.com";
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function call(path: string, headers?: HeadersInit, targetEnv: Env = env): Promise<Response> {
	return worker.fetch(new IncomingRequest(`${BASE_URL}${path}`, { headers }), targetEnv, {} as ExecutionContext);
}

async function currentSvg(targetEnv: Env = env): Promise<string> {
	const response = await call("/github/current.svg", undefined, targetEnv);
	expect(response.status).toBe(200);
	expect(response.headers.get("content-type")).toContain("image/svg+xml");
	const svg = await response.text();
	expect(svg.startsWith("<svg ")).toBe(true);
	expect(svg.endsWith("</svg>")).toBe(true);
	return svg;
}

describe("GitHub card Worker routes", () => {
	beforeEach(async () => {
		await env.CARDS_BUCKET.delete(CURRENT_KEY);
	});

	it("serves a bundled empty state and supports conditional reads", async () => {
		const first = await call("/github/current.svg");
		expect(first.status).toBe(200);
		expect(first.headers.get("content-type")).toContain("image/svg+xml");
		expect(first.headers.get("cache-control")).toBe("no-cache, no-store, max-age=0, must-revalidate");
		const etag = first.headers.get("etag");
		expect(etag).toBeTruthy();
		const body = await first.text();
		expect(body.startsWith("<svg ")).toBe(true);
		expect(body.endsWith("</svg>")).toBe(true);

		const conditional = await call("/github/current.svg", { "If-None-Match": etag! });
		expect(conditional.status).toBe(304);
		expect(await conditional.text()).toBe("");
	});

	it("does not mutate the current object when reading it", async () => {
		const next = await call("/github/next");
		expect(next.status).toBe(302);
		const before = await env.CARDS_BUCKET.get(CURRENT_KEY);
		expect(before).not.toBeNull();
		const beforeId = before?.customMetadata?.id;
		const beforeEtag = before?.httpEtag;

		await currentSvg();

		const after = await env.CARDS_BUCKET.get(CURRENT_KEY);
		expect(after?.customMetadata?.id).toBe(beforeId);
		expect(after?.httpEtag).toBe(beforeEtag);
	});

	it("alternates fixture IDs and redirects to the fixed profile", async () => {
		const first = await call("/github/next");
		expect(first.status).toBe(302);
		expect(first.headers.get("location")).toBe("https://github.com/sebastianolmos");
		expect(first.headers.get("cache-control")).toBe("no-store");
		const firstObject = await env.CARDS_BUCKET.get(CURRENT_KEY);
		const firstId = firstObject?.customMetadata?.id;
		expect(["fixture-a", "fixture-b"]).toContain(firstId);

		const second = await call("/github/next");
		expect(second.status).toBe(302);
		const secondObject = await env.CARDS_BUCKET.get(CURRENT_KEY);
		expect(secondObject?.customMetadata?.id).not.toBe(firstId);
		expect(["fixture-a", "fixture-b"]).toContain(secondObject?.customMetadata?.id);
	});

	it("preserves the prior complete card when the R2 write fails", async () => {
		const previousSvg = '<svg xmlns="http://www.w3.org/2000/svg"><text>previous complete card</text></svg>';
		const failingBucket = {
			get: async () => ({
				body: new Response(previousSvg).body!,
				httpEtag: '"previous-card-etag"',
				customMetadata: { id: "fixture-a", version: "previous" },
			}),
			put: async () => {
				throw new Error("Injected R2 write failure");
			},
		};
		const failingEnv = { CARDS_BUCKET: failingBucket } as unknown as Env;

		const next = await call("/github/next", undefined, failingEnv);
		expect(next.status).toBe(302);

		const current = await call("/github/current.svg", undefined, failingEnv);
		expect(current.status).toBe(200);
		expect(await current.text()).toBe(previousSvg);
	});

	it("serves complete SVGs during overlapping publication and reads", async () => {
		const operations = Array.from({ length: 12 }, (_, index) =>
			index % 3 === 0
				? call("/github/next")
				: currentSvg(),
		);
		const results = await Promise.all(operations);
		for (const result of results) {
			if (result instanceof Response) expect(result.status).toBe(302);
		}

		const finalSvg = await currentSvg();
		const stored = await env.CARDS_BUCKET.get(CURRENT_KEY);
		expect(stored).not.toBeNull();
		expect(stored?.customMetadata?.id).toMatch(/^fixture-[ab]$/);
		expect(await stored?.text()).toBe(finalSvg);
	});
});
