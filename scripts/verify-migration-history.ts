const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const policyPath = new URL("../supabase/migration-history-policy.json", import.meta.url);
const migrationFilePattern = /^(\d{14})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

interface MigrationHistoryPolicy {
  schemaVersion: number;
  remoteHeadVersion: string;
  requiredRestoredMigration: string;
  pendingPermissionMigration: string | null;
  staleAliases: Record<string, string>;
  businessModuleMigrations: string[];
}

const errors: string[] = [];
const migrationFiles: string[] = [];

for await (const entry of Deno.readDir(migrationsDirectory)) {
  if (entry.isFile && entry.name.endsWith(".sql")) {
    migrationFiles.push(entry.name);
  }
}

migrationFiles.sort();

const migrationFileSet = new Set(migrationFiles);
const versions = new Map<string, string>();

for (const migrationFile of migrationFiles) {
  const match = migrationFilePattern.exec(migrationFile);

  if (!match) {
    errors.push(
      `${migrationFile} must match the 14-digit Supabase migration filename convention.`,
    );
    continue;
  }

  const version = match[1];
  const existingMigration = versions.get(version);

  if (existingMigration) {
    errors.push(
      `Migration version ${version} is duplicated by ${existingMigration} and ${migrationFile}.`,
    );
  } else {
    versions.set(version, migrationFile);
  }

  const migrationSource = await Deno.readTextFile(
    new URL(migrationFile, migrationsDirectory),
  );
  validateSqlDollarQuotes(migrationFile, migrationSource);
}

const policy = await readPolicy();

if (policy) {
  validatePolicyFileName(policy.requiredRestoredMigration, "requiredRestoredMigration");

  if (policy.pendingPermissionMigration) {
    validatePolicyFileName(policy.pendingPermissionMigration, "pendingPermissionMigration");
  }

  const canonicalTargets = Object.values(policy.staleAliases);

  requireUnique(Object.keys(policy.staleAliases), "stale migration alias");
  requireUnique(canonicalTargets, "canonical migration target");
  requireUnique(policy.businessModuleMigrations, "business-module migration");

  for (const [staleAlias, canonicalTarget] of Object.entries(policy.staleAliases)) {
    validatePolicyFileName(staleAlias, `stale alias ${staleAlias}`);
    validatePolicyFileName(canonicalTarget, `canonical target for ${staleAlias}`);

    if (migrationFileSet.has(staleAlias)) {
      errors.push(
        `Stale migration alias ${staleAlias} must be removed; use ${canonicalTarget}.`,
      );
    }

    if (!migrationFileSet.has(canonicalTarget)) {
      errors.push(
        `Canonical migration ${canonicalTarget} is required for stale alias ${staleAlias}.`,
      );
    }
  }

  requireMigration(policy.requiredRestoredMigration, "restored remote migration");

  if (policy.pendingPermissionMigration) {
    requireMigration(policy.pendingPermissionMigration, "pending permission migration");
  }

  for (const businessModuleMigration of policy.businessModuleMigrations) {
    validatePolicyFileName(businessModuleMigration, "businessModuleMigrations entry");
    requireMigration(businessModuleMigration, "configured business-module migration");
  }

  if (!/^\d{14}$/.test(policy.remoteHeadVersion)) {
    errors.push("remoteHeadVersion must be a 14-digit Supabase migration version.");
  }

  const remoteHeadMigration = migrationFiles.find((migrationFile) =>
    migrationFile.startsWith(`${policy.remoteHeadVersion}_`)
  );

  if (/^\d{14}$/.test(policy.remoteHeadVersion) && !remoteHeadMigration) {
    errors.push(
      `Remote head ${policy.remoteHeadVersion} must exist in the repository migration history.`,
    );
  }

  const pendingPermissionVersion = policy.pendingPermissionMigration
    ? migrationFilePattern.exec(policy.pendingPermissionMigration)?.[1]
    : undefined;

  if (
    pendingPermissionVersion &&
    /^\d{14}$/.test(policy.remoteHeadVersion) &&
    pendingPermissionVersion <= policy.remoteHeadVersion
  ) {
    errors.push(
      `Pending permission migration ${pendingPermissionVersion} must be later than remote head ${policy.remoteHeadVersion}.`,
    );
  }
}

