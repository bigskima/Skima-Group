import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apps = [
  { name: "Refill", path: "apps/lpg-mobile", native: true, projectIdEnv: "EXPO_PUBLIC_EAS_PROJECT_ID" },
  { name: "Bills", path: "apps/bills-mobile", native: false },
  { name: "Store", path: "apps/store-mobile", native: false },
  { name: "Logistics", path: "apps/logistics-mobile", native: true, projectIdEnv: "EXPO_PUBLIC_LOGISTICS_EAS_PROJECT_ID" },
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
  assert(/image\s*:\s*brandImage/.test(config), `${app.name}: native/web splash image is not configured`);

  if (app.native) {
    assert(/foregroundImage\s*:\s*brandImage/.test(config), `${app.name}: Android adaptive icon is not configured`);
    assert(config.includes(`process.env.${app.projectIdEnv}`), `${app.name}: dedicated native EAS project ID variable is not wired`);
    const eas = JSON.parse(read(`${app.path}/eas.json`));
    assert(eas.build?.["production-apk"]?.android?.buildType === "apk", `${app.name}: production-apk profile must output APK`);
    assert(eas.build?.["production-aab"]?.android?.buildType === "app-bundle", `${app.name}: production-aab profile must output AAB`);
    console.log(`PASS ${app.name}: native ${width}x${height} PNG; icon, splash, EAS project ID and APK/AAB profiles`);
  } else {
    console.log(`PASS ${app.name}: web-product ${width}x${height} PNG and app branding retained; no Android release target`);
  }
}

const androidWorkflow = read(".github/workflows/android-four-app-build.yml");
for (const variable of [
  "SKIMA_REFILL_EAS_PROJECT_ID",
  "SKIMA_LOGISTICS_EAS_PROJECT_ID",
]) {
  assert(androidWorkflow.includes(variable), `Two-app Android build workflow has no ${variable} mapping`);
}
for (const variable of ["SKIMA_STORE_EAS_PROJECT_ID", "SKIMA_BILLS_EAS_PROJECT_ID"]) {
  assert(!androidWorkflow.includes(variable), `Web-only module must not be an Android build target: ${variable}`);
}
assert(androidWorkflow.includes('["lpg-mobile","logistics-mobile"]'), "Android build workflow must only target Refill and Logistics");
console.log("PASS two native Android app targets; Bills and Store remain complete web products");
