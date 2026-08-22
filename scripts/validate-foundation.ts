const migrationsDirectory = "supabase/migrations";
const migrationHistoryPolicyPath = "supabase/migration-history-policy.json";
const requiredDocumentationPaths = [
  "SKIMA_PLATFORM_CONSTITUTION.md",
  "AGENTS.md",
  "README.md",
] as const;

const migrationHistoryPolicy = JSON.parse(
  await Deno.readTextFile(migrationHistoryPolicyPath),
) as { businessModuleMigrations?: unknown };

requireCondition(
  Array.isArray(migrationHistoryPolicy.businessModuleMigrations) &&
    migrationHistoryPolicy.businessModuleMigrations.every((entry) => typeof entry === "string"),
  `${migrationHistoryPolicyPath} must configure businessModuleMigrations as a string array.`,
);

const configuredBusinessModuleMigrations = new Set(
  migrationHistoryPolicy.businessModuleMigrations as string[],
);

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

const migrationTexts = await Promise.all(
  migrationFiles.map(async (path) => ({ path, contents: await Deno.readTextFile(path) })),
);
const sql = migrationTexts.map((migration) => migration.contents).join("\n");
const normalizedSql = sql.replace(/\s+/g, " ").toLowerCase();
const platformMigrationSql = migrationTexts
  .filter((migration) => {
    const migrationFile = migration.path.split("/").at(-1) ?? migration.path;
    return !migrationFile.includes("_lpg_") &&
      !configuredBusinessModuleMigrations.has(migrationFile);
  })
  .map((migration) => migration.contents)
  .join("\n");
const normalizedPlatformMigrationSql = platformMigrationSql.replace(/\s+/g, " ").toLowerCase();
const commissionExecutionFixSql =
  migrationTexts.find((migration) =>
    migration.path.endsWith("20260801020000_commission_execution_transaction_fix.sql")
  )?.contents ?? "";
const normalizedCommissionExecutionFixSql = commissionExecutionFixSql
  .replace(/\s+/g, " ")
  .toLowerCase();

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
requireCondition(
  tables.includes("application_records"),
  "Application runtime must include governed application records.",
);
requireCondition(
  tables.includes("document_submissions"),
  "Document runtime must include governed document submissions.",
);
requireCondition(
  tables.includes("driver_vehicle_links"),
  "Driver and vehicle runtime must include governed driver-vehicle authorization links.",
);
requireCondition(
  tables.includes("organization_branches"),
  "Organization staff runtime must include branch records.",
);
requireCondition(
  tables.includes("organization_invitations"),
  "Organization staff runtime must include governed staff invitations.",
);
requireCondition(
  tables.includes("organization_staff_events"),
  "Organization staff runtime must include immutable staff event records.",
);

const requiredCatalogRuntimeTables = [
  "catalog_units",
  "catalog_categories",
  "catalog_items",
  "catalog_item_variants",
  "catalog_prices",
  "catalog_item_media",
  "catalog_availability_rules",
  "catalog_stock_adjustments",
  "catalog_orderability_checks",
  "catalog_runtime_events",
] as const;

for (const table of requiredCatalogRuntimeTables) {
  requireCondition(tables.includes(table), `Catalog runtime table is missing: ${table}.`);
}

const requiredOrderRuntimeTables = [
  "order_acceptance_policies",
  "order_action_definitions",
  "order_records",
  "order_line_items",
  "order_assignments",
  "order_events",
] as const;

for (const table of requiredOrderRuntimeTables) {
  requireCondition(tables.includes(table), `Order runtime table is missing: ${table}.`);
}

const requiredFinanceCommunicationRuntimeTables = [
  "payment_deposit_requests",
  "payment_webhook_events",
  "withdrawal_beneficiaries",
  "withdrawal_requests",
  "transfer_executions",
  "withdrawal_events",
  "commission_policies",
  "commission_executions",
  "settlement_accounts",
  "settlement_statements",
  "communication_messages",
  "communication_events",
  "otp_challenges",
  "otp_attempts",
] as const;

