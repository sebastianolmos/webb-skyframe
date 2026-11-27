import type { Scene } from "./orbit";
import { renderOrbit } from "./renderer";
import { physicalOrbitDiagram, type PhysicalOrbitScene } from "./physical-orbit";
import { renderSkyPanel, type SkyPanelDisplay, type SkyPanelScene } from "./sky-renderer";

export type CardDetails = {
  id: string;
  date: string;
  field: string;
  detector: string;
  filter: string;
  variant: string;
  seed: number;
  mode?: "synthetic" | "real";
  credit?: string;
};

const escapeXml = (value: string): string => value.replace(/[<>&"']/g, (character) => ({
  "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
})[character]!);

function isPhysicalOrbit(scene: Scene | PhysicalOrbitScene): scene is PhysicalOrbitScene {
  return (scene as Partial<PhysicalOrbitScene>).kind === "physical";
}

export function renderCard(scene: Scene | PhysicalOrbitScene, details: CardDetails, photoDataUrl: string, sky: SkyPanelScene, skyDisplay?: SkyPanelDisplay): string {
  const physicalScene = isPhysicalOrbit(scene);
  if (details.mode === "real" && !physicalScene) {
    throw new TypeError("A real exposure card requires a resolved physical orbit scene");
  }
  const orbit = physicalScene ? renderOrbit(physicalOrbitDiagram(scene), "compact") : renderOrbit(scene, "compact");
  const orbitContent = orbit.slice(orbit.indexOf(">") + 1, orbit.lastIndexOf("</svg>"));
  const title = `${details.date} · ${details.field} · ${details.detector} / ${details.filter}`;
  const escapedTitle = escapeXml(title);
  const real = details.mode === "real";
  const description = real
    ? `Calibrated James Webb Space Telescope exposure ${escapeXml(details.field)}, ${escapeXml(details.detector)}, ${escapeXml(details.filter)}. Image and sky geometry are resolved inputs. Orbital marker phases and pointing derive from exposure-time vectors; displayed curves are illustrative.`
    : `Synthetic demonstration card ${escapeXml(details.variant)}. The exposure image is shown with a celestial overview and detail rendered from the supplied sky fixture, alongside a synthetic Webb orbital diagram.`;
  const imageCaption = `${escapeXml(details.detector)} / ${escapeXml(details.filter)} · ${real ? "calibrated full-frame image" : "embedded sample raster"}`;
  const footer = real
    ? escapeXml(details.credit ?? "JWST observation · MAST")
    : `Synthetic A/B integration fixture · orbital geometry is illustrative · card ${escapeXml(details.id)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="570" viewBox="0 0 1080 570" role="img" aria-labelledby="card-title card-desc">
    <title id="card-title">${escapedTitle}</title>
    <desc id="card-desc">${description}</desc>
    <rect width="1080" height="570" fill="#090b10"/>
    <rect x="16" y="16" width="540" height="538" rx="10" fill="#171a21" stroke="#343943"/>
    <image x="22" y="22" width="528" height="526" preserveAspectRatio="xMidYMid meet" href="${photoDataUrl}"/>
    <rect x="22" y="494" width="528" height="54" fill="#090b10" fill-opacity=".88"/>
    <text x="40" y="520" fill="#fff" font-size="16" font-weight="700" font-family="Arial,sans-serif">${escapeXml(details.date)} · ${escapeXml(details.variant)}</text>
    <text x="40" y="539" fill="#c9ced8" font-size="11" font-family="Arial,sans-serif">${imageCaption}</text>
    ${renderSkyPanel(sky, skyDisplay)}
    <rect x="578" y="292" width="484" height="262" rx="12" fill="#101523" stroke="#343c50"/>
    <svg x="584" y="296" width="472" height="252" viewBox="0 0 1040 600" preserveAspectRatio="xMidYMid meet">${orbitContent}</svg>
    <text x="24" y="567" fill="#8992a2" font-size="9" font-family="Arial,sans-serif">${footer}</text>
  </svg>`;
}
