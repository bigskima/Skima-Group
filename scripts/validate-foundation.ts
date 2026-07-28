const migrationsDirectory = "supabase/migrations";
const requiredDocumentationPaths = [
  "docs/00-platform-constitution.md",
  "docs/01-system-architecture.md",
  "docs/02-backend-architecture.md",
  "docs/03-database-schema.md",
  "docs/04-api-reference.md",
  "docs/05-authentication-authorization.md",
  "docs/06-workflow-engine.md",
  "docs/07-event-engine.md",
  "docs/08-financial-engine.md",
  "docs/09-wallet-ledger-escrow.md",
  "docs/10-pricing-engine.md",
  "docs/11-dispatch-engine.md",
  "docs/12-tracking-engine.md",
  "docs/13-verification-engine.md",
  "docs/14-notification-engine.md",
  "docs/15-provider-adapters.md",
  "docs/16-ai-orchestration.md",
  "docs/17-module-framework.md",
  "docs/18-security-model.md",
  "docs/19-testing-strategy.md",
  "docs/20-deployment-operations.md",
  "docs/21-milestone-status.md",
  "docs/22-architecture-decisions/ADR-0001-backend-first-sequential-production.md",
  "docs/22-architecture-decisions/ADR-0002-external-provider-boundaries.md",
  "docs/23-change-requests/CR-0001-backend-first-remediation.md",
  "docs/24-known-limitations.md",
  "docs/25-production-readiness.md",
] as const;