for (const table of requiredFinanceCommunicationRuntimeTables) {
  requireCondition(
    tables.includes(table),
    `Finance/communication runtime table is missing: ${table}.`,
  );
}

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
  "driver_vehicle_links",
  "reference_namespaces",
  "reference_sequences",
  "public_references",
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

requireMatch(
  normalizedSql,
  /create or replace function public\.reserve_lpg_refill_order_payment/,
  "LPG bounded context must expose a backend-owned payment reservation bridge.",
);

requireMatch(
  normalizedSql,
  /target_actor_user_id must match lpg order customer/,
  "LPG payment reservation must enforce the authenticated customer actor.",
);

requireMatch(
  normalizedSql,
  /lpg\.payment\.reserved/,
  "LPG payment reservation must leave an immutable LPG order event.",
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

const applicationDocumentRuntimeFunctions = [
  "create_application_record",
  "update_application_payload",
  "advance_application_record_state",
  "register_document_submission",
  "review_document_submission",
  "submit_application",
  "assign_application_reviewer",
  "request_application_correction",
  "activate_approved_application",
  "decide_application_review",
  "withdraw_application",
] as const;

for (const functionName of applicationDocumentRuntimeFunctions) {
  requireMatch(
    normalizedSql,
    new RegExp(`create or replace function public\\.${functionName}`),
    `${functionName} application/document runtime function must exist.`,
  );
}

for (
  const table of [
    "document_requirement_sets",
    "document_requirements",
    "application_type_definitions",
    "application_records",
    "application_versions",
    "application_review_tasks",
    "application_events",
    "application_review_events",
    "document_submissions",
    "document_review_events",
  ]
) {
  requireCondition(
    tables.includes(table),
    `Application/document runtime table is missing: ${table}.`,
  );
}

requireMatch(
  normalizedSql,
  /skima-platform-documents/,
  "Document runtime must configure a private Supabase Storage document bucket.",
);

requireMatch(
  normalizedSql,
  /workflow\.application\.review\.default/,
  "Application runtime must seed the database-stored review workflow.",
);

requireMatch(
  normalizedSql,
  /application\.business\.default/,
  "Application runtime must seed a reusable business application type.",
);

requireMatch(
  normalizedSql,
  /documents\.business\.onboarding\.default/,
  "Document runtime must seed configurable business onboarding requirements.",
);

requireMatch(
  normalizedSql,
  /application engine event records are append-only/,
  "Application and document review events must be append-only.",
);

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
  /provider\.storage\.supabase/,
  "Provider adapters must include Supabase Storage as the active document storage adapter.",
);

requireMatch(
  normalizedSql,
  /driver must be approved before becoming available/,
  "Driver profiles must prevent availability before approval.",
);

requireMatch(
  normalizedSql,
  /vehicle approval cannot be self-assigned/,
  "Vehicle records must prevent direct self-activation.",
);

requireMatch(
  normalizedSql,
  /driver_required_capabilities/,
  "Dispatch runtime must support driver-specific capability requirements.",
);

requireMatch(
  normalizedSql,
  /vehicle_required_capabilities/,
  "Dispatch runtime must support vehicle-specific capability requirements.",
);

requireMatch(
  normalizedSql,
  /driver_vehicle_links/,
  "Dispatch runtime must require approved driver-vehicle links.",
);

const organizationStaffRuntimeFunctions = [
  "has_permission_for_branch",
  "can_manage_organization_staff",
  "can_read_organization_staff",
  "create_organization_branch",
  "configure_organization_role",
  "invite_organization_staff",
  "accept_organization_invitation",
  "set_organization_staff_status",
  "transfer_organization_ownership",
] as const;

