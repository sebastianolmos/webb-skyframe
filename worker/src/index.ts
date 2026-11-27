import { renderCard } from "../../src/card";
import { CARD_FIXTURES, photoDataUrl } from "./fixtures";
import {
  allowedOrigin,
  cardResponse,
  catalogResponseHeaders,
  chooseEntry,
  findRetired,
  ID_PATTERN,
  loadPublishedCatalog,
  renderCatalogEntry,
  type CatalogEnv,
} from "./catalog";

const CURRENT_KEY = "state/github-current.svg";
const PUBLISHED_POINTER_KEY = "catalog/published.json";
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

async function contentEtag(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `"${hex}"`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const catalogEnv = env as CatalogEnv;
    if (url.pathname === "/api/random") {
      const origin = request.headers.get("Origin");
      const headers = catalogResponseHeaders(origin, catalogEnv);
      if (origin && !allowedOrigin(origin, catalogEnv)) {
        return Response.json({ error: "origin_not_allowed" }, { status: 403, headers });
      }
      if (request.method === "OPTIONS") {
        if (origin) headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== "GET") {
        headers.set("Allow", "GET, OPTIONS");
        return Response.json({ error: "method_not_allowed" }, { status: 405, headers });
      }
      const exclude = url.searchParams.get("exclude") ?? undefined;
      if (exclude !== undefined && (exclude.length > 100 || !ID_PATTERN.test(exclude))) {
        return Response.json({ error: "invalid_exclude" }, { status: 400, headers });
      }
      try {
        const catalog = await loadPublishedCatalog(catalogEnv);
        const selected = catalog ? chooseEntry(catalog.entries, exclude) : undefined;
        if (!selected) return Response.json({ error: "empty_catalog" }, { status: 503, headers });
        return Response.json({
          id: selected.id,
          imageUrl: `${url.origin}/cards/${selected.cardVersion}/${selected.id}.svg`,
          alt: selected.alt,
        }, { status: 200, headers });
      } catch (error) {
        console.error("Could not read the published catalog.", error);
        return Response.json({ error: "catalog_unavailable" }, { status: 503, headers });
      }
    }

    const cardMatch = url.pathname.match(/^\/cards\/([a-f0-9]{64})\/([a-z0-9][a-z0-9_-]{0,99})\.svg$/);
    if (cardMatch) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      const [, version, id] = cardMatch;
      try {
        const catalog = await loadPublishedCatalog(catalogEnv);
        if (!catalog) return new Response("Catalog unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
        const entry = catalog.entries.find((candidate) => candidate.id === id && candidate.cardVersion === version);
        if (!entry) {
          if (findRetired(catalog, id, version)) return new Response("Card retired", { status: 410, headers: { "Cache-Control": "no-store" } });
          return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
        }
        const svg = await renderCatalogEntry(catalogEnv, entry);
        return cardResponse(svg, version);
      } catch (error) {
        console.error("Could not render the published card.", error);
        return new Response("Card temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
      }
    }

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
        const pointer = await env.CARDS_BUCKET.head(PUBLISHED_POINTER_KEY);
        const catalog = pointer ? await loadPublishedCatalog(catalogEnv) : null;
        if (catalog) {
          const selected = chooseEntry(catalog.entries, previousId);
          if (!selected) return redirectToProfile();
          const svg = await renderCatalogEntry(catalogEnv, selected);
          if (!svg.startsWith("<svg ") || !svg.endsWith("</svg>") || !svg.includes("data:image/png;base64,")) {
            throw new Error("Rendered catalog card is incomplete");
          }
          await env.CARDS_BUCKET.put(CURRENT_KEY, svg, {
            httpMetadata: { contentType: "image/svg+xml; charset=utf-8", cacheControl: "no-cache, no-store, max-age=0, must-revalidate" },
            customMetadata: { id: selected.id, version: selected.cardVersion },
          });
          return redirectToProfile();
        }
        // Keep the already deployed synthetic profile flow usable until the
        // increment-5 catalog package has been published to R2.
        const selected = chooseEntry(CARD_FIXTURES.map((fixture) => ({ id: fixture.details.id, fixture })), previousId);
        if (!selected) return redirectToProfile();
        const svg = renderCard(selected.fixture.scene, selected.fixture.details, photoDataUrl, selected.fixture.sky);
        if (!svg.startsWith("<svg ") || !svg.endsWith("</svg>") || !svg.includes("data:image/png;base64,")) {
          throw new Error("Rendered fixture is not a complete self-contained PNG-backed SVG");
        }
        const version = (await contentEtag(svg)).replaceAll('"', "");
        await env.CARDS_BUCKET.put(CURRENT_KEY, svg, {
          httpMetadata: { contentType: "image/svg+xml; charset=utf-8", cacheControl: "no-cache, no-store, max-age=0, must-revalidate" },
          customMetadata: { id: selected.id, version },
        });
      } catch (error) {
        console.error("Could not publish the next fixture; preserving the previous current card.", error);
      }
      return redirectToProfile();
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
