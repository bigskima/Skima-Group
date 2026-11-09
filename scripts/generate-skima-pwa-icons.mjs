import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const appRoot = resolve(process.cwd());
const requireFromApp = createRequire(resolve(appRoot, "package.json"));
const imageUtils = requireFromApp("@expo/image-utils");
const generateImageAsync = imageUtils.generateImageAsync ?? imageUtils.default?.generateImageAsync;
if (typeof generateImageAsync !== "function") {
  throw new Error("Expo image utilities are unavailable. Install this app's Expo dependencies before exporting the web app.");
}

const sourcePath = resolve(appRoot, "assets/skima-splash-logo.png");
if (!existsSync(sourcePath)) {
  throw new Error(`SKIMA logo source image is missing: ${sourcePath}`);
}
const outputDirectory = resolve(appRoot, "public/icons");
await mkdir(outputDirectory, { recursive: true });
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

for (const size of [180, 192, 512]) {
  const filename = `skima-app-icon-${size}.png`;
  const { source } = await generateImageAsync(
    { projectRoot: appRoot },
    {
      src: sourcePath,
      name: filename,
      width: size,
      height: size,
      resizeMode: "contain",
      backgroundColor: "#FFFFFF",
      removeTransparency: true,
    },
  );
  if (!source.subarray(0, 8).equals(pngSignature) || source.readUInt32BE(16) !== size || source.readUInt32BE(20) !== size) {
    throw new Error(`Generated ${filename} is not a valid ${size}x${size} PNG.`);
  }
  await writeFile(resolve(outputDirectory, filename), source);
  console.log(`Generated and verified ${filename} from the approved SKIMA logo.`);
}