for (const documentationPath of requiredDocumentationPaths) {
  try {
    const fileInfo = await Deno.stat(documentationPath);
    requireCondition(fileInfo.isFile, `${documentationPath} must be a documentation file.`);
  } catch (_error) {
    throw new Error(`Required documentation file is missing: ${documentationPath}.`);
  }
}

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
requireCondition(
  tables.includes("business_modules"),
  "Milestone 3 must include the business module registry.",
);
requireCondition(
  tables.includes("business_module_versions"),
  "Milestone 3 must include versioned business module definitions.",
);
requireCondition(
  tables.includes("business_module_components"),
  "Milestone 3 must include module component bindings.",
);
requireCondition(
  tables.includes("service_requests"),
  "Backend runtime remediation must include executable service request records.",
);
requireCondition(
  tables.includes("price_quotes"),
  "Backend runtime remediation must include executable price quotes.",
);
requireCondition(
  tables.includes("settlement_executions"),
  "Backend runtime remediation must include settlement execution receipts.",
);
requireCondition(
  tables.includes("provider_execution_logs"),
  "Backend runtime remediation must include provider execution logs.",
);
requireCondition(
  tables.includes("webhook_delivery_attempts"),
  "Webhook delivery runtime must include immutable delivery attempt records.",
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

requireMatch(
  normalizedSql,
  /platform\.module_admin/,
  "Milestone 3 must seed module admin as a configurable admin role template.",
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
  "service_requests",
  "service_request_events",
  "price_quotes",
  "settlement_executions",
  "provider_execution_logs",
] as const;

for (const table of requiredEngineTables) {
  requireCondition(tables.includes(table), `Milestone 2 engine table is missing: ${table}.`);
}

const requiredModuleTables = [
  "business_modules",
  "business_module_versions",
  "business_module_components",
  "business_module_events",
] as const;

for (const table of requiredModuleTables) {
  requireCondition(tables.includes(table), `Milestone 3 module table is missing: ${table}.`);
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

const moduleFrameworkFunctions = [
  "can_manage_business_modules",
  "validate_business_module_component_reference",
  "configure_business_module",
  "configure_business_module_version",
  "configure_business_module_component",
  "activate_business_module_version",
  "retire_business_module",
] as const;

for (const functionName of moduleFrameworkFunctions) {
  requireMatch(
    normalizedSql,
    new RegExp(`create or replace function public\\.${functionName}`),
    `${functionName} module framework function must exist.`,
  );
}

requireMatch(
  normalizedSql,
  /business module events are append-only/,
  "Business module lifecycle events must be append-only.",
);

requireMatch(
  normalizedSql,
  /business module version must define at least one active component/,
  "Business module activation must require configured components.",
);

requireMatch(
  normalizedSql,
  /'lpg', 'lpg'/,
  "Milestone 3 must configure the first LPG business module.",
);

requireMatch(
  normalizedSql,
  /pricing\.lpg\.fixed\.v1/,
  "LPG module configuration must bind a fixed pricing policy.",
);

requireMatch(
  normalizedSql,
  /settlement\.lpg\.escrow\.station-driver\.v1/,
  "LPG module configuration must bind an escrow settlement policy.",
);

requireMatch(
  normalizedSql,
  /workflow\.lpg\.fulfillment/,
  "LPG module configuration must bind a database-stored workflow.",
);

requireMatch(
  normalizedSql,
  /dispatch\.lpg\.nearest-qualified-driver\.v1/,
  "LPG module configuration must bind a dispatch policy.",
);

requireMatch(
  normalizedSql,
  /verification\.lpg\.pickup\.asset_scan/,
  "LPG module configuration must bind cylinder pickup verification.",
);

requireMatch(
  normalizedSql,
  /ai\.lpg\.dispatch\.recommendation/,
  "LPG module configuration must bind an assist-only AI behavior.",
);

requireMatch(
  normalizedSql,
  /module\.lpg\.operate/,
  "LPG module configuration must define module-scoped permissions.",
);

const executableRuntimeFunctions = [
  "create_module_service_request",
  "calculate_price_quote",
  "accept_price_quote",
  "create_escrow_hold",
  "update_escrow_hold_status",
  "release_escrow_hold",
  "refund_escrow_hold",
  "start_service_request_workflow",
  "process_service_request_event",
  "assign_service_request_participant",
  "dispatch_service_request",
  "execute_service_request_settlement",
  "expire_escrow_holds",
  "reconcile_service_request_financials",
  "record_provider_execution",
  "check_rate_limit",
  "set_cache_entry",
  "get_cache_entry",
  "enqueue_background_job",
  "record_health_check",
] as const;

for (const functionName of executableRuntimeFunctions) {
  requireMatch(
    normalizedSql,
    new RegExp(`create or replace function public\\.${functionName}`),
    `${functionName} executable runtime function must exist.`,
  );
}

requireMatch(
  normalizedSql,
  /'dispatch_policy'/,
  "Module framework must support dispatch policy component bindings.",
);

requireMatch(
  normalizedSql,
  /provider\.notification\.sandbox/,
  "Provider adapters must include deterministic sandbox notification execution.",
);

requireMatch(
  normalizedSql,
  /provider\.ai\.sandbox/,
  "Provider adapters must include deterministic sandbox AI execution.",
);

requireMatch(
  normalizedSql,
  /create policy service_requests_no_direct_insert on public\.service_requests/,
  "Service requests must reject direct authenticated inserts.",
);

requireMatch(
  normalizedSql,
  /create policy price_quotes_no_direct_insert on public\.price_quotes/,
  "Price quotes must reject direct authenticated inserts.",
);

requireMatch(
  normalizedSql,
  /create policy settlement_executions_no_direct_insert on public\.settlement_executions/,
  "Settlement executions must reject direct authenticated inserts.",
);

requireMatch(
  normalizedSql,
  /create policy provider_execution_logs_no_direct_insert on public\.provider_execution_logs/,
  "Provider execution logs must reject direct authenticated inserts.",
);

requireMatch(
  normalizedSql,
  /create policy webhook_delivery_attempts_no_direct_insert on public\.webhook_delivery_attempts/,
  "Webhook delivery attempts must reject direct authenticated inserts.",
);

requireMatch(
  normalizedSql,
  /webhook delivery attempts are append-only/,
  "Webhook delivery attempts must be append-only.",
);

requireMatch(
  normalizedSql,
  /create or replace function public\.claim_pending_webhook_deliveries/,
  "Webhook runtime must claim pending deliveries through a controlled RPC.",
);

requireMatch(
  normalizedSql,
  /create or replace function public\.record_webhook_delivery_attempt/,
  "Webhook runtime must record delivery attempts through a controlled RPC.",
);

requireMatch(
  normalizedSql,
  /enqueue_webhook_deliveries_after_event_insert/,
  "Platform events must enqueue configured webhook deliveries.",
);

requireMatch(
  normalizedSql,
  /runtime event records are append-only/,
  "Runtime service request events must be append-only.",
);

await requireFile("supabase/functions/runtime-worker/index.ts");
await requireFile("supabase/functions/payment-webhook/index.ts");
await requireFile("supabase/functions/webhook-sandbox-receiver/index.ts");
await requireFile("scripts/verify-backend-lifecycle.ts");

requireCondition(
  !/create or replace function public\.[a-z0-9_]*lpg/.exec(normalizedSql),
  "LPG must not add LPG-specific platform functions.",
);

const noDirectModuleInsertTables = [
  "business_modules",
  "business_module_versions",
  "business_module_components",
  "business_module_events",
] as const;

for (const table of noDirectModuleInsertTables) {
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

async function requireFile(path: string): Promise<void> {
  try {
    const fileInfo = await Deno.stat(path);
    requireCondition(fileInfo.isFile, `${path} must be a file.`);
  } catch (_error) {
    throw new Error(`Required runtime file is missing: ${path}.`);
  }
}

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
