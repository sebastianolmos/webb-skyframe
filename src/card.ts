import type { Scene } from "./orbit";
import { renderOrbit } from "./renderer";

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

function provisionalSky(seed: number): string {
  let state = seed >>> 0;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const stars = Array.from({ length: 70 }, () => {
    const x = 600 + random() * 440;
    const y = 64 + random() * 188;
    const radius = 0.7 + random() * 1.8;
    const opacity = 0.35 + random() * 0.6;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}" fill="#d8e3ff" opacity="${opacity.toFixed(2)}"/>`;
  }).join("");
  const angle = (seed % 31) - 15;
  return `<rect x="578" y="18" width="484" height="260" rx="12" fill="#101523" stroke="#343c50"/>
    <text x="598" y="46" fill="#f3f4f8" font-size="16" font-weight="700" font-family="Arial,sans-serif">PROVISIONAL SKY MAP</text>
    <text x="1042" y="46" text-anchor="end" fill="#aeb8ca" font-size="11" font-family="Arial,sans-serif">synthetic fixture</text>
    <rect x="594" y="57" width="452" height="204" rx="5" fill="#090d18"/>
    ${stars}
    <g transform="rotate(${angle} 820 159)" fill="none" stroke="#bd83ff" stroke-width="2.4">
      <path d="M708 112 L930 91 L960 190 L739 211 Z" fill="#a976e8" fill-opacity=".12"/>
      <path d="M740 159 L783 125 L820 172 L861 111 L902 158 L934 142" stroke="#8999be" stroke-opacity=".72" stroke-width="1"/>
    </g>
    <text x="601" y="250" fill="#b7c2d7" font-size="10" font-family="Arial,sans-serif">Field footprint is illustrative; sky coordinates are not calibrated.</text>`;
}

export function renderCard(scene: Scene, details: CardDetails, photoDataUrl: string): string {
  const orbit = renderOrbit(scene, "compact");
  const orbitContent = orbit.slice(orbit.indexOf(">") + 1, orbit.lastIndexOf("</svg>"));
  const title = `${details.date} · ${details.field} · ${details.detector} / ${details.filter}`;
  const escapedTitle = escapeXml(title);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="570" viewBox="0 0 1080 570" role="img" aria-labelledby="card-title card-desc">
    <title id="card-title">${escapedTitle}</title>
    <desc id="card-desc">Synthetic demonstration card ${escapeXml(details.variant)}. The source exposure image is shown with a provisional sky panel and a synthetic Webb orbital diagram.</desc>
    <rect width="1080" height="570" fill="#090b10"/>
    <rect x="16" y="16" width="540" height="538" rx="10" fill="#171a21" stroke="#343943"/>
    <image x="22" y="22" width="528" height="526" preserveAspectRatio="xMidYMid meet" href="${photoDataUrl}"/>
    <rect x="22" y="494" width="528" height="54" fill="#090b10" fill-opacity=".88"/>
    <text x="40" y="520" fill="#fff" font-size="16" font-weight="700" font-family="Arial,sans-serif">${escapeXml(details.date)} · ${escapeXml(details.variant)}</text>
    <text x="40" y="539" fill="#c9ced8" font-size="11" font-family="Arial,sans-serif">${escapeXml(details.detector)} / ${escapeXml(details.filter)} · embedded sample raster</text>
    ${provisionalSky(details.seed)}
    <rect x="578" y="292" width="484" height="262" rx="12" fill="#101523" stroke="#343c50"/>
    <svg x="584" y="296" width="472" height="252" viewBox="0 0 1040 600" preserveAspectRatio="xMidYMid meet">${orbitContent}</svg>
    <text x="24" y="567" fill="#8992a2" font-size="9" font-family="Arial,sans-serif">Synthetic A/B integration fixture · orbital geometry is illustrative · card ${escapeXml(details.id)}</text>
  </svg>`;
}
