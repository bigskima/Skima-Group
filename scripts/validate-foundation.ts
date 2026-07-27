const migrationsDirectory = "supabase/migrations";

const migrationFiles = [];

for await (const entry of Deno.readDir(migrationsDirectory)) {
  if (entry.isFile && entry.name.endsWith(".sql")) {
    migrationFiles.push(`${migrationsDirectory}/${entry.name}`);
  }
}

migrationFiles.sort();

const sql = (await Promise.all(migrationFiles.map((path) => Deno.readTextFile(path)))).join("\n");
const normalizedSql = sql.replace(/\s+/g, " ").toLowerCase();

const tables = Array.from(sql.matchAll(/create table if not exists public\.([a-z_]+)/gi))
  .map((match) => match[1])
  .sort();

requireCondition(tables.length >= 30, "Foundation migration must create the platform tables.");
requireCondition(
  tables.includes("platform_admins"),
  "Foundation must include platform admin governance.",
);
requireCondition(
  tables.includes("platform_admin_role_templates"),
  "Foundation must include configurable platform admin role templates.",
);

for (const table of tables) {
  requireMatch(
    normalizedSql,
    new RegExp(`alter table public\\.${table} enable row level security`),
    `${table} must enable row level security.`,
  );

  requireMatch(
    normalizedSql,
    new RegExp(`create policy [^;]+ on public\\.${table}`),
    `${table} must declare at least one row level security policy.`,
  );
}

requireMatch(
  normalizedSql,
  /revoke all on function public\.bootstrap_platform_admin\(uuid\) from authenticated/,
  "Platform admin bootstrap must not be callable by authenticated clients.",
);

requireMatch(
  normalizedSql,
  /grant execute on function public\.bootstrap_platform_admin\(uuid\) to service_role/,
  "Platform admin bootstrap must be service-role-only.",
);

requireMatch(
  normalizedSql,
  /grant execute on function public\.bootstrap_platform_super_admin\(uuid\) to service_role/,
  "Platform super admin bootstrap must be service-role-only.",
);

requireMatch(
  normalizedSql,
  /create unique index if not exists platform_admins_one_active_super_admin/,
  "Platform must allow only one active super admin.",
);

requireMatch(
  normalizedSql,
  /create or replace function public\.configure_platform_admin/,
  "Platform admin role configuration function must exist.",
);

requireMatch(
  normalizedSql,
  /create or replace function public\.configure_platform_admin_role/,
  "Platform admin role templates must be configurable through the database.",
);

requireMatch(
  normalizedSql,
  /platform\.support_admin/,
  "Foundation must seed support admin as a configurable admin role template.",
);

const requiredEngineTables = [
  "currency_definitions",
  "pricing_policies",
  "settlement_policies",
  "wallet_accounts",
  "wallet_account_events",
  "financial_transactions",
  "wallet_ledger_entries",
  "escrow_holds",
  "workflow_instances",
  "workflow_instance_events",
  "event_handlers",
  "verification_definitions",
  "verification_events",
  "dispatch_policies",
  "dispatch_requests",
  "dispatch_request_events",
  "dispatch_candidates",
  "tracking_sessions",
  "tracking_session_events",
  "tracking_points",
  "notification_templates",
  "notification_messages",
  "notification_message_events",
  "ai_task_definitions",
  "ai_task_runs",
  "ai_task_run_events",
  "map_service_requests",
] as const;

for (const table of requiredEngineTables) {
  requireCondition(tables.includes(table), `Milestone 2 engine table is missing: ${table}.`);
}

requireMatch(
  normalizedSql,
  /'ngn', 'nigerian naira'/,
  "Phase One must seed NGN currency.",
);

requireMatch(
  normalizedSql,
  /wallet ledger entries are append-only/,
  "Wallet ledger entries must be append-only.",
);

requireMatch(
  normalizedSql,
  /create or replace view public\.wallet_balances/,
  "Wallet balances must be derived from ledger entries.",
);

requireMatch(
  normalizedSql,
  /create or replace function public\.post_financial_transaction/,
  "Financial movement must go through the reusable posting engine.",
);

requireMatch(
  normalizedSql,
  /financial transaction ledger entries must balance/,
  "Financial posting engine must reject unbalanced ledger entries.",
);

requireMatch(
  normalizedSql,
  /target_idempotency_key is required/,
  "Financial posting engine must require idempotency keys.",
);

requireMatch(
  normalizedSql,
  /drop policy if exists financial_transactions_manage_privileged/,
  "Financial transaction direct privileged mutation policy must be removed.",
);

