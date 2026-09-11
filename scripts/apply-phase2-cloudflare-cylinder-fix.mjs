import { readFile, writeFile } from "node:fs/promises";

function replaceExact(source, before, after, label) {
  if (!source.includes(before)) throw new Error("Phase 2 patch could not find " + label);
  return source.replace(before, after);
}

const workerPath = "supabase/functions/runtime-worker/index.ts";
let worker = await readFile(workerPath, "utf8");
worker = replaceExact(
  worker,
  `      body: JSON.stringify({\n        prompt,\n        seed: Math.floor(Math.random() * 2_147_483_647),\n        steps: readIntegerEnv("CLOUDFLARE_AI_STEPS", 8, 1, 8),\n      }),`,
  `      body: JSON.stringify({\n        prompt,\n        steps: readIntegerEnv("CLOUDFLARE_AI_STEPS", 8, 1, 8),\n      }),`,
  "Cloudflare FLUX request body",
);
await writeFile(workerPath, worker);

const contractPath = "scripts/ai-runtime-contract.test.ts";
let contract = await readFile(contractPath, "utf8");
const marker = `Deno.test("existing cylinder and driver image AI uses configured capability routes", () => {`;
if (!contract.includes(marker)) throw new Error("Phase 2 patch could not find AI contract insertion point");
const test = `Deno.test("Cloudflare cylinder image requests stay within the current Workers AI schema", () => {\n  assertIncludes(\n    workerSource,\n    'steps: readIntegerEnv("CLOUDFLARE_AI_STEPS", 8, 1, 8)',\n    "Cloudflare image requests must retain bounded inference steps",\n  );\n  assertNotIncludes(\n    workerSource,\n    "seed: Math.floor(Math.random() * 2_147_483_647)",\n    "the current FLUX schema rejects the legacy seed field",\n  );\n  assertIncludes(\n    workerSource,\n    'resolveImageProvider(supabase, "ai.lpg.cylinder.presentation")',\n    "cylinder generation must continue through the configured provider route",\n  );\n});\n\n`;
contract = contract.replace(marker, test + marker);
await writeFile(contractPath, contract);

console.log("Phase 2 Cloudflare cylinder generation fix applied.");
