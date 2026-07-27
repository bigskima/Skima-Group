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

export async function resolveSupabaseRuntime(
  requirements: SupabaseRuntimeRequirements,
): Promise<SupabaseRuntime> {
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