if (errors.length > 0) {
  console.error("Migration history validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  Deno.exit(1);
}

console.log(
  `Migration history validation passed for ${migrationFiles.length} migrations through remote head ${policy?.remoteHeadVersion}.`,
);

async function readPolicy(): Promise<MigrationHistoryPolicy | undefined> {
  let parsedPolicy: unknown;

  try {
    parsedPolicy = JSON.parse(await Deno.readTextFile(policyPath));
  } catch (error) {
    errors.push(`Migration history policy could not be read: ${errorMessage(error)}.`);
    return undefined;
  }

  if (!isRecord(parsedPolicy)) {
    errors.push("Migration history policy must be a JSON object.");
    return undefined;
  }

  const schemaVersion = parsedPolicy.schemaVersion;
  const remoteHeadVersion = parsedPolicy.remoteHeadVersion;
  const requiredRestoredMigration = parsedPolicy.requiredRestoredMigration;
  const pendingPermissionMigration = parsedPolicy.pendingPermissionMigration;
  const staleAliases = parsedPolicy.staleAliases;
  const businessModuleMigrations = parsedPolicy.businessModuleMigrations;

  if (schemaVersion !== 1) {
    errors.push("Migration history policy schemaVersion must be 1.");
  }
  if (typeof remoteHeadVersion !== "string") {
    errors.push("Migration history policy remoteHeadVersion must be a string.");
  }
  if (typeof requiredRestoredMigration !== "string") {
    errors.push("Migration history policy requiredRestoredMigration must be a string.");
  }
  if (pendingPermissionMigration !== null && typeof pendingPermissionMigration !== "string") {
    errors.push("Migration history policy pendingPermissionMigration must be a string or null.");
  }
  if (!isStringRecord(staleAliases)) {
    errors.push("Migration history policy staleAliases must map filenames to filenames.");
  }
  if (!isStringArray(businessModuleMigrations)) {
    errors.push("Migration history policy businessModuleMigrations must be a string array.");
  }

  if (
    schemaVersion !== 1 ||
    typeof remoteHeadVersion !== "string" ||
    typeof requiredRestoredMigration !== "string" ||
    (pendingPermissionMigration !== null && typeof pendingPermissionMigration !== "string") ||
    !isStringRecord(staleAliases) ||
    !isStringArray(businessModuleMigrations)
  ) {
    return undefined;
  }

  return {
    schemaVersion,
    remoteHeadVersion,
    requiredRestoredMigration,
    pendingPermissionMigration,
    staleAliases,
    businessModuleMigrations,
  };
}

function validateSqlDollarQuotes(migrationFile: string, source: string): void {
  const lines = source.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^\s*as\s+\$\s*$/i.test(line)) {
      errors.push(
        `${migrationFile}:${index + 1} uses malformed PL/pgSQL opener "as $"; use a complete dollar quote such as "as $".`,
      );
    }

    if (/^\s*\$;\s*$/.test(line)) {
      errors.push(
        `${migrationFile}:${index + 1} uses malformed PL/pgSQL closer "$;"; use "$;".`,
      );
    }
  }

  const plainDollarQuoteCount = source.match(/\$\$/g)?.length ?? 0;
  if (plainDollarQuoteCount % 2 !== 0) {
    errors.push(
      `${migrationFile} has an odd number of "$" dollar-quote tokens (${plainDollarQuoteCount}).`,
    );
  }
}

function requireMigration(migrationFile: string, description: string): void {
  if (!migrationFileSet.has(migrationFile)) {
    errors.push(`Missing ${description}: ${migrationFile}.`);
  }
}

function validatePolicyFileName(migrationFile: string, field: string): void {
  if (!migrationFilePattern.test(migrationFile)) {
    errors.push(`${field} must contain a valid migration filename: ${migrationFile}.`);
  }
}

function requireUnique(values: string[], description: string): void {
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      errors.push(`Duplicate ${description}: ${value}.`);
    }
    seen.add(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
