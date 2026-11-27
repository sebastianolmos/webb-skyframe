export type OrbitVector = readonly [number, number, number];

/** Fully resolved, offline orbit inputs in heliocentric ecliptic J2000 km. */
export type PhysicalOrbitScene = {
  readonly kind: "physical";
  readonly sun: OrbitVector;
  readonly earth: OrbitVector;
  readonly earthTrack: readonly OrbitVector[];
  readonly earthTrackEpochsJdTdb: readonly number[];
  readonly moon: OrbitVector;
  readonly moonTrack: readonly OrbitVector[];
  readonly l2: OrbitVector;
  readonly webb: OrbitVector;
  readonly webbTrack: readonly OrbitVector[];
  readonly pointing: OrbitVector;
  readonly camera: { readonly u: OrbitVector; readonly v: OrbitVector };
  readonly localMagnification: number;
};

const dot = (a: OrbitVector, b: OrbitVector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: OrbitVector, b: OrbitVector): OrbitVector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const subtract = (a: OrbitVector, b: OrbitVector): OrbitVector => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * Maps the real exposure state to the increment 1 compact diagram controls.
 * The diagram remains schematic; these angles move its existing markers as if
 * its Earth, Moon and Webb sliders had been set from the measured vectors.
 */
export function physicalOrbitDiagram(scene: PhysicalOrbitScene): {
  phases: { earth: number; moon: number; webb: number };
  pointing: OrbitVector;
} {
  const earthPhase = Math.atan2(dot(scene.earth, scene.camera.v), dot(scene.earth, scene.camera.u)) * 180 / Math.PI;
  const moonOffset = subtract(scene.moon, scene.earth);
  const moonPhase = Math.atan2(dot(moonOffset, scene.camera.v), dot(moonOffset, scene.camera.u)) * 180 / Math.PI;

  // The existing Webb ellipse is aligned perpendicular to the Sunâ€“Earth line.
  // Resolve the real Webbâ€“L2 offset into those same screen axes for its slider phase.
  const sunScreen: readonly [number, number] = [dot(scene.sun, scene.camera.u), -dot(scene.sun, scene.camera.v)];
  const earthScreen: readonly [number, number] = [dot(scene.earth, scene.camera.u), -dot(scene.earth, scene.camera.v)];
  const antisolarAngle = Math.atan2(earthScreen[1] - sunScreen[1], earthScreen[0] - sunScreen[0]);
  const majorAngle = antisolarAngle + Math.PI / 2;
  const major: readonly [number, number] = [Math.cos(majorAngle), Math.sin(majorAngle)];
  const minor: readonly [number, number] = [-Math.sin(majorAngle), Math.cos(majorAngle)];
  const webbOffset = subtract(scene.webb, scene.l2);
  const webbScreen: readonly [number, number] = [dot(webbOffset, scene.camera.u), -dot(webbOffset, scene.camera.v)];
  const webbPhase = Math.atan2(webbScreen[0] * minor[0] + webbScreen[1] * minor[1], webbScreen[0] * major[0] + webbScreen[1] * major[1]) * 180 / Math.PI;
  const viewNormal = cross(scene.camera.u, scene.camera.v);

  return {
    phases: { earth: earthPhase, moon: moonPhase, webb: webbPhase },
    pointing: [dot(scene.pointing, scene.camera.u), dot(scene.pointing, scene.camera.v), dot(scene.pointing, viewNormal)],
  };
}
