interface MigrationHistoryPolicy {
  readonly schemaVersion: number;
  readonly reconciledAt: string;
  readonly reconciledLiveHead: string;
  readonly expectedMigrationCount: number;
  readonly migrationTreeSha: string;
  readonly notes?: string;
}

const migrationsDirectory = "supabase/migrations";
const policyPath = "supabase/migration-history-policy.json";
const filenamePattern = /^(\d{14})_([a-z][a-z0-9_]*)\.sql$/;

const policy = JSON.parse(
  await Deno.readTextFile(policyPath),
) as MigrationHistoryPolicy;

assert(policy.schemaVersion === 1, "Unsupported migration history policy version.");
assert(
  Number.isInteger(policy.expectedMigrationCount) && policy.expectedMigrationCount > 0,
  "Migration history policy must define a positive expectedMigrationCount.",
);
assert(
  /^[0-9a-f]{40}$/.test(policy.migrationTreeSha),
  "Migration history policy must contain a Git tree SHA.",
);
assert(
  filenamePattern.test(policy.reconciledLiveHead),
  "Migration history policy must contain a valid reconciledLiveHead filename.",
);

const migrationFiles: string[] = [];
for await (const entry of Deno.readDir(migrationsDirectory)) {
  if (entry.isFile && entry.name.endsWith(".sql")) migrationFiles.push(entry.name);
}
migrationFiles.sort();

assert(
  migrationFiles.length === policy.expectedMigrationCount,
  `Migration count changed: expected ${policy.expectedMigrationCount}, found ${migrationFiles.length}. Reconcile repository migrations against live Supabase before updating the policy.`,
);
assert(
  migrationFiles.at(-1) === policy.reconciledLiveHead,
  `Migration head changed: expected ${policy.reconciledLiveHead}, found ${migrationFiles.at(-1) ?? "none"}. Reconcile against live Supabase before updating the policy.`,
);

const seenVersions = new Set<string>();
const seenNames = new Set<string>();
for (const filename of migrationFiles) {
  const match = filename.match(filenamePattern);
  assert(match, `Invalid migration filename: ${filename}. Expected YYYYMMDDHHMMSS_descriptive_name.sql.`);
  const [, version, name] = match;
  assert(!seenVersions.has(version), `Duplicate migration version detected: ${version}.`);
  assert(!seenNames.has(name), `Duplicate migration name detected: ${name}.`);
  seenVersions.add(version);
  seenNames.add(name);

  const contents = await Deno.readTextFile(`${migrationsDirectory}/${filename}`);
  assert(contents.trim().length > 0, `Migration is empty: ${filename}.`);
  assert(!contents.includes("<<<<<<<") && !contents.includes(">>>>>>>") && !contents.includes("======="), `Migration contains unresolved merge markers: ${filename}.`);
}

const treeSha = await readGitTreeSha(migrationsDirectory);
assert(
  treeSha === policy.migrationTreeSha,
  `Migration SQL history changed (expected tree ${policy.migrationTreeSha}, found ${treeSha}). Do not mutate, rename, remove, or add migrations silently. Reconcile the repository against live Supabase first, then deliberately update migration-history-policy.json.`,
);

console.log(
  `Migration history verified: ${migrationFiles.length} migrations, live-reconciled head ${policy.reconciledLiveHead}, tree ${treeSha}.`,
);

async function readGitTreeSha(path: string) {
  const command = new Deno.Command("git", {
    args: ["rev-parse", `HEAD:${path}`],
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  if (!result.success) {
    const message = new TextDecoder().decode(result.stderr).trim();
    throw new Error(`Could not read Git tree SHA for ${path}: ${message || "git rev-parse failed"}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
