import { spawnSync } from "node:child_process";

const target = process.argv[2];
const relevantPaths = target === "admin"
  ? [
      "apps/admin",
      "packages/frontend-core",
      "packages/ui",
      "scripts",
      "package.json",
      "vercel.admin.json",
    ]
  : target === "lpg"
    ? [
        "apps/lpg-mobile",
        "packages/frontend-core",
        "packages/ui",
        "scripts",
        "package.json",
        "vercel.json",
      ]
    : null;

// Vercel treats exit 0 as "skip this build" and exit 1 as "build it".
// Always fail open to a build if Git history is shallow or unavailable; never
// let an unavailable previous SHA turn into a failed deployment.
if (!relevantPaths) process.exit(1);

const current = process.env.VERCEL_GIT_COMMIT_SHA || "HEAD";
const previous = process.env.VERCEL_GIT_PREVIOUS_SHA || "HEAD^";

const previousExists = spawnSync(
  "git",
  ["cat-file", "-e", `${previous}^{commit}`],
  { stdio: "ignore" },
);
const currentExists = spawnSync(
  "git",
  ["cat-file", "-e", `${current}^{commit}`],
  { stdio: "ignore" },
);

if (previousExists.status !== 0 || currentExists.status !== 0) {
  process.exit(1);
}

const diff = spawnSync(
  "git",
  ["diff", "--quiet", previous, current, "--", ...relevantPaths],
  { stdio: "ignore" },
);

if (diff.status === 0) {
  process.exit(0);
}

// A normal diff exits 1 when relevant files changed. Any unexpected git error
// also deliberately resolves to 1 so Vercel builds instead of failing here.
process.exit(1);
