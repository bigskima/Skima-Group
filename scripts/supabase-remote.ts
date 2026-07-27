import { resolveProjectRef } from "./supabase-runtime.ts";

const COMMANDS = ["link", "db-push", "db-reset-linked", "functions-deploy", "status"] as const;

type CommandName = (typeof COMMANDS)[number];

const command = Deno.args[0] as CommandName | undefined;

if (!command || !COMMANDS.includes(command)) {
  printUsage();
  Deno.exit(1);
}

if (command === "link") {
  await linkProject();
} else if (command === "db-push") {
  await pushDatabase();
} else if (command === "db-reset-linked") {
  await resetLinkedDatabase();
} else if (command === "functions-deploy") {
  await deployFunctions();
} else if (command === "status") {
  await remoteStatus();
}

async function linkProject(): Promise<void> {
  const projectRef = requireEnv("SUPABASE_PROJECT_REF");
  const args = [
    "link",
    "--project-ref",
    projectRef,
    "--yes",
  ];

  appendPassword(args);

  await runSupabase(args);
}

async function pushDatabase(): Promise<void> {
  const args = [
    "db",
    "push",
    "--linked",
    "--yes",
  ];

  appendPassword(args);

  await runSupabase(args);
}

async function resetLinkedDatabase(): Promise<void> {
  const allowReset = Deno.env.get("SKIMA_ALLOW_REMOTE_DB_RESET");

  if (allowReset !== "true") {
    throw new Error(
      "SKIMA_ALLOW_REMOTE_DB_RESET=true is required before resetting the linked hosted database.",
    );
  }

  await runSupabase([
    "db",
    "reset",
    "--linked",
    "--yes",
  ]);
}

async function deployFunctions(): Promise<void> {
  const projectRef = await resolveProjectRef();

  await runSupabase([
    "functions",
    "deploy",
    "health",
    "--project-ref",
    projectRef,
    "--use-api",
    "--no-verify-jwt",
  ]);

  await runSupabase([
    "functions",
    "deploy",
    "api-gateway",
    "--project-ref",
    projectRef,
    "--use-api",
  ]);
}

async function remoteStatus(): Promise<void> {
  const projectRef = await resolveProjectRef();

  console.log(`Checking Supabase CLI access for project ${projectRef}...`);
  await runSupabase(["projects", "list"]);
}

async function runSupabase(args: readonly string[]): Promise<void> {
  const process = new Deno.Command("supabase", {
    args: [...args],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();

  const status = await process.status;

  if (!status.success) {
    Deno.exit(status.code);
  }
}

function appendPassword(args: string[]): void {
  const dbPassword = Deno.env.get("SUPABASE_DB_PASSWORD");

  if (dbPassword) {
    args.push("--password", dbPassword);
  }
}

function requireEnv(key: string): string {
  const value = Deno.env.get(key);

  if (!value) {
    throw new Error(`${key} is required in the deployment shell or CI secret store.`);
  }

  return value;
}

function printUsage(): void {
  console.error(
    `Usage: deno run --allow-env --allow-run scripts/supabase-remote.ts <command>

Commands:
  link              Link this repo to the hosted Supabase dev project
  db-push           Push migrations to the linked hosted dev project
  db-reset-linked   Reset the linked hosted dev database with the local migrations
  functions-deploy  Deploy health and api-gateway with server-side bundling
  status            Check CLI project access
`,
  );
}
