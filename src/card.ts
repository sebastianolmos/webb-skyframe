import type { Scene } from "./orbit";
import { renderOrbit } from "./renderer";
import { renderSkyPanel } from "./sky-renderer";
import type { SkyFixture } from "./sky-fixtures";

export type CardDetails = {
  id: string;
  date: string;
  field: string;
  detector: string;
  filter: string;
  variant: string;
  seed: number;
};

const escapeXml = (value: string): string => value.replace(/[<>&"']/g, (character) => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
})[character]!);

export function renderCard(scene: Scene, details: CardDetails, photoDataUrl: string, sky: SkyFixture): string {
  const orbit = renderOrbit(scene, "compact");
  const orbitContent = orbit.slice(orbit.indexOf(">") + 1, orbit.lastIndexOf("</svg>"));
  const title = `${details.date} · ${details.field} · ${details.detector} / ${details.filter}`;
  const escapedTitle = escapeXml(title);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="570" viewBox="0 0 1080 570" role="img" aria-labelledby="card-title card-desc">
    <title id="card-title">${escapedTitle}</title>
    <desc id="card-desc">Synthetic demonstration card ${escapeXml(details.variant)}. The exposure image is shown with a celestial overview and detail rendered from the supplied sky fixture, alongside a synthetic Webb orbital diagram.</desc>
    <rect width="1080" height="570" fill="#090b10"/>
    <rect x="16" y="16" width="540" height="538" rx="10" fill="#171a21" stroke="#343943"/>
    <image x="22" y="22" width="528" height="526" preserveAspectRatio="xMidYMid meet" href="${photoDataUrl}"/>
    <rect x="22" y="494" width="528" height="54" fill="#090b10" fill-opacity=".88"/>
    <text x="40" y="520" fill="#fff" font-size="16" font-weight="700" font-family="Arial,sans-serif">${escapeXml(details.date)} · ${escapeXml(details.variant)}</text>
    <text x="40" y="539" fill="#c9ced8" font-size="11" font-family="Arial,sans-serif">${escapeXml(details.detector)} / ${escapeXml(details.filter)} · embedded sample raster</text>
    ${renderSkyPanel(sky)}
    <rect x="578" y="292" width="484" height="262" rx="12" fill="#101523" stroke="#343c50"/>
    <svg x="584" y="296" width="472" height="252" viewBox="0 0 1040 600" preserveAspectRatio="xMidYMid meet">${orbitContent}</svg>
    <text x="24" y="567" fill="#8992a2" font-size="9" font-family="Arial,sans-serif">Synthetic A/B integration fixture · orbital geometry is illustrative · card ${escapeXml(details.id)}</text>
  </svg>`;
}
