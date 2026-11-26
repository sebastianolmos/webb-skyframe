export type Vec3 = readonly [number, number, number];
export type Phase = { earth: number; moon: number; webb: number; longitude: number; latitude: number };
export type Preset = "march" | "july" | "november";
export type Scene = { sun: Vec3; earth: Vec3; moon: Vec3; l2: Vec3; webb: Vec3; pointing: Vec3; earthTrack: Vec3[]; moonTrack: Vec3[]; webbTrack: Vec3[]; phases: Pick<Phase, "earth" | "moon" | "webb"> };
const angle = (degrees: number) => degrees * Math.PI / 180;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

const presets: Record<Preset, Phase> = {
  march: { earth: 270, moon: 128, webb: 228, longitude: 52, latitude: 18 },
  july: { earth: 0, moon: 36, webb: 48, longitude: 130, latitude: 24 },
  november: { earth: 90, moon: 214, webb: 132, longitude: 310, latitude: -16 },
};

export function presetPhase(name: Preset): Phase {
  return { ...presets[name] };
}

function earthAt(phase: number): Vec3 {
  const a = angle(phase);
  return [Math.cos(a) * 149_600_000, Math.sin(a) * 149_600_000, Math.sin(a) * 2_600_000];
}

function basis(earth: Vec3): { radial: Vec3; tangent: Vec3; normal: Vec3 } {
  const radial = scale(earth, 1 / Math.hypot(...earth));
  const normal: Vec3 = [-radial[1], radial[0], 0];
  return { radial, tangent: [-normal[0] * Math.cos(angle(23.4)), -normal[1] * Math.cos(angle(23.4)), Math.sin(angle(23.4))], normal };
}

function pointAround(center: Vec3, phase: number, radius: number, zScale: number, frame: ReturnType<typeof basis>): Vec3 {
  const a = angle(phase);
  return add(center, add(scale(frame.tangent, Math.cos(a) * radius), add(scale(frame.normal, Math.sin(a) * radius), [0, 0, Math.sin(a) * zScale])));
}

export function createScene(phase: Phase): Scene {
  const earth = earthAt(phase.earth);
  const frame = basis(earth);
  const l2 = add(earth, scale(frame.radial, 1_500_000));
  const moon = pointAround(earth, phase.moon, 384_400, 80_000, frame);
  const webb = pointAround(l2, phase.webb, 240_000, 90_000, frame);
  const longitude = angle(phase.longitude);
  const latitude = angle(phase.latitude);
  const pointing: Vec3 = [Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)];
  const earthTrack = Array.from({ length: 241 }, (_, i) => earthAt(i * 1.5));
  const moonTrack = Array.from({ length: 121 }, (_, i) => pointAround(earth, i * 3, 384_400, 80_000, frame));
  const webbTrack = Array.from({ length: 121 }, (_, i) => pointAround(l2, i * 3, 240_000, 90_000, frame));
  return { sun: [0, 0, 0], earth, moon, l2, webb, pointing, earthTrack, moonTrack, webbTrack, phases: { earth: phase.earth, moon: phase.moon, webb: phase.webb } };
}