for (const functionName of organizationStaffRuntimeFunctions) {
  requireMatch(
    normalizedSql,
    new RegExp(`create or replace function public\\.${functionName}`),
    `${functionName} organization staff runtime function must exist.`,
  );
}

requireMatch(
  normalizedSql,
  /organization roles cannot grant platform permissions/,
  "Organization staff runtime must prevent organization roles from granting platform permissions.",
);

requireMatch(
  normalizedSql,
  /organization staff events are append-only/,
  "Organization staff event records must be append-only.",
);

requireMatch(
  normalizedSql,
  /create policy organization_memberships_no_direct_insert on public\.organization_memberships/,
  "Organization memberships must reject direct authenticated inserts.",
);

requireMatch(
  normalizedSql,
  /create policy user_roles_no_direct_insert on public\.user_roles/,
  "Organization user roles must reject direct authenticated inserts.",
);

const catalogRuntimeFunctions = [
  "can_read_business_catalog",
  "can_manage_business_catalog",
  "record_catalog_runtime_event",
  "resolve_catalog_module_id",
  "configure_catalog_unit",
  "configure_catalog_category",
  "configure_catalog_item",
  "configure_catalog_variant",
  "configure_catalog_price",
  "attach_catalog_item_media",
  "set_catalog_availability",
  "adjust_catalog_stock",
  "validate_catalog_orderability",
] as const;

for (const functionName of catalogRuntimeFunctions) {
  requireMatch(
    normalizedSql,
    new RegExp(`create or replace function public\\.${functionName}`),
    `${functionName} catalog runtime function must exist.`,
  );
}

requireMatch(
  normalizedSql,
  /catalog runtime events are append-only/,
  "Catalog runtime event records must be append-only.",
);

requireMatch(
  normalizedSql,
  /business catalog management permission is required/,
  "Catalog runtime must enforce organization-scoped business catalog permissions.",
);

requireMatch(
  normalizedSql,
  /insufficient stock is available/,
  "Catalog orderability must reject insufficient stock.",
);

for (const table of requiredCatalogRuntimeTables) {
  requireMatch(
    normalizedSql,
    new RegExp(`create policy ${table}_no_direct_insert on public\\.${table}`),
    `${table} must reject direct authenticated inserts.`,
  );
}

const orderRuntimeFunctions = [
  "can_read_business_order",
  "can_process_business_order",
  "resolve_order_workflow_version",
  "resolve_order_acceptance_policy",
  "resolve_order_action_definition",
  "apply_order_reservation_effect",
  "record_order_notification",
  "apply_order_action_internal",
  "create_order_from_catalog",
  "process_order_action",
  "assign_order_participant",
] as const;

for (const functionName of orderRuntimeFunctions) {
  requireMatch(
    normalizedSql,
    new RegExp(`create or replace function public\\.${functionName}`),
    `${functionName} order runtime function must exist.`,
  );
}

requireMatch(
  normalizedSql,
  /workflow\.order\.processing\.default/,
  "Order runtime must seed a database-stored order processing workflow.",
);

requireMatch(
  normalizedSql,
  /order events are append-only/,
  "Order runtime event records must be append-only.",
);

requireMatch(
  normalizedSql,
  /business order processing permission is required/,
  "Order runtime must enforce organization-scoped business order permissions.",
);

requireMatch(
  normalizedSql,
  /event\.order\.received/,
  "Order runtime must record order received events.",
);

for (const table of requiredOrderRuntimeTables) {
  requireMatch(
    normalizedSql,
    new RegExp(`create policy ${table}_no_direct_insert on public\\.${table}`),
    `${table} must reject direct authenticated inserts.`,
  );
}

const financeCommunicationRuntimeFunctions = [
  "initialize_wallet_deposit",
  "process_wallet_deposit_provider_event",
  "verify_wallet_deposit",
  "configure_withdrawal_beneficiary",
  "request_wallet_withdrawal",
  "approve_wallet_withdrawal",
  "process_wallet_withdrawal_transfer",
  "fund_order_from_wallet",
  "execute_driver_commission",
  "execute_order_business_settlement",
  "queue_communication_message",
  "sync_communication_message_statuses",
  "request_otp_challenge",
  "verify_otp_challenge",
] as const;

