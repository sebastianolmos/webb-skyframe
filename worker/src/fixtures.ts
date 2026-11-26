import { createScene, presetPhase, type Preset } from "../../src/orbit";
import { SKY_FIXTURES } from "../../src/sky-fixtures";
// PNG bytes generated from the retained 2048px source by scripts/resize-sample-photo.ps1.
import samplePhoto from "./fixtures/sample-photo.bin";

const photoBytes = new Uint8Array(samplePhoto);
let photoBinary = "";
for (let offset = 0; offset < photoBytes.length; offset += 0x8000) {
  photoBinary += String.fromCharCode(...photoBytes.subarray(offset, offset + 0x8000));
}
const photoDataUrl = `data:image/png;base64,${btoa(photoBinary)}`;

export const CARD_FIXTURES = [
  {
    details: { id: "fixture-a", date: "2025-03-20", field: "Synthetic Field A", detector: "NRCA3", filter: "F140M", variant: "FIXTURE A · MARCH", seed: 438 },
    scene: createScene(presetPhase("march" as Preset)),
    sky: SKY_FIXTURES[0],
  },
  {
    details: { id: "fixture-b", date: "2025-07-01", field: "Synthetic Field B", detector: "NRCA3", filter: "F140M", variant: "FIXTURE B · JULY", seed: 972 },
    scene: createScene(presetPhase("july" as Preset)),
    sky: SKY_FIXTURES[1],
  },
] as const;

export { photoDataUrl };
