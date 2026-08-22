import { spawnSync } from "node:child_process";

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
const previousCandidates = [
  process.env.VERCEL_GIT_PREVIOUS_SHA,
  "HEAD^",
].filter(Boolean);

const commitExists = (ref) => spawnSync(
  "git",
  ["cat-file", "-e", `${ref}^{commit}`],
  { cwd: repoRoot, stdio: "ignore" },
).status === 0;

if (!commitExists(current)) {
  process.exit(1);
}

const previous = previousCandidates.find(commitExists);
if (!previous) {
  // First deployment or unusually shallow clone: build once rather than risk
  // skipping a project that has never produced this commit.
  process.exit(1);
}

const topLevelPathspecs = relevantPaths.map((path) => `:(top)${path}`);
const diff = spawnSync(
  "git",
  ["diff", "--quiet", previous, current, "--", ...topLevelPathspecs],
  { cwd: repoRoot, stdio: "ignore" },
);

if (diff.status === 0) {
  process.exit(0);
}

// Exit 1 means a relevant file changed and Vercel should build. Unexpected Git
// failures deliberately fail open to a build instead of hiding a real change.
process.exit(1);
