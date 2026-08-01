export interface SupabaseRuntimeRequirements {
  readonly anonKey?: boolean;
  readonly serviceRoleKey?: boolean;
}

export interface SupabaseRuntime {
  readonly projectRef: string;
  readonly supabaseUrl: string;
  readonly anonKey?: string;
  readonly serviceRoleKey?: string;
}

interface SupabaseApiKey {
  readonly name?: string;
  readonly api_key?: string;
}

let localEnvLoaded = false;

export async function loadLocalDeploymentEnv(): Promise<void> {
  if (localEnvLoaded) {
    return;
  }

  localEnvLoaded = true;

  const originalKeys = new Set(Object.keys(Deno.env.toObject()));

  for (const path of [".env", ".env.local"]) {
    const contents = await readOptionalTextFile(path);

    if (!contents) {
      continue;
    }

    for (const [key, value] of parseEnvFile(contents)) {
      if (originalKeys.has(key)) {
        continue;
      }

      Deno.env.set(key, value);
    }
  }
}

export async function resolveSupabaseRuntime(
  requirements: SupabaseRuntimeRequirements,
): Promise<SupabaseRuntime> {
  await loadLocalDeploymentEnv();

  const projectRef = await resolveProjectRef();
  const supabaseUrl = trimTrailingSlash(
    Deno.env.get("SUPABASE_URL") ?? `https://${projectRef}.supabase.co`,
  );

  let anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  let serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if ((requirements.anonKey && !anonKey) || (requirements.serviceRoleKey && !serviceRoleKey)) {
    const apiKeys = await listProjectApiKeys(projectRef);

    anonKey ??= findApiKey(apiKeys, "anon");
    serviceRoleKey ??= findApiKey(apiKeys, "service_role");
  }

  if (requirements.anonKey && !anonKey) {
    throw new Error("SUPABASE_ANON_KEY was not found in env or Supabase CLI project API keys.");
  }

  if (requirements.serviceRoleKey && !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY was not found in env or Supabase CLI project API keys.",
    );
  }

  return {
    projectRef,
    supabaseUrl,
    anonKey,
    serviceRoleKey,
  };
}

export async function resolveProjectRef(): Promise<string> {
  await loadLocalDeploymentEnv();

  const envProjectRef = Deno.env.get("SUPABASE_PROJECT_REF");

  if (envProjectRef) {
    return envProjectRef;
  }

  try {
    const linkedProjectRef = (await Deno.readTextFile("supabase/.temp/project-ref")).trim();

    if (linkedProjectRef) {
      return linkedProjectRef;
    }
  } catch (_error) {
    // Fall through to the deployment-oriented error below.
  }

  throw new Error(
    "SUPABASE_PROJECT_REF is required, or this workspace must be linked with supabase link.",
  );
}

async function readOptionalTextFile(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound || error instanceof Deno.errors.PermissionDenied) {
      return null;
    }

    throw error;
  }
}

function parseEnvFile(contents: string): ReadonlyArray<readonly [string, string]> {
  const entries: Array<readonly [string, string]> = [];

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equalsIndex = normalizedLine.indexOf("=");

    if (equalsIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, equalsIndex).trim();
    const rawValue = normalizedLine.slice(equalsIndex + 1).trim();

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    entries.push([key, parseEnvValue(rawValue)]);
  }

  return entries;
}

function parseEnvValue(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];

  if ((first === `"` && last === `"`) || (first === "'" && last === "'")) {
    const unquoted = value.slice(1, -1);

    if (first === `"`) {
      return unquoted
        .replaceAll("\\n", "\n")
        .replaceAll("\\r", "\r")
        .replaceAll("\\t", "\t")
        .replaceAll(`\\"`, `"`)
        .replaceAll("\\\\", "\\");
    }

    return unquoted;
  }

  const hashIndex = value.indexOf(" #");

  if (hashIndex >= 0) {
    return value.slice(0, hashIndex).trimEnd();
  }

  return value;
}

async function listProjectApiKeys(projectRef: string): Promise<readonly SupabaseApiKey[]> {
  const command = new Deno.Command("supabase", {
    args: ["projects", "api-keys", "--project-ref", projectRef, "-o", "json"],
    stdout: "piped",
    stderr: "piped",
  });

  const output = await command.output();

  if (!output.success) {
    const message = new TextDecoder().decode(output.stderr).trim();
    throw new Error(`Unable to read Supabase project API keys. ${message}`);
  }

  const stdout = new TextDecoder().decode(output.stdout).trim();
  const parsed = JSON.parse(stdout);

  if (!Array.isArray(parsed)) {
    throw new Error("Supabase CLI returned an unexpected API key response.");
  }

  return parsed as SupabaseApiKey[];
}

function findApiKey(apiKeys: readonly SupabaseApiKey[], name: string): string | undefined {
  return apiKeys.find((apiKey) => apiKey.name === name)?.api_key;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
