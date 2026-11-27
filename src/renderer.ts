import type { Scene } from "./orbit";

const radians = (degrees: number) => degrees * Math.PI / 180;
const annualPoint = (phase: number): [number, number] => [
  520 + 355 * Math.cos(radians(phase)),
  340 - 132 * Math.sin(radians(phase)),
];

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 -${rx * 2} 0`;
}

function localPoint(cx: number, cy: number, phase: number, rx: number, ry: number): [number, number] {
  return [cx + rx * Math.cos(radians(phase)), cy - ry * Math.sin(radians(phase))];
}

function rotatedEllipsePoint(cx: number, cy: number, phase: number, major: number, minor: number, rotation: number): [number, number] {
  const a = radians(phase);
  const u = major * Math.cos(a);
  const v = minor * Math.sin(a);
  return [cx + u * Math.cos(rotation) - v * Math.sin(rotation), cy + u * Math.sin(rotation) + v * Math.cos(rotation)];
}

function circle([x, y]: [number, number], radius: number, fill: string): string {
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius}" fill="${fill}"/>`;
}

export type RenderMode = "large" | "compact";
export type OrbitDiagramScene = Pick<Scene, "phases" | "pointing">;
export type OrbitDiagramLabels = { title?: string; description?: string };

export function renderOrbit(scene: OrbitDiagramScene, mode: RenderMode = "large", labels: OrbitDiagramLabels = {}): string {
  const compact = mode === "compact";
  const novemberOffset = compact && scene.phases.earth >= 45 && scene.phases.earth <= 135 ? 56 : 0;
  const diagramCenterY = 340 + novemberOffset;
  const sun: [number, number] = [520, diagramCenterY];
  const earth = annualPoint(scene.phases.earth);
  earth[1] += novemberOffset;
  const moonOrbit: [number, number] = [earth[0], earth[1]];
  const moonRadiusX = compact ? 43 : 37;
  const moonRadiusY = compact ? 29 : 25;
  const moon = localPoint(moonOrbit[0], moonOrbit[1], scene.phases.moon, moonRadiusX, moonRadiusY);
  const sunwardDx = earth[0] - sun[0];
  const sunwardDy = earth[1] - sun[1];
  const antisolarAngle = Math.atan2(sunwardDy, sunwardDx);
  const localCenter: [number, number] = [earth[0] + Math.cos(antisolarAngle) * (compact ? 78 : 61), earth[1] + Math.sin(antisolarAngle) * (compact ? 78 : 61)];
  const webbOrbitAngle = antisolarAngle + Math.PI / 2;
  const webb = rotatedEllipsePoint(localCenter[0], localCenter[1], scene.phases.webb, compact ? 68 : 51, compact ? 9 : 11, webbOrbitAngle);

  const [longitude, latitude] = scene.pointing;
  const screenLength = Math.hypot(longitude, latitude);
  const direction = screenLength < 0.08
    ? `<text x="${webb[0]}" y="${webb[1] - 17}" class="point-label">${scene.pointing[2] >= 0 ? "⊙ toward" : "⊗ away"}</text>`
    : (() => {
      const ux = longitude / screenLength;
      const uy = -latitude / screenLength;
      const tipDistance = compact ? 34 : 28;
      const baseLength = compact ? 31 : 24;
      const halfWidth = compact ? 14 : 11;
      const tipX = webb[0] + ux * tipDistance;
      const tipY = webb[1] + uy * tipDistance;
      return `<path d="M${tipX},${tipY} L${tipX - ux * baseLength - uy * halfWidth},${tipY - uy * baseLength + ux * halfWidth} L${tipX - ux * baseLength + uy * halfWidth},${tipY - uy * baseLength - ux * halfWidth} Z" fill="${compact ? "#d18cff" : "#bc83ff"}"/>`;
    })();

  const labelSpecs = [
    { anchor: earth, name: "Earth", color: "#67db9e", candidates: [[12, -12], [12, 22], [-48, -12], [-48, 22], [0, -30]] },
    { anchor: moon, name: "Moon", color: "#bdcad1", candidates: [[10, -10], [10, 22], [-48, -10], [-48, 22], [0, -28]] },
    { anchor: localCenter, name: "L2", color: "#ffad77", candidates: [[16, -22], [16, 34], [-48, -22], [-48, 34], [0, -42]] },
    { anchor: webb, name: "Webb", color: compact ? "#ff8738" : "#ffad77", candidates: compact && webb[0] > 790
      ? [[-220, -50], [-220, 75], [-190, -85], [-250, 5], [-180, 100]]
      : [[16, 38], [16, -24], [-82, 38], [-82, -24], [0, 50]] },
  ];
  const placed: { x: number; y: number; width: number }[] = [];
  const visibleLabels = compact
    ? labelSpecs.filter(({ name }) => name === "Webb")
    : labelSpecs;
  const labelSvg = (compact ? "" : `<text x="${sun[0] + 30}" y="${sun[1] - 25}" fill="#f4d55b" class="marker-label">Sun</text>`) + visibleLabels.map(({ anchor, name, color, candidates }) => {
    const [dx, dy] = candidates.find(([x, y]) => {
      const left = anchor[0] + x;
      const baseline = anchor[1] + y;
      const width = name.length * (compact ? 19 : 8);
      const labelHeight = compact ? 42 : 16;
      return placed.every(label => left + width + 10 < label.x || left > label.x + label.width + 10 || baseline + 12 < label.y || baseline - labelHeight > label.y);
    }) ?? candidates[0];
    const x = anchor[0] + dx;
    const y = anchor[1] + dy;
    const width = name.length * (compact ? 19 : 8);
    placed.push({ x, y, width });
    return `<text x="${x}" y="${y}" fill="${color}" class="marker-label">${name}</text>`;
  }).join("");
  const legendX = earth[0] < 430 && earth[1] > 330 ? 850 : 28;
  const compactLegend = compact ? `<g class="compact-legend" font-family="DM Sans,Arial,sans-serif" font-size="30" font-weight="700">
    <circle cx="${legendX + 12}" cy="482" r="11" fill="#f4d55b"/><text x="${legendX + 34}" y="492" fill="#f4d55b">Sun</text>
    <circle cx="${legendX + 12}" cy="512" r="11" fill="#55d796"/><text x="${legendX + 34}" y="522" fill="#67db9e">Earth</text>
    <circle cx="${legendX + 12}" cy="542" r="9" fill="#c5d1d8"/><text x="${legendX + 34}" y="552" fill="#d5dce1">Moon</text>
    <circle cx="${legendX + 12}" cy="572" r="9" fill="#ffad77"/><text x="${legendX + 34}" y="582" fill="#ffad77">L2</text>
  </g>` : "";
  const monthLabels = [
    { name: "November", point: [520, 191 + novemberOffset] as [number, number] },
    { name: "March", point: [520, 512 + novemberOffset] as [number, number] },
    { name: compact ? "Jan" : "January", point: [112, 346 + novemberOffset] as [number, number] },
    { name: "July", point: [compact ? 930 : 895, 346 + novemberOffset] as [number, number] },
  ].map(({ name, point }) => {
    const distance = Math.hypot(earth[0] - point[0], earth[1] - point[1]);
    const opacity = distance < (compact ? 150 : 105) ? 0 : 1;
    return `<text x="${point[0]}" y="${point[1]}" text-anchor="middle" opacity="${opacity}">${name}</text>`;
  }).join("");

  const markerScale = compact ? 1.45 : 1;
  const lineWidth = compact ? 4.2 : 2.5;
  const labelSize = compact ? 36 : 12;
  return `<svg class="orbit-svg ${compact ? "compact" : "large"}" viewBox="0 0 1040 600" role="img" aria-labelledby="orbit-title orbit-desc" xmlns="http://www.w3.org/2000/svg">
    <title id="orbit-title">${labels.title ?? "Synthetic Webb orbital scene"}</title>
    <desc id="orbit-desc">${labels.description ?? "A horizontal, side-view diagram of Earth's annual ellipse around the centered Sun, with visible schematic ellipses for the Moon around Earth and Webb around L2. The purple marker shows Webb's pointing direction."}</desc>
    <defs><radialGradient id="space"><stop stop-color="${compact ? "#252b3d" : "#111622"}"/><stop offset="1" stop-color="#090b10"/></radialGradient></defs>
    <rect width="1040" height="600" fill="url(#space)"/>
    <text x="520" y="58" text-anchor="middle" fill="#ececf2" font-size="${compact ? 38 : 20}" font-weight="${compact ? 700 : 500}" font-family="DM Sans,Arial,sans-serif">Location of the Webb Telescope</text>
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="${ellipsePath(520, diagramCenterY, 355, 132)}" stroke="#e5e8eb" stroke-opacity=".72" stroke-width="${lineWidth}"/>
      <path d="${ellipsePath(moonOrbit[0], moonOrbit[1], moonRadiusX, moonRadiusY)}" stroke="#49d8dd" stroke-width="${compact ? 4.8 : 3}"/>
      <ellipse cx="${localCenter[0]}" cy="${localCenter[1]}" rx="${compact ? 68 : 51}" ry="${compact ? 9 : 11}" transform="rotate(${webbOrbitAngle * 180 / Math.PI} ${localCenter[0]} ${localCenter[1]})" stroke="${compact ? "#ff8738" : "#ffb56f"}" stroke-width="${compact ? 5.5 : 3}"/>
      <path d="M${earth[0]},${earth[1]} L${localCenter[0]},${localCenter[1]}" stroke="#ffb56f" stroke-width="${compact ? 3.5 : 2}"/>
    </g>
    ${circle(sun, 21 * markerScale, "#f4d55b")}
    ${circle(earth, 10 * markerScale, "#55d796")}
    ${circle(moon, 7 * markerScale, "#c5d1d8")}
    ${circle(localCenter, 6 * markerScale, "#ffb56f")}
    ${circle(webb, 7 * markerScale, compact ? "#ff8738" : "#ffb56f")}
    <g class="labels" font-size="${labelSize}" font-weight="${compact ? 700 : 400}">${labelSvg}</g>
    <g class="orbit-months" fill="#dddde5" font-size="${compact ? 30 : 15}" font-weight="${compact ? 800 : 400}" font-family="DM Mono,monospace">${monthLabels}</g>
    ${compactLegend}
    ${direction}
  </svg>`;
}
