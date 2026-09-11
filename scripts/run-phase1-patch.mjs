import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const target = "scripts/apply-phase1-verification-dark-mode.mjs";
let source = await readFile(target, "utf8");

source = source.replace(
  '      idempotencyKey: `${input.idempotencyKey}:workflow-recovery`,',
  '      idempotencyKey: input.idempotencyKey + ":workflow-recovery",',
);
source = source.replace(
  '    if (nested) return `${field}: ${nested}`.slice(0, 500);',
  '    if (nested) return (field + ": " + nested).slice(0, 500);',
);

await writeFile(target, source);
await import(`${pathToFileURL(target).href}?run=${Date.now()}`);
