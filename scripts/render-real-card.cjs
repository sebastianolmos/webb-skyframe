const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const root = path.resolve(__dirname, "..");
const bundle = path.resolve(process.argv[2] || path.join(root, "docs", "evidence", "increment-4", "real-bundle"));
const observation = JSON.parse(fs.readFileSync(path.join(bundle, "observation.json"), "utf8"));
const sky = JSON.parse(fs.readFileSync(path.join(bundle, "sky.json"), "utf8"));
const orbit = JSON.parse(fs.readFileSync(path.join(bundle, "orbit.json"), "utf8"));
verifyBundleMembers(observation.members);
if (sky.scene.overviewStars.length !== 0 || sky.scene.detail.stars.length !== 0) {
  throw new Error("The real constellation panel must not render contextual catalog stars");
}
if (sky.catalog.figures.selectedFeatures.length !== 1 || sky.catalog.figures.selectedFeatures[0] !== sky.abbreviation) {
  throw new Error("The real constellation panel must contain only the field's primary constellation");
}
if (sky.scene.detail.sizeDeg.some((value) => value < 4.9 || value > 5.1)) {
  throw new Error("The real local reference view must stay at its documented moderate five-degree span");
}
if (!orbit.scene.earthTrackEpochsJdTdb || orbit.scene.earthTrackEpochsJdTdb.length !== orbit.scene.earthTrack.length || !orbit.scene.moonTrack.length || !orbit.scene.webbTrack.length) {
  throw new Error("The real location/orbit panel requires the time-tagged Horizons trajectories");
}
const image = fs.readFileSync(path.join(bundle, observation.image.key));
const photoDataUrl = `data:image/png;base64,${image.toString("base64")}`;
const { renderCard } = require(path.join(root, "src", "card.ts"));
const { REAL_CARD_SKY_PRESENTATION } = require(path.join(root, "src", "real-card-presentation.ts"));
if (!sky.scene.figureStars.length) throw new Error("The target constellation must show its stellar vertices");

// Guard the normal render entry point: it has to work from resolved files alone.
global.fetch = () => { throw new Error("Network access is disabled during real-card rendering"); };

const date = observation.time.middle.slice(0, 10);
const details = {
  id: observation.product.id,
  date,
  field: observation.product.target,
  detector: observation.product.detector,
  filter: observation.product.filter,
  variant: observation.product.target,
  seed: 0,
  mode: "real",
  credit: "NASA/ESA/CSA James Webb Space Telescope · Program 09438 · MAST/STScI",
};
const skyDisplay = {
  heading: `${sky.region} · JWST field`,
  coordinateCaption: `ICRS ${sky.scene.center[0].toFixed(4)}°, ${sky.scene.center[1].toFixed(4)}°`,
  symbolicPointingSquare: true,
  constellationOverviewZoom: REAL_CARD_SKY_PRESENTATION.constellationOverviewZoom,
  pointingReferenceSquareSize: REAL_CARD_SKY_PRESENTATION.pointingReferenceSquareSize,
};
const svg = renderCard(orbit.scene, details, photoDataUrl, sky.scene, skyDisplay);
if (svg.includes("Synthetic demonstration") || svg.includes("Synthetic A/B")) {
  throw new Error("Real card includes synthetic-only copy");
}
if (!svg.startsWith("<svg") || !svg.includes("image/png;base64,") || !svg.includes("Location of the Webb Telescope") || !svg.includes("orbit-months") || svg.includes("LOCAL OFFSETS") || svg.includes("Horizons tracks")) {
  throw new Error("Rendered card is missing its embedded raster or increment 1 compact orbit view");
}
if (/<script\b|(?:href|src)=["']https?:|url\(https?:/i.test(svg)) {
  throw new Error("Real card contains script or an external resource reference");
}

const svgPath = path.join(bundle, "real-card.svg");
const pngPath = path.join(bundle, "real-card.png");
fs.writeFileSync(svgPath, svg, "utf8");
const browser = findBrowser();
const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "webb-skyframe-real-card-"));
try {
  const screenshot = childProcess.spawnSync(browser, [
    "--headless", "--disable-gpu", "--disable-software-rasterizer", "--no-sandbox",
    "--disable-dev-shm-usage", `--user-data-dir=${path.join(temporaryDir, "profile")}`,
    "--window-size=1080,570", `--screenshot=${pngPath}`, pathToFileURL(svgPath).href,
  ], { encoding: "utf8", stdio: "ignore" });
  if (screenshot.status !== 0 || !fs.existsSync(pngPath)) {
    throw new Error("Chromium could not render the resolved real card");
  }
  const receipt = {
    result: "PASS",
    network: "disabled; render entry uses only JSON and PNG files from this bundle",
    node: process.version,
    renderer: `TypeScript ${ts.version}`,
    browser: browserVersion(browser),
    productId: observation.product.id,
    mode: svg.includes("CONSTELLATION + LOCAL REFERENCE") ? "double" : "single",
    svg: { bytes: fs.statSync(svgPath).size, sha256: hashFile(svgPath) },
    png: { bytes: fs.statSync(pngPath).size, sha256: hashFile(pngPath) },
    sourcePhoto: { bytes: image.length, sha256: crypto.createHash("sha256").update(image).digest("hex") },
    bundleMemberDigests: observation.members,
  };
  fs.writeFileSync(path.join(bundle, "render-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  const resolvedTemporaryDir = path.resolve(temporaryDir);
  if (!resolvedTemporaryDir.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    throw new Error("Refusing to remove an unexpected temporary directory");
  }
  fs.rmSync(resolvedTemporaryDir, { recursive: true, force: true });
}

function hashFile(filename) {
  return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

function verifyBundleMembers(members) {
  if (!members || typeof members !== "object") throw new Error("Observation bundle is missing its member digest table");
  for (const [key, expected] of Object.entries(members)) {
    const memberPath = path.resolve(bundle, key);
    if (!memberPath.startsWith(bundle + path.sep)) throw new Error(`Unsafe bundle member path: ${key}`);
    if (!fs.existsSync(memberPath)) throw new Error(`Missing bundle member: ${key}`);
    const actualBytes = fs.statSync(memberPath).size;
    if (actualBytes !== expected.bytes || hashFile(memberPath) !== expected.sha256) {
      throw new Error(`Bundle member digest mismatch: ${key}`);
    }
  }
}

function findBrowser() {
  const candidates = [
    process.env.BROWSER_BIN,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("A local Chromium/Chrome browser is required; set BROWSER_BIN to its executable path.");
  return found;
}

function browserVersion(executable) {
  const result = childProcess.spawnSync(executable, ["--version"], { encoding: "utf8" });
  const output = (result.stdout || result.stderr).trim();
  if (output) return output;
  if (process.platform === "win32") {
    const literal = executable.replace(/'/g, "''");
    const version = childProcess.spawnSync("powershell.exe", ["-NoProfile", "-Command", `(Get-Item -LiteralPath '${literal}').VersionInfo.ProductVersion`], { encoding: "utf8" });
    return version.stdout.trim() || "version unavailable";
  }
  return "version unavailable";
}