for (const functionName of financeCommunicationRuntimeFunctions) {
  requireMatch(
    normalizedSql,
    new RegExp(`create or replace function public\\.${functionName}`),
    `${functionName} finance/communication runtime function must exist.`,
  );
}

const publicReferenceRuntimeFunctions = [
  "configure_reference_namespace",
  "generate_public_reference",
  "assign_public_reference_after_insert",
  "validate_public_reference_after_insert",
  "prevent_subject_public_reference_update",
] as const;

for (const functionName of publicReferenceRuntimeFunctions) {
  requireMatch(
    normalizedSql,
    new RegExp(`create or replace function public\\.${functionName}`),
    `${functionName} public reference runtime function must exist.`,
  );
}

for (
  const referenceNamespace of [
    "reference.lpg.cylinder",
    "reference.lpg.order",
    "reference.lpg.scan-session",
    "reference.payment.deposit",
    "reference.withdrawal.request",
    "reference.commission.execution",
    "reference.settlement.statement",
  ]
) {
  requireMatch(
    normalizedSql,
    new RegExp(referenceNamespace.replace(/\./g, "\\.")),
    `Public reference namespace is missing: ${referenceNamespace}.`,
  );
}

for (
  const publicReferenceTable of [
    "lpg_cylinders",
    "lpg_refill_quotes",
    "lpg_refill_orders",
    "lpg_cylinder_scans",
    "payment_deposit_requests",
    "withdrawal_requests",
    "commission_executions",
    "settlement_statements",
  ]
) {
  requireMatch(
    normalizedSql,
    new RegExp(
      `alter table public\\.${publicReferenceTable} add column if not exists public_reference text`,
    ),
    `${publicReferenceTable} must expose a backend-owned public_reference column.`,
  );
}

requireMatch(
  normalizedSql,
  /public business references are backend-managed and immutable/,
  "Subject public reference fields must be immutable outside the backend assignment trigger.",
);

requireMatch(
  normalizedSql,
  /public business reference records are append-only/,
  "Public reference receipt records must be append-only.",
);

requireMatch(
  normalizedSql,
  /NGN is the only enabled phase-one deposit currency/i,
  "Phase-one NGN deposits must be enforced by the payment runtime.",
);

requireMatch(
  normalizedSql,
  /finance and communication runtime event records are append-only/,
  "Payment, withdrawal, communication, and OTP receipts must be append-only.",
);

requireMatch(
  normalizedSql,
  /provider\.payment\.initialize/,
  "Payment deposits must run through a provider adapter execution surface.",
);

requireMatch(
  normalizedSql,
  /provider\.payment\.paystack[\s\S]*x-paystack-signature[\s\S]*hmac_sha512/,
  "Paystack must be represented as a real signed NGN payment provider adapter.",
);

requireMatch(
  await Deno.readTextFile("supabase/functions/payment-webhook/index.ts"),
  /x-paystack-signature[\s\S]*PAYSTACK_SECRET_KEY[\s\S]*SHA-512/,
  "Payment webhook must verify Paystack x-paystack-signature with PAYSTACK_SECRET_KEY.",
);

requireMatch(
  normalizedSql,
  /provider\.payment\.transfer/,
  "Withdrawals must run through a provider adapter transfer surface.",
);

