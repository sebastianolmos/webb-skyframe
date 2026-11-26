import { renderCard } from "../../src/card";
import { CARD_FIXTURES, photoDataUrl } from "./fixtures";

const CURRENT_KEY = "state/github-current.svg";
const PROFILE_URL = "https://github.com/sebastianolmos";
const EMPTY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="570" viewBox="0 0 1080 570" role="img" aria-labelledby="title desc"><title id="title">Webb Skyframe is waiting for its first card</title><desc id="desc">No synthetic fixture has been published yet. Use Next to publish one.</desc><rect width="1080" height="570" fill="#090b10"/><rect x="16" y="16" width="1048" height="538" rx="16" fill="#101523" stroke="#343c50"/><text x="540" y="260" fill="#f3f4f8" text-anchor="middle" font-family="Arial,sans-serif" font-size="32" font-weight="700">Webb Skyframe</text><text x="540" y="306" fill="#b7c2d7" text-anchor="middle" font-family="Arial,sans-serif" font-size="18">Waiting for the first demonstration card</text><text x="540" y="348" fill="#8992a2" text-anchor="middle" font-family="Arial,sans-serif" font-size="13">Synthetic fixtures · private R2 storage</text></svg>`;

function matchesEtag(header: string | null, etag: string): boolean {
  return header?.split(",").some((candidate) => candidate.trim() === "*" || candidate.trim() === etag || candidate.trim() === `W/${etag}`) ?? false;
}

function redirectToProfile(): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: PROFILE_URL, "Cache-Control": "no-store" },
  });
}

function randomIndex(length: number): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] % length;
}

async function contentEtag(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `"${hex}"`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
    }

    if (url.pathname === "/github/current.svg") {
      const current = await env.CARDS_BUCKET.get(CURRENT_KEY);
      const etag = current?.httpEtag ?? await contentEtag(EMPTY_SVG);
      const headers = new Headers({
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
        ETag: etag,
      });
      if (matchesEtag(request.headers.get("If-None-Match"), etag)) {
        return new Response(null, { status: 304, headers });
      }
      if (current) return new Response(current.body, { status: 200, headers });
      return new Response(EMPTY_SVG, { status: 200, headers });
    }

    if (url.pathname === "/github/next") {
      try {
        const previous = await env.CARDS_BUCKET.get(CURRENT_KEY);
        const previousId = previous?.customMetadata?.id;
        const available = CARD_FIXTURES.filter((fixture) => fixture.details.id !== previousId);
        const selected = available[randomIndex(available.length)];
        const svg = renderCard(selected.scene, selected.details, photoDataUrl);
        if (!svg.startsWith("<svg ") || !svg.endsWith("</svg>") || !svg.includes("data:image/png;base64,")) {
          throw new Error("Rendered fixture is not a complete self-contained PNG-backed SVG");
        }
        const version = (await contentEtag(svg)).replaceAll('"', "");
        await env.CARDS_BUCKET.put(CURRENT_KEY, svg, {
          httpMetadata: { contentType: "image/svg+xml; charset=utf-8", cacheControl: "no-cache, no-store, max-age=0, must-revalidate" },
          customMetadata: { id: selected.details.id, version },
        });
      } catch (error) {
        console.error("Could not publish the next fixture; preserving the previous current card.", error);
      }
      return redirectToProfile();
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
