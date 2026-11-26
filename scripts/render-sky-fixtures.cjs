const childProcess = require("node:child_process");
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
const outputDir = path.resolve(process.argv[2] || path.join(root, "docs", "evidence", "increment-3"));
const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "webb-skyframe-increment-3-"));
const browserPath = findBrowser();
const browserVersion = getBrowserVersion(browserPath);
const { renderCard } = require(path.join(root, "src", "card.ts"));
const { createScene, presetPhase } = require(path.join(root, "src", "orbit.ts"));
const { SKY_FIXTURES } = require(path.join(root, "src", "sky-fixtures.ts"));

const samplePhoto = fs.readFileSync(path.join(root, "worker", "src", "fixtures", "sample-photo.bin"));
const photoDataUrl = `data:image/png;base64,${samplePhoto.toString("base64")}`;
const cases = [
  { fixtureIndex: 0, preset: "march", file: "single-overview.png" },
  { fixtureIndex: 1, preset: "july", file: "double-zoom.png" },
  { fixtureIndex: 2, preset: "july", file: "rotated-field.png" },
  { fixtureIndex: 3, preset: "july", file: "ra-zero-wrap.png" },
  { fixtureIndex: 4, preset: "july", file: "near-pole-empty-detail.png" },
];

fs.mkdirSync(outputDir, { recursive: true });
console.log(`Renderer: TypeScript ${ts.version}; ${browserVersion}`);
console.log(`Inputs: synthetic-sky-1; retained worker sample-photo.bin; output: ${outputDir}`);

for (const item of cases) {
  const sky = SKY_FIXTURES[item.fixtureIndex];
  const details = {
    id: sky.id,
    date: "2025-01-01",
    field: sky.id,
    detector: "SYNTH",
    filter: "TEST",
    variant: sky.id,
    seed: item.fixtureIndex,
  };
  const svg = renderCard(createScene(presetPhase(item.preset)), details, photoDataUrl, sky);
  const svgPath = path.join(temporaryDir, `${sky.id}.svg`);
  const pngPath = path.join(outputDir, item.file);
  fs.writeFileSync(svgPath, svg);
  const result = childProcess.spawnSync(browserPath, [
    "--headless",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--user-data-dir=${path.join(temporaryDir, `${sky.id}-profile`)}`,
    "--window-size=1080,570",
    `--screenshot=${pngPath}`,
    pathToFileURL(svgPath).href,
  ], { encoding: "utf8", stdio: "ignore" });
  if (result.status !== 0 || !fs.existsSync(pngPath)) {
    throw new Error(`Could not render ${sky.id}; set BROWSER_BIN to a local Chromium or Chrome executable.`);
  }
  const panelMode = svg.includes("SKY OVERVIEW + DETAIL") ? "double" : "single";
  console.log(`${sky.id}: ${panelMode} overview, ${fs.statSync(pngPath).size} PNG bytes -> ${item.file}`);
}

function findBrowser() {
  const candidates = [
    process.env.BROWSER_BIN,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/microsoft-edge",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("A local Chromium/Chrome browser is required; set BROWSER_BIN to its executable path.");
  return found;
}

function getBrowserVersion(executable) {
  const versionResult = childProcess.spawnSync(executable, ["--version"], { encoding: "utf8" });
  const reported = (versionResult.stdout || versionResult.stderr).trim();
  if (reported) return reported;
  if (process.platform === "win32") {
    const literalPath = executable.replace(/'/g, "''");
    const command = `(Get-Item -LiteralPath '${literalPath}').VersionInfo.ProductVersion`;
    const powershell = childProcess.spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" });
    return powershell.stdout.trim() || "version unavailable";
  }
  return "version unavailable";
}