requireMatch(
  normalizedSql,
  /create policy financial_transactions_no_direct_insert on public\.financial_transactions/,
  "Financial transactions must reject direct authenticated inserts.",
);

requireMatch(
  normalizedSql,
  /create policy wallet_ledger_entries_no_direct_insert on public\.wallet_ledger_entries/,
  "Wallet ledger entries must reject direct authenticated inserts.",
);

requireMatch(
  normalizedSql,
  /create or replace function public\.ensure_wallet_account/,
  "Wallet accounts must be provisioned through the reusable wallet engine.",
);

requireMatch(
  normalizedSql,
  /create or replace function public\.set_wallet_account_status/,
  "Wallet status changes must go through the reusable wallet engine.",
);

requireMatch(
  normalizedSql,
  /wallet account events are append-only/,
  "Wallet account events must be append-only.",
);

requireMatch(
  normalizedSql,
  /drop policy if exists wallet_accounts_manage_privileged/,
  "Wallet account direct privileged mutation policy must be removed.",
);

requireMatch(
  normalizedSql,
  /create policy wallet_accounts_no_direct_insert on public\.wallet_accounts/,
  "Wallet accounts must reject direct authenticated inserts.",
);

requireMatch(
  normalizedSql,
  /create policy wallet_accounts_no_direct_update on public\.wallet_accounts/,
  "Wallet accounts must reject direct authenticated updates.",
);

requireMatch(
  normalizedSql,
  /create or replace function public\.verify_wallet_ledger_append_only/,
  "Wallet ledger append-only enforcement must be remotely verifiable without persistent entries.",
);

requireMatch(
  normalizedSql,
  /create or replace function public\.record_platform_event/,
  "Events must be recorded through the reusable event engine.",
);

requireMatch(
  normalizedSql,
  /create or replace function public\.start_workflow_instance/,
  "Workflow instances must be started through the reusable workflow engine.",
);

requireMatch(
  normalizedSql,
  /create or replace function public\.advance_workflow_instance/,
  "Workflow instances must be advanced through the reusable workflow engine.",
);

requireMatch(
  normalizedSql,
  /create table if not exists public\.workflow_instance_events/,
  "Workflow transitions must leave immutable runtime receipts.",
);

requireMatch(
  normalizedSql,
  /drop policy if exists event_log_insert_actor/,
  "Direct event log insert policy must be removed.",
);

requireMatch(
  normalizedSql,
  /create policy event_log_no_direct_insert on public\.event_log/,
  "Event log must reject direct authenticated inserts.",
);

requireMatch(
  normalizedSql,
  /create policy workflow_instances_no_direct_insert on public\.workflow_instances/,
  "Workflow instances must reject direct authenticated inserts.",
);

const operationalRuntimeFunctions = [
  "record_verification_event",
  "create_dispatch_request",
  "upsert_dispatch_candidate",
  "assign_dispatch_request",
  "start_tracking_session",
  "record_tracking_point",
  "update_tracking_session_status",
  "queue_notification_message",
  "update_notification_message_status",
  "queue_ai_task_run",
  "update_ai_task_run_status",
  "queue_map_service_request",
] as const;

for (const functionName of operationalRuntimeFunctions) {
  requireMatch(
    normalizedSql,
    new RegExp(`create or replace function public\\.${functionName}`),
    `${functionName} runtime function must exist.`,
  );
}

requireMatch(
  normalizedSql,
  /operational runtime event records are append-only/,
  "Operational runtime receipt records must be append-only.",
);

const noDirectOperationalRuntimeInsertTables = [
  "verification_events",
  "dispatch_requests",
  "dispatch_candidates",
  "tracking_sessions",
  "tracking_points",
  "notification_messages",
  "ai_task_runs",
  "map_service_requests",
] as const;

for (const table of noDirectOperationalRuntimeInsertTables) {
  requireMatch(
    normalizedSql,
    new RegExp(`create policy ${table}_no_direct_insert on public\\.${table}`),
    `${table} must reject direct authenticated inserts.`,
  );
}

requireMatch(
  normalizedSql,
  /grant select, insert, update, delete on .* public\.profiles, .* public\.health_checks to service_role/s,
  "Service-role operational access must be explicit for foundation tables.",
);

console.log("Foundation migration validation passed.");

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function requireMatch(value: string, pattern: RegExp, message: string): void {
  if (!pattern.exec(value)) {
    throw new Error(message);
  }
}
