import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apps = [
  { name: "Refill", path: "apps/lpg-mobile", projectIdEnv: "EXPO_PUBLIC_EAS_PROJECT_ID" },
  { name: "Store", path: "apps/store-mobile", projectIdEnv: "EXPO_PUBLIC_STORE_EAS_PROJECT_ID" },
  { name: "Bills", path: "apps/bills-mobile", projectIdEnv: "EXPO_PUBLIC_BILLS_EAS_PROJECT_ID" },
  { name: "Logistics", path: "apps/logistics-mobile", projectIdEnv: "EXPO_PUBLIC_LOGISTICS_EAS_PROJECT_ID" },
];
const assetRelativePath = "./assets/skima-splash-logo.png";
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

for (const app of apps) {
  const config = read(`${app.path}/app.config.ts`);
  const assetPath = resolve(root, app.path, assetRelativePath);
  assert(existsSync(assetPath), `${app.name}: missing app-local asset ${assetRelativePath}`);

  const png = readFileSync(assetPath);
  assert(png.length > 24 && png.subarray(0, 8).equals(pngSignature), `${app.name}: branding asset is not a valid PNG`);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert(width === height, `${app.name}: branding PNG must be square (received ${width}x${height})`);

  assert(config.includes(`const brandImage = "${assetRelativePath}";`), `${app.name}: app config must define its app-local asset path`);
  assert(config.includes("existsSync(brandImagePath)"), `${app.name}: app config must fail early when the asset is missing`);
  assert(/icon\s*:\s*brandImage/.test(config), `${app.name}: top-level app icon is not configured`);
  assert(/foregroundImage\s*:\s*brandImage/.test(config), `${app.name}: Android adaptive icon is not configured`);
  assert(/image\s*:\s*brandImage/.test(config), `${app.name}: native splash image is not configured`);
  assert(config.includes(`process.env.${app.projectIdEnv}`), `${app.name}: dedicated EAS project ID variable is not wired`);

  const eas = JSON.parse(read(`${app.path}/eas.json`));
  assert(eas.build?.["production-apk"]?.android?.buildType === "apk", `${app.name}: production-apk profile must output APK`);
  assert(eas.build?.["production-aab"]?.android?.buildType === "app-bundle", `${app.name}: production-aab profile must output AAB`);
  console.log(`PASS ${app.name}: local ${width}x${height} PNG; app icon, adaptive icon, splash and APK/AAB profiles`);
}

const androidWorkflow = read(".github/workflows/android-four-app-build.yml");
for (const variable of [
  "SKIMA_REFILL_EAS_PROJECT_ID",
  "SKIMA_STORE_EAS_PROJECT_ID",
  "SKIMA_BILLS_EAS_PROJECT_ID",
  "SKIMA_LOGISTICS_EAS_PROJECT_ID",
]) {
  assert(androidWorkflow.includes(variable), `Android build workflow has no ${variable} mapping`);
}
console.log("PASS all four EAS project-ID mappings are present; this verifier does not start Android builds");
