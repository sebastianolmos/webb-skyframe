import { createScene, presetPhase, type Phase, type Preset } from "./orbit";
import { renderOrbit, type RenderMode } from "./renderer";
import "./style.css";

const fields = {
  earth: document.querySelector<HTMLInputElement>("#earth-phase")!,
  moon: document.querySelector<HTMLInputElement>("#moon-phase")!,
  webb: document.querySelector<HTMLInputElement>("#webb-phase")!,
  longitude: document.querySelector<HTMLInputElement>("#longitude")!,
  latitude: document.querySelector<HTMLInputElement>("#latitude")!,
};
const outputs = {
  earth: document.querySelector<HTMLOutputElement>("#earth-value")!,
  moon: document.querySelector<HTMLOutputElement>("#moon-value")!,
  webb: document.querySelector<HTMLOutputElement>("#webb-value")!,
  longitude: document.querySelector<HTMLOutputElement>("#longitude-value")!,
  latitude: document.querySelector<HTMLOutputElement>("#latitude-value")!,
};
let preset: Preset = "march";
let phase: Phase = presetPhase(preset);
let renderMode: RenderMode = "large";

function draw(): void {
  for (const key of Object.keys(fields) as (keyof Phase)[]) {
    fields[key].value = String(phase[key]);
    outputs[key].value = `${phase[key]}°`;
  }
  const sceneHost = document.querySelector("#orbit-scene")!;
  sceneHost.classList.toggle("compact-preview", renderMode === "compact");
  sceneHost.innerHTML = renderOrbit(createScene(phase), renderMode);
  document.querySelector("#scene-date")!.textContent = `${preset[0].toUpperCase()}${preset.slice(1)} reference`;
}

function setRenderMode(mode: RenderMode): void {
  renderMode = mode;
  document.querySelector("#large-mode")!.setAttribute("aria-pressed", String(mode === "large"));
  document.querySelector("#compact-mode")!.setAttribute("aria-pressed", String(mode === "compact"));
  draw();
}

document.querySelector("#large-mode")!.addEventListener("click", () => setRenderMode("large"));
document.querySelector("#compact-mode")!.addEventListener("click", () => setRenderMode("compact"));

for (const key of Object.keys(fields) as (keyof Phase)[]) {
  fields[key].addEventListener("input", () => {
    phase = { ...phase, [key]: Number(fields[key].value) };
    draw();
    fields[key].focus({ preventScroll: true });
  });
}

document.querySelector<HTMLSelectElement>("#preset")!.addEventListener("change", (event) => {
  preset = (event.currentTarget as HTMLSelectElement).value as Preset;
  phase = presetPhase(preset);
  draw();
});

document.querySelector<HTMLButtonElement>("#reset")!.addEventListener("click", () => {
  phase = presetPhase(preset);
  draw();
  fields.earth.focus({ preventScroll: true });
});

draw();
