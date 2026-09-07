import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptPath = fileURLToPath(new URL("./vercel-ignore.mjs", import.meta.url));
const cwd = mkdtempSync(join(tmpdir(), "skima-vercel-ignore-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function write(path, value) {
  const fullPath = join(cwd, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, value);
}

function commit(message) {
  run("git", ["add", "."]);
  run("git", ["commit", "-m", message]);
  return run("git", ["rev-parse", "HEAD"]);
}

function ignoreStatus(target, { current, previous, ref }) {
  const env = {
    ...process.env,
    VERCEL_GIT_COMMIT_SHA: current,
    VERCEL_GIT_COMMIT_REF: ref,
  };
  if (previous) env.VERCEL_GIT_PREVIOUS_SHA = previous;
  else delete env.VERCEL_GIT_PREVIOUS_SHA;

  return spawnSync(process.execPath, [scriptPath, target], {
    cwd,
    env,
    stdio: "ignore",
  }).status;
}

try {
  run("git", ["init", "-b", "main"]);
  run("git", ["config", "user.email", "tests@skima.local"]);
  run("git", ["config", "user.name", "SKIMA Tests"]);

  write("apps/lpg-mobile/auth.txt", "base\n");
  write("apps/admin/admin.txt", "base\n");
  write("package.json", "{}\n");
  const base = commit("base");

  run("git", ["checkout", "-b", "feature/auth"]);
  write("apps/lpg-mobile/auth.txt", "feature\n");
  const feature = commit("auth feature");

  assert.equal(
    ignoreStatus("lpg", { current: feature, previous: base, ref: "feature/auth" }),
    1,
    "LPG preview must build when LPG files change",
  );
  assert.equal(
    ignoreStatus("admin", { current: feature, previous: base, ref: "feature/auth" }),
    0,
    "Admin preview must skip an LPG-only change",
  );

  run("git", ["checkout", "main"]);
  run("git", ["merge", "--no-ff", "feature/auth", "-m", "merge auth feature"]);
  const merge = run("git", ["rev-parse", "HEAD"]);

  assert.equal(
    ignoreStatus("lpg", { current: merge, previous: feature, ref: "main" }),
    1,
    "Main must compare a merge with its first parent, not the PR head tree",
  );
  assert.equal(
    ignoreStatus("admin", { current: merge, previous: feature, ref: "main" }),
    0,
    "Main must still skip unrelated project builds",
  );

  write("apps/admin/admin.txt", "admin-only\n");
  const adminOnly = commit("admin only");

  assert.equal(
    ignoreStatus("lpg", { current: adminOnly, previous: feature, ref: "main" }),
    0,
    "LPG production must skip an admin-only main commit",
  );
  assert.equal(
    ignoreStatus("admin", { current: adminOnly, previous: feature, ref: "main" }),
    1,
    "Admin production must build for an admin-only main commit",
  );

  assert.equal(
    ignoreStatus("lpg", { current: feature, previous: null, ref: "feature/auth" }),
    1,
    "Missing previous SHA must fail open to a build",
  );

  console.log("Vercel ignore behavior verified.");
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