requireMatch(
  normalizedCommissionExecutionFixSql,
  /insert into public\.commission_executions \( service_request_id, order_id, escrow_hold_id, driver_wallet_id, commission_policy_id, transaction_id,/,
  "Commission executions must store the release transaction in commission_executions.transaction_id.",
);

requireMatch(
  normalizedCommissionExecutionFixSql,
  /policy_record\.id, release_transaction_id, order_record\.currency_code/,
  "Commission execution must use the release_transaction_id value returned by release_escrow_hold.",
);

requireMatch(
  normalizedSql,
  /otp_delivery_mode/,
  "Communication provider selection must define the current OTP delivery mode.",
);

requireMatch(
  normalizedSql,
  /backend_generated_in_app_sandbox/,
  "Current OTP delivery mode must be backend-generated in-app sandbox while live providers are paused.",
);

requireMatch(
  normalizedSql,
  /create table if not exists public\.otp_delivery_codes/,
  "OTP codes must be kept in a protected backend delivery table.",
);

requireMatch(
  normalizedSql,
  /fetch_in_app_otp_code/,
  "OTP runtime must expose an authenticated backend in-app delivery RPC.",
);

requireMatch(
  normalizedSql,
  /otp_redacted/,
  "OTP notification and communication payloads must remain redacted.",
);

requireMatch(
  normalizedSql,
  /disabled_provider_keys.*provider\.communication\.resend.*provider\.communication\.twilio/s,
  "Resend and Twilio must be explicitly disabled until production communication delivery resumes.",
);

requireMatch(
  normalizedSql,
  /platform\.verification.*qr_scan_policy/s,
  "QR scan policy must be configured through the Verification Engine.",
);

for (
  const providerKey of [
    "provider.payment.paystack",
    "provider.payment.monnify",
    "provider.payment.flutterwave",
    "provider.communication.resend",
    "provider.communication.twilio",
  ]
) {
  requireMatch(
    normalizedSql,
    new RegExp(providerKey.replace(/\./g, "\\.")),
    `Live provider adapter catalog record is missing: ${providerKey}.`,
  );
}

for (
  const secretReference of [
    "supabase_secret:paystack_secret_key",
    "supabase_secret:monnify_secret_key",
    "supabase_secret:flutterwave_secret_key",
    "supabase_secret:resend_api_key",
    "supabase_secret:twilio_auth_token",
  ]
) {
  requireMatch(
    normalizedSql,
    new RegExp(secretReference),
    `Live provider secret reference is missing: ${secretReference}.`,
  );
}

for (const table of requiredFinanceCommunicationRuntimeTables) {
  requireMatch(
    normalizedSql,
    new RegExp(`create policy ${table}_no_direct_insert on public\\.${table}`),
    `${table} must reject direct authenticated inserts.`,
  );
}

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
  /endpoint_delivery_config/,
  "Webhook retry/dead-letter policy must support endpoint-level configuration overrides.",
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
await requireFile("scripts/verify-webhook-dead-letter.ts");
await requireFile("scripts/verify-application-document-lifecycle.ts");
await requireFile("scripts/verify-driver-vehicle-onboarding.ts");
await requireFile("scripts/verify-organization-staff-lifecycle.ts");
await requireFile("scripts/verify-catalog-availability-lifecycle.ts");
await requireFile("scripts/verify-order-operations-lifecycle.ts");
await requireFile("scripts/verify-finance-communication-lifecycle.ts");
await requireFile("scripts/verify-public-reference-runtime.ts");
await requireFile("scripts/verify-lpg-payment-reservation.ts");

const apiGatewaySql = await Deno.readTextFile("supabase/functions/api-gateway/index.ts");

requireMatch(
  apiGatewaySql,
  /"\/lpg\/orders\/reserve-payment"/,
  "API gateway must expose the LPG payment reservation route.",
);

requireMatch(
  apiGatewaySql,
  /reserve_lpg_refill_order_payment/,
  "API gateway must route LPG payment reservation through the bounded-context RPC.",
);

requireCondition(
  !/create or replace function public\.[a-z0-9_]*lpg/.exec(normalizedPlatformMigrationSql),
  "Shared platform migrations must not add LPG-specific platform functions.",
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
