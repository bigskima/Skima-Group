import { spawnSync } from "node:child_process";
import process from "node:process";

const target = process.argv[2];
const relevantPaths = target === "admin"
  ? [
      "apps/admin",
      "packages/frontend-core",
      "packages/ui",
      "package.json",
      "package-lock.json",
      "scripts/vercel-ignore.mjs",
    ]
  : target === "lpg"
    ? [
        "apps/lpg-mobile",
        "packages/frontend-core",
        "packages/ui",
        "package.json",
        "scripts/vercel-ignore.mjs",
        "vercel.json",
      ]
    : null;

// Vercel treats exit 0 as "skip this build" and exit 1 as "build it".
// Each SKIMA Vercel project calls this script independently. The path list is
// intentionally project-specific so an Admin-only commit does not consume an
// LPG build, and an LPG-only commit does not consume an Admin build.
if (!relevantPaths) process.exit(1);

const repoRootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
});
if (repoRootResult.status !== 0 || !repoRootResult.stdout?.trim()) {
  process.exit(1);
}
const repoRoot = repoRootResult.stdout.trim();

const current = process.env.VERCEL_GIT_COMMIT_SHA || "HEAD";
const previous = process.env.VERCEL_GIT_PREVIOUS_SHA?.trim();
const commitRef = process.env.VERCEL_GIT_COMMIT_REF?.trim();

const commitExists = (ref) => spawnSync(
  "git",
  ["cat-file", "-e", `${ref}^{commit}`],
  { cwd: repoRoot, stdio: "ignore" },
).status === 0;

if (!commitExists(current)) {
  process.exit(1);
}

let comparisonBase = previous;

// On the production branch, compare the new commit with its first parent
// (the previous main commit). Vercel can otherwise supply a PR-head SHA as
// VERCEL_GIT_PREVIOUS_SHA for a merge commit. A merge commit often has the
// same tree as that PR head, which would incorrectly skip the production
// deployment even though main just gained relevant changes.
if (commitRef === "main") {
  const firstParent = `${current}^1`;
  if (commitExists(firstParent)) comparisonBase = firstParent;
}

if (!comparisonBase || !commitExists(comparisonBase)) {
  // First deployment, manual redeploy, or unusually shallow clone: build once.
  // Failing open is safer than hiding a real production change.
  process.exit(1);
}

const topLevelPathspecs = relevantPaths.map((path) => `:(top)${path}`);
const diff = spawnSync(
  "git",
  ["diff", "--quiet", comparisonBase, current, "--", ...topLevelPathspecs],
  { cwd: repoRoot, stdio: "ignore" },
);

if (diff.status === 0) {
  process.exit(0);
}

// Exit 1 means a relevant file changed and Vercel should build. Unexpected Git
// failures deliberately fail open to a build instead of hiding a real change.
process.exit(1);
