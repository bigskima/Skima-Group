import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.9";

import { resolveSupabaseRuntime } from "./supabase-runtime.ts";

const runtime = await resolveSupabaseRuntime({ anonKey: true, serviceRoleKey: true });
const supabaseUrl = runtime.supabaseUrl;
const anonKey = runtime.anonKey!;
const serviceRoleKey = runtime.serviceRoleKey!;
const adminAccessToken = Deno.env.get("SKIMA_ADMIN_ACCESS_TOKEN");
const adminEmail = Deno.env.get("SKIMA_SUPER_ADMIN_EMAIL") ?? Deno.env.get("SKIMA_ADMIN_EMAIL");
const adminPassword = Deno.env.get("SKIMA_SUPER_ADMIN_PASSWORD") ??
  Deno.env.get("SKIMA_ADMIN_PASSWORD");

const anonClient = createBrowserSafeClient(anonKey);
const serviceClient = createDeploymentClient(serviceRoleKey);

await runGate("public health function responds", verifyPublicHealthFunction);
await runGate("api gateway rejects anonymous requests", verifyGatewayRejectsAnonymous);
await runGate("runtime worker rejects unsigned requests", verifyRuntimeWorkerRejectsUnsigned);
await runGate("payment webhook rejects unsigned requests", verifyPaymentWebhookRejectsUnsigned);
await runGate("anonymous role cannot read protected tables", verifyAnonymousProtectedTables);
await runGate("service role can read foundation records", verifyServiceRoleFoundationAccess);
await runGate("one active platform super admin exists", verifySingleActiveSuperAdmin);
await runGate("real platform wallets exist", verifyRealPlatformWalletsExist);
await runGate("audit logs reject direct mutation", verifyAuditLogsRejectDirectMutation);
await runGate(
  "wallet runtime rejects incomplete operations",
  verifyWalletRuntimeRejectsIncompleteOperations,
);
await runGate(
  "financial posting engine rejects incomplete postings",
  verifyFinancialPostingRejectsIncompletePosting,
);
await runGate(
  "workflow runtime rejects incomplete operations",
  verifyWorkflowRuntimeRejectsIncompleteOperations,
);
await runGate(
  "operational runtimes reject incomplete operations",
  verifyOperationalRuntimesRejectIncompleteOperations,
);
await runGate("wallet ledger rejects direct mutation", verifyWalletLedgerRejectsDirectMutation);
await runGate(
  "business module framework rejects incomplete operations",
  verifyModuleFrameworkRejectsIncompleteOperations,
);
await runGate(
  "backend runtime remediation rejects incomplete operations",
  verifyBackendRuntimeRejectsIncompleteOperations,
);
await runGate(
  "first business module configuration is active",
  verifyFirstBusinessModuleConfiguration,
);

const adminClient = await resolveAdminClient();

if (adminClient) {
  await runGate(
    "real platform super admin can read governed records",
    () => verifyPlatformAdminReadAccess(adminClient),
  );
} else {
  throw new Error(
    "Real admin session credentials are required for the production gate. Set SKIMA_ADMIN_ACCESS_TOKEN or SKIMA_SUPER_ADMIN_EMAIL and SKIMA_SUPER_ADMIN_PASSWORD in the deployment shell.",
  );
}

console.log("Hosted Supabase production gate completed.");

async function verifyPublicHealthFunction(): Promise<void> {
  const response = await fetch(`${supabaseUrl}/functions/v1/health`);
  const body = await readJson(response);

  requireCondition(response.ok, `health returned HTTP ${response.status}.`);
  requireCondition(body.ok === true, "health response did not return ok=true.");
}

async function verifyGatewayRejectsAnonymous(): Promise<void> {
  const healthResponse = await fetch(`${supabaseUrl}/functions/v1/api-gateway/health`);

  requireCondition(
    healthResponse.status === 401 || healthResponse.status === 403,
    `api-gateway anonymous health request returned HTTP ${healthResponse.status}.`,
  );

  const adminResponse = await fetch(`${supabaseUrl}/functions/v1/api-gateway/admin/role-templates`);

  requireCondition(
    adminResponse.status === 401 || adminResponse.status === 403,
    `api-gateway anonymous admin request returned HTTP ${adminResponse.status}.`,
  );

  const engineResponse = await fetch(`${supabaseUrl}/functions/v1/api-gateway/engines/catalog`);

  requireCondition(
    engineResponse.status === 401 || engineResponse.status === 403,
    `api-gateway anonymous engine request returned HTTP ${engineResponse.status}.`,
  );

  const moduleResponse = await fetch(`${supabaseUrl}/functions/v1/api-gateway/modules/catalog`);

  requireCondition(
    moduleResponse.status === 401 || moduleResponse.status === 403,
    `api-gateway anonymous module request returned HTTP ${moduleResponse.status}.`,
  );
}

async function verifyRuntimeWorkerRejectsUnsigned(): Promise<void> {
  const response = await fetch(`${supabaseUrl}/functions/v1/runtime-worker`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit: 1 }),
  });

  requireCondition(
    response.status === 401 || response.status === 403,
    `runtime-worker unsigned request returned HTTP ${response.status}.`,
  );
}

async function verifyPaymentWebhookRejectsUnsigned(): Promise<void> {
  const response = await fetch(`${supabaseUrl}/functions/v1/payment-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idempotencyKey: `remote-gate:${crypto.randomUUID()}` }),
  });

  requireCondition(
    response.status === 401 || response.status === 403,
    `payment-webhook unsigned request returned HTTP ${response.status}.`,
  );
}

async function verifyAnonymousProtectedTables(): Promise<void> {
  const { data, error } = await anonClient.from("configuration_entries").select("id").limit(1);

  if (error) {
    return;
  }

  requireCondition(
    (data ?? []).length === 0,
    "anonymous role received protected configuration records.",
  );
}

async function verifyServiceRoleFoundationAccess(): Promise<void> {
  await requireReadable(serviceClient, "configuration_entries", "namespace,key,status");
  await requireReadable(serviceClient, "platform_admins", "user_id,admin_kind,status");
  await requireReadable(serviceClient, "platform_admin_role_templates", "key,status");
  await requireReadable(serviceClient, "business_modules", "key,status");
  await requireReadable(serviceClient, "business_module_versions", "version,status");
  await requireReadable(serviceClient, "business_module_components", "component_type,status");
  await requireReadable(serviceClient, "business_module_events", "event_type");
  await requireReadable(serviceClient, "roles", "key,status");
  await requireReadable(serviceClient, "provider_adapters", "provider_kind,key,status");
  await requireReadable(serviceClient, "workflow_definitions", "key,status");
  await requireReadable(serviceClient, "currency_definitions", "code,status");
  await requireReadable(serviceClient, "pricing_policies", "key,status");
  await requireReadable(serviceClient, "settlement_policies", "key,status");
  await requireReadable(serviceClient, "wallet_accounts", "wallet_type,status");
  await requireReadable(serviceClient, "wallet_account_events", "event_type,status");
  await requireReadable(serviceClient, "financial_transactions", "transaction_type,status");
  await requireReadable(serviceClient, "wallet_ledger_entries", "direction,amount");
  await requireReadable(serviceClient, "escrow_holds", "status");
  await requireReadable(serviceClient, "workflow_instances", "status");
  await requireReadable(serviceClient, "workflow_instance_events", "status");
  await requireReadable(serviceClient, "event_handlers", "key,status");
  await requireReadable(serviceClient, "verification_definitions", "key,status");
  await requireReadable(serviceClient, "verification_events", "result");
  await requireReadable(serviceClient, "dispatch_policies", "key,status");
  await requireReadable(serviceClient, "dispatch_requests", "status");
  await requireReadable(serviceClient, "dispatch_request_events", "status");
  await requireReadable(serviceClient, "dispatch_candidates", "status");
  await requireReadable(serviceClient, "tracking_sessions", "status");
  await requireReadable(serviceClient, "tracking_session_events", "status");
  await requireReadable(serviceClient, "tracking_points", "latitude,longitude");
  await requireReadable(serviceClient, "notification_templates", "key,status");
  await requireReadable(serviceClient, "notification_messages", "channel,status");
  await requireReadable(serviceClient, "notification_message_events", "status");
  await requireReadable(serviceClient, "ai_task_definitions", "key,status");
  await requireReadable(serviceClient, "ai_task_runs", "status");
  await requireReadable(serviceClient, "ai_task_run_events", "status");
  await requireReadable(serviceClient, "map_service_requests", "request_type,status");
  await requireReadable(serviceClient, "service_requests", "status");
  await requireReadable(serviceClient, "service_request_events", "status");
  await requireReadable(serviceClient, "price_quotes", "status,total_amount");
  await requireReadable(serviceClient, "settlement_executions", "status,gross_amount");
  await requireReadable(
    serviceClient,
    "provider_execution_logs",
    "provider_kind,operation_key,status",
  );
}

async function verifyAuditLogsRejectDirectMutation(): Promise<void> {
  const { data, error } = await serviceClient
    .from("audit_logs")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  requireCondition(Boolean(data?.id), "no audit log row exists for append-only verification.");

  const updateResult = await serviceClient
    .from("audit_logs")
    .update({ metadata: { remote_gate: true } })
    .eq("id", data!.id);

  requireCondition(Boolean(updateResult.error), "audit log direct update was allowed.");

  const deleteResult = await serviceClient
    .from("audit_logs")
    .delete()
    .eq("id", data!.id);

  requireCondition(Boolean(deleteResult.error), "audit log direct delete was allowed.");
}

async function verifyRealPlatformWalletsExist(): Promise<void> {
  const requiredWalletTypes = ["platform", "escrow", "commission", "refund"];
  const { data, error } = await serviceClient
    .from("wallet_accounts")
    .select("wallet_type,status,currency_code,owner_entity_type")
    .eq("owner_entity_type", "platform")
    .eq("currency_code", "NGN")
    .eq("status", "active")
    .in("wallet_type", requiredWalletTypes);

  if (error) {
    throw error;
  }

  const existingWalletTypes = new Set((data ?? []).map((wallet) => wallet.wallet_type));
  const missingWalletTypes = requiredWalletTypes.filter((walletType) =>
    !existingWalletTypes.has(walletType)
  );

  requireCondition(
    missingWalletTypes.length === 0,
    `missing active platform NGN wallets: ${missingWalletTypes.join(", ")}`,
  );
}

async function verifyWalletRuntimeRejectsIncompleteOperations(): Promise<void> {
  await requireRpcError(
    "wallet provisioning engine",
    serviceClient.rpc("ensure_wallet_account", {
      target_currency_code: "NGN",
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_metadata: {},
      target_owner_entity_id: null,
      target_owner_entity_type: "platform",
      target_source: null,
      target_wallet_type: "platform",
    }),
    "target_source must be a valid platform key",
  );

  await requireRpcError(
    "wallet status engine",
    serviceClient.rpc("set_wallet_account_status", {
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_metadata: {},
      target_status: "active",
      target_wallet_account_id: null,
    }),
    "target_wallet_account_id is required",
  );
}

async function verifyWalletLedgerRejectsDirectMutation(): Promise<void> {
  const { data, error } = await serviceClient.rpc("verify_wallet_ledger_append_only");

  if (error) {
    throw error;
  }

  requireCondition(data === true, "wallet ledger append-only verification did not pass.");
}

async function verifyFinancialPostingRejectsIncompletePosting(): Promise<void> {
  const { error } = await serviceClient.rpc("post_financial_transaction", {
    target_transaction_type: "adjustment",
    target_currency_code: "NGN",
    target_source: "platform.remote_gate",
    target_subject_type: "platform.verification",
    target_subject_id: null,
    target_entries: [],
    target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
    target_provider_adapter_id: null,
    target_external_reference: null,
    target_policy_snapshot: {},
    target_metadata: {},
  });

  requireCondition(Boolean(error), "financial posting engine accepted an incomplete posting.");
  requireCondition(
    error!.message.includes("target_entries must contain at least two ledger entries"),
    `financial posting engine returned unexpected error: ${error!.message}`,
  );
}

async function verifyWorkflowRuntimeRejectsIncompleteOperations(): Promise<void> {
  const eventResult = await serviceClient.rpc("record_platform_event", {
    target_event_type_key: "platform.remote_gate.missing_event",
    target_source: "platform.remote_gate",
    target_subject_type: "platform.verification",
    target_subject_id: crypto.randomUUID(),
    target_payload: {},
    target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
    target_occurred_at: new Date().toISOString(),
  });

  requireCondition(Boolean(eventResult.error), "event engine accepted an unknown event type.");
  requireCondition(
    eventResult.error!.message.includes(
      "target_event_type_key must reference an active event type",
    ),
    `event engine returned unexpected error: ${eventResult.error!.message}`,
  );

  const startResult = await serviceClient.rpc("start_workflow_instance", {
    target_workflow_key: "platform.remote_gate.missing_workflow",
    target_source: "platform.remote_gate",
    target_subject_type: "platform.verification",
    target_subject_id: crypto.randomUUID(),
    target_context: {},
    target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
  });

  requireCondition(Boolean(startResult.error), "workflow engine accepted an unknown workflow.");
  requireCondition(
    startResult.error!.message.includes(
      "target_workflow_key must reference an active workflow version",
    ),
    `workflow engine returned unexpected error: ${startResult.error!.message}`,
  );

  const advanceResult = await serviceClient.rpc("advance_workflow_instance", {
    target_instance_id: null,
    target_event_type_key: "platform.remote_gate.event",
    target_event_id: null,
    target_payload: {},
    target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
  });

  requireCondition(
    Boolean(advanceResult.error),
    "workflow engine accepted an advancement without an instance.",
  );
  requireCondition(
    advanceResult.error!.message.includes("target_instance_id is required"),
    `workflow advancement returned unexpected error: ${advanceResult.error!.message}`,
  );
}

async function verifyOperationalRuntimesRejectIncompleteOperations(): Promise<void> {
  await requireRpcError(
    "verification engine",
    serviceClient.rpc("record_verification_event", {
      target_definition_key: "platform.remote_gate.missing_verification",
      target_source: "platform.remote_gate",
      target_scanned_entity_type: "platform.verification",
      target_scanned_entity_id: crypto.randomUUID(),
      target_purpose: "platform.remote_gate",
      target_location: {},
      target_result: "pending",
      target_payload: {},
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_occurred_at: new Date().toISOString(),
    }),
    "target_definition_key must reference an active verification definition",
  );

  await requireRpcError(
    "dispatch request engine",
    serviceClient.rpc("create_dispatch_request", {
      target_policy_key: "platform.remote_gate.missing_dispatch_policy",
      target_source: "platform.remote_gate",
      target_subject_type: "platform.dispatch",
      target_subject_id: crypto.randomUUID(),
      target_required_capabilities: {},
      target_pickup_location: {},
      target_dropoff_location: {},
      target_priority: 100,
      target_metadata: {},
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
    }),
    "target_policy_key must reference an active dispatch policy",
  );

  await requireRpcError(
    "dispatch candidate engine",
    serviceClient.rpc("upsert_dispatch_candidate", {
      target_dispatch_request_id: null,
      target_candidate_entity_type: "platform.driver",
      target_candidate_entity_id: crypto.randomUUID(),
      target_score: 0,
      target_rank: null,
      target_rationale: {},
      target_status: "suggested",
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
    }),
    "target_dispatch_request_id is required",
  );

  await requireRpcError(
    "dispatch assignment engine",
    serviceClient.rpc("assign_dispatch_request", {
      target_dispatch_request_id: null,
      target_assigned_entity_type: "platform.driver",
      target_assigned_entity_id: crypto.randomUUID(),
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_metadata: {},
    }),
    "target_dispatch_request_id is required",
  );

  await requireRpcError(
    "tracking session engine",
    serviceClient.rpc("start_tracking_session", {
      target_source: null,
      target_subject_type: "platform.tracking",
      target_subject_id: crypto.randomUUID(),
      target_provider_adapter_id: null,
      target_metadata: {},
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
    }),
    "target_source must be a valid platform key",
  );

  await requireRpcError(
    "tracking point engine",
    serviceClient.rpc("record_tracking_point", {
      target_tracking_session_id: null,
      target_latitude: 0,
      target_longitude: 0,
      target_accuracy_meters: null,
      target_speed_meters_per_second: null,
      target_heading_degrees: null,
      target_metadata: {},
      target_recorded_at: new Date().toISOString(),
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
    }),
    "target_tracking_session_id is required",
  );

  await requireRpcError(
    "tracking status engine",
    serviceClient.rpc("update_tracking_session_status", {
      target_tracking_session_id: null,
      target_status: "completed",
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_metadata: {},
    }),
    "target_tracking_session_id is required",
  );

  await requireRpcError(
    "notification queue engine",
    serviceClient.rpc("queue_notification_message", {
      target_template_key: "platform.remote_gate.missing_notification_template",
      target_channel: "email",
      target_recipient_entity_type: "user",
      target_recipient_entity_id: null,
      target_recipient_address: "remote-gate@example.invalid",
      target_provider_adapter_id: null,
      target_payload: {},
      target_source: "platform.remote_gate",
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
    }),
    "target_template_key must reference an active notification template",
  );

  await requireRpcError(
    "notification status engine",
    serviceClient.rpc("update_notification_message_status", {
      target_notification_message_id: null,
      target_status: "sent",
      target_provider_message_id: null,
      target_error_message: null,
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_metadata: {},
    }),
    "target_notification_message_id is required",
  );

  await requireRpcError(
    "AI queue engine",
    serviceClient.rpc("queue_ai_task_run", {
      target_task_key: "platform.remote_gate.missing_ai_task",
      target_source: "platform.remote_gate",
      target_subject_type: "platform.ai_task",
      target_subject_id: crypto.randomUUID(),
      target_input: {},
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
    }),
    "target_task_key must reference an active AI task definition",
  );

  await requireRpcError(
    "AI status engine",
    serviceClient.rpc("update_ai_task_run_status", {
      target_ai_task_run_id: null,
      target_status: "running",
      target_output: {},
      target_model_info: {},
      target_error_message: null,
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_metadata: {},
    }),
    "target_ai_task_run_id is required",
  );

  await requireRpcError(
    "maps queue engine",
    serviceClient.rpc("queue_map_service_request", {
      target_provider_adapter_id: null,
      target_request_type: null,
      target_subject_type: "platform.map_request",
      target_subject_id: crypto.randomUUID(),
      target_request_payload: {},
      target_source: "platform.remote_gate",
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
    }),
    "target_request_type is not supported",
  );
}

async function verifyModuleFrameworkRejectsIncompleteOperations(): Promise<void> {
  await requireRpcError(
    "business module configuration engine",
    serviceClient.rpc("configure_business_module", {
      target_description: null,
      target_display_name: "Invalid Module",
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_metadata: {},
      target_module_key: "Invalid Module",
      target_status: "draft",
    }),
    "target_module_key must be a valid platform key",
  );

  await requireRpcError(
    "business module version engine",
    serviceClient.rpc("configure_business_module_version", {
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_manifest: {},
      target_module_key: "platform.remote_gate.missing_module",
      target_version: 1,
    }),
    "target_module_key must reference a configured business module",
  );

  await requireRpcError(
    "business module component engine",
    serviceClient.rpc("configure_business_module_component", {
      target_component_key: "platform.remote_gate.component",
      target_component_type: "workflow",
      target_config: {},
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_is_required: true,
      target_module_version_id: null,
      target_reference_key: "platform.remote_gate.workflow",
      target_status: "active",
    }),
    "target_module_version_id is required",
  );

  await requireRpcError(
    "business module activation engine",
    serviceClient.rpc("activate_business_module_version", {
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_module_key: "platform.remote_gate.missing_module",
      target_version: 1,
    }),
    "target_module_key must reference a configured business module",
  );
}

async function verifyBackendRuntimeRejectsIncompleteOperations(): Promise<void> {
  await requireRpcError(
    "service request runtime",
    serviceClient.rpc("create_module_service_request", {
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_metadata: {},
      target_module_key: "platform.remote_gate.missing_module",
      target_organization_id: null,
      target_request_payload: {},
      target_source: "platform.remote_gate",
    }),
    "target_module_key must reference an active module version",
  );

  await requireRpcError(
    "pricing execution runtime",
    serviceClient.rpc("calculate_price_quote", {
      target_currency_code: "NGN",
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_module_key: "lpg",
      target_pricing_context: {},
      target_pricing_policy_key: null,
      target_service_request_id: null,
      target_source: "platform.remote_gate",
    }),
    "target_service_request_id is required",
  );

  await requireRpcError(
    "price quote acceptance runtime",
    serviceClient.rpc("accept_price_quote", {
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_metadata: {},
      target_price_quote_id: null,
    }),
    "target_price_quote_id is required",
  );

  await requireRpcError(
    "escrow hold runtime",
    serviceClient.rpc("create_escrow_hold", {
      target_customer_wallet_id: null,
      target_escrow_wallet_id: null,
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_metadata: {},
      target_service_request_id: null,
      target_source: "platform.remote_gate",
    }),
    "target_service_request_id is required",
  );

  await requireRpcError(
    "escrow status runtime",
    serviceClient.rpc("update_escrow_hold_status", {
      target_escrow_hold_id: null,
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_metadata: {},
      target_status: "disputed",
    }),
    "target_escrow_hold_id is required",
  );

  await requireRpcError(
    "escrow release runtime",
    serviceClient.rpc("release_escrow_hold", {
      target_distribution: [],
      target_escrow_hold_id: null,
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_metadata: {},
      target_source: "platform.remote_gate",
    }),
    "target_escrow_hold_id is required",
  );

  await requireRpcError(
    "escrow refund runtime",
    serviceClient.rpc("refund_escrow_hold", {
      target_escrow_hold_id: null,
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_metadata: {},
      target_refund_wallet_id: null,
    }),
    "target_escrow_hold_id and target_refund_wallet_id are required",
  );

  await requireRpcError(
    "service request workflow runtime",
    serviceClient.rpc("start_service_request_workflow", {
      target_context: {},
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_service_request_id: null,
    }),
    "target_service_request_id is required",
  );

  await requireRpcError(
    "service request event runtime",
    serviceClient.rpc("process_service_request_event", {
      target_event_type_key: "event.request.validated",
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_payload: {},
      target_service_request_id: null,
    }),
    "target_service_request_id is required",
  );

  await requireRpcError(
    "service request participant runtime",
    serviceClient.rpc("assign_service_request_participant", {
      target_entity_id: null,
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_metadata: {},
      target_participant_role: "driver",
      target_service_request_id: null,
    }),
    "target_service_request_id is required",
  );

  await requireRpcError(
    "dispatch selection runtime",
    serviceClient.rpc("dispatch_service_request", {
      target_candidate_limit: 0,
      target_dispatch_policy_key: null,
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_service_request_id: null,
    }),
    "target_service_request_id is required",
  );

  await requireRpcError(
    "settlement execution runtime",
    serviceClient.rpc("execute_service_request_settlement", {
      target_distribution: [],
      target_escrow_hold_id: null,
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_metadata: {},
      target_service_request_id: null,
      target_source: "platform.remote_gate",
    }),
    "target_service_request_id and target_escrow_hold_id are required",
  );

  await requireRpcError(
    "reconciliation runtime",
    serviceClient.rpc("reconcile_service_request_financials", {
      target_service_request_id: null,
    }),
    "target_service_request_id is required",
  );

  await requireRpcError(
    "provider execution runtime",
    serviceClient.rpc("record_provider_execution", {
      target_error_message: null,
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_operation_key: "platform.remote_gate",
      target_provider_adapter_key: null,
      target_provider_kind: "missing",
      target_request_payload: {},
      target_response_payload: {},
      target_status: "succeeded",
    }),
    "target_provider_kind is not supported",
  );

  await requireRpcError(
    "rate limit runtime",
    serviceClient.rpc("check_rate_limit", {
      target_increment: 1,
      target_policy_key: "platform.remote_gate.missing_policy",
      target_subject: "remote-gate",
    }),
    "target_policy_key must reference an active rate limit policy",
  );

  await requireRpcError(
    "cache runtime",
    serviceClient.rpc("set_cache_entry", {
      target_cache_key: "remote-gate",
      target_namespace: null,
      target_ttl_seconds: 60,
      target_value: {},
    }),
    "target_namespace must be a valid platform key",
  );

  await requireRpcError(
    "job queue runtime",
    serviceClient.rpc("enqueue_background_job", {
      target_idempotency_key: `remote-gate:${crypto.randomUUID()}`,
      target_job_type_key: "platform.remote_gate",
      target_max_attempts: 3,
      target_payload: {},
      target_queue_key: "platform.remote_gate.missing_queue",
      target_run_at: new Date().toISOString(),
      target_source: "platform.remote_gate",
    }),
    "target_queue_key must reference an active queue",
  );

  await requireRpcError(
    "health runtime",
    serviceClient.rpc("record_health_check", {
      target_details: {},
      target_service_key: null,
      target_status: "healthy",
    }),
    "target_service_key must be a valid platform key",
  );
}

async function verifyFirstBusinessModuleConfiguration(): Promise<void> {
  const { data: moduleRecord, error: moduleError } = await serviceClient
    .from("business_modules")
    .select("id,key,status")
    .eq("key", "lpg")
    .eq("status", "active")
    .maybeSingle();

  if (moduleError) {
    throw moduleError;
  }

  requireCondition(Boolean(moduleRecord?.id), "active LPG module record is missing.");

  const { data: versionRecord, error: versionError } = await serviceClient
    .from("business_module_versions")
    .select("id,module_id,version,status")
    .eq("module_id", moduleRecord!.id)
    .eq("version", 1)
    .eq("status", "active")
    .maybeSingle();

  if (versionError) {
    throw versionError;
  }

  requireCondition(Boolean(versionRecord?.id), "active LPG module version 1 is missing.");

  const { data: components, error: componentsError } = await serviceClient
    .from("business_module_components")
    .select("component_type,component_key,reference_key,status")
    .eq("module_version_id", versionRecord!.id)
    .eq("status", "active");

  if (componentsError) {
    throw componentsError;
  }

  const configuredTypes = new Set((components ?? []).map((component) => component.component_type));

  for (
    const componentType of [
      "capability",
      "workflow",
      "pricing_policy",
      "settlement_policy",
      "dispatch_policy",
      "event",
      "permission",
      "vehicle_requirement",
      "driver_requirement",
      "document_requirement",
      "ai_behavior",
      "report",
      "screen",
    ]
  ) {
    requireCondition(
      configuredTypes.has(componentType),
      `LPG module is missing active component type: ${componentType}.`,
    );
  }

  const referenceKeys = new Set(
    (components ?? [])
      .map((component) => component.reference_key)
      .filter((referenceKey): referenceKey is string => typeof referenceKey === "string"),
  );

  for (
    const referenceKey of [
      "workflow.lpg.fulfillment",
      "pricing.lpg.fixed.v1",
      "settlement.lpg.escrow.station-driver.v1",
      "dispatch.lpg.nearest-qualified-driver.v1",
      "event.delivery.completed",
      "verification.lpg.driver.training_certificate",
      "ai.lpg.dispatch.recommendation",
    ]
  ) {
    requireCondition(
      referenceKeys.has(referenceKey),
      `LPG module is missing required engine reference: ${referenceKey}.`,
    );
  }

  await requireActiveKey("workflow_definitions", "workflow.lpg.fulfillment");
  await requireActiveKey("pricing_policies", "pricing.lpg.fixed.v1");
  await requireActiveKey("settlement_policies", "settlement.lpg.escrow.station-driver.v1");
  await requireActiveKey("dispatch_policies", "dispatch.lpg.nearest-qualified-driver.v1");
  await requireActiveKey("verification_definitions", "verification.lpg.pickup.asset_scan");
  await requireActiveKey("ai_task_definitions", "ai.lpg.dispatch.recommendation");
}

async function verifySingleActiveSuperAdmin(): Promise<void> {
  const { data, error } = await serviceClient
    .from("platform_admins")
    .select("id,user_id")
    .eq("admin_kind", "super_admin")
    .eq("status", "active");

  if (error) {
    throw error;
  }

  requireCondition(
    (data ?? []).length === 1,
    `expected exactly one active platform super admin, found ${(data ?? []).length}.`,
  );
}

async function verifyPlatformAdminReadAccess(adminClient: SupabaseClient): Promise<void> {
  const { data: userData, error: userError } = await adminClient.auth.getUser();

  if (userError) {
    throw userError;
  }

  requireCondition(Boolean(userData.user), "admin access token did not resolve to a real user.");

  await requireReadable(adminClient, "configuration_entries", "namespace,key,status");
  await requireReadable(adminClient, "provider_adapters", "provider_kind,key,status");
  await requireReadable(adminClient, "platform_admins", "user_id,admin_kind,status");
  await requireReadable(adminClient, "platform_admin_role_templates", "key,status");
  await requireReadable(adminClient, "business_modules", "key,status");
  await requireReadable(adminClient, "business_module_versions", "version,status");
  await requireReadable(adminClient, "business_module_components", "component_type,status");
  await requireReadable(adminClient, "business_module_events", "event_type");
  await requireReadable(adminClient, "workflow_definitions", "key,status");
  await requireReadable(adminClient, "currency_definitions", "code,status");
  await requireReadable(adminClient, "pricing_policies", "key,status");
  await requireReadable(adminClient, "settlement_policies", "key,status");
  await requireReadable(adminClient, "wallet_accounts", "wallet_type,status");
  await requireReadable(adminClient, "wallet_account_events", "event_type,status");
  await requireReadable(adminClient, "financial_transactions", "transaction_type,status");
  await requireReadable(adminClient, "wallet_ledger_entries", "direction,amount");
  await requireReadable(adminClient, "escrow_holds", "status");
  await requireReadable(adminClient, "workflow_instances", "status");
  await requireReadable(adminClient, "workflow_instance_events", "status");
  await requireReadable(adminClient, "event_handlers", "key,status");
  await requireReadable(adminClient, "verification_definitions", "key,status");
  await requireReadable(adminClient, "verification_events", "result");
  await requireReadable(adminClient, "dispatch_policies", "key,status");
  await requireReadable(adminClient, "dispatch_requests", "status");
  await requireReadable(adminClient, "dispatch_request_events", "status");
  await requireReadable(adminClient, "dispatch_candidates", "status");
  await requireReadable(adminClient, "tracking_sessions", "status");
  await requireReadable(adminClient, "tracking_session_events", "status");
  await requireReadable(adminClient, "tracking_points", "latitude,longitude");
  await requireReadable(adminClient, "notification_templates", "key,status");
  await requireReadable(adminClient, "notification_messages", "channel,status");
  await requireReadable(adminClient, "notification_message_events", "status");
  await requireReadable(adminClient, "ai_task_definitions", "key,status");
  await requireReadable(adminClient, "ai_task_runs", "status");
  await requireReadable(adminClient, "ai_task_run_events", "status");
  await requireReadable(adminClient, "map_service_requests", "request_type,status");
  await requireReadable(adminClient, "service_requests", "status");
  await requireReadable(adminClient, "service_request_events", "status");
  await requireReadable(adminClient, "price_quotes", "status,total_amount");
  await requireReadable(adminClient, "settlement_executions", "status,gross_amount");
  await requireReadable(
    adminClient,
    "provider_execution_logs",
    "provider_kind,operation_key,status",
  );
  await requireAdminCanReadFirstBusinessModule(adminClient);
}

async function requireReadable(
  client: SupabaseClient,
  table: string,
  columns: string,
): Promise<void> {
  const { error } = await client.from(table).select(columns).limit(1);

  if (error) {
    throw error;
  }
}

async function requireActiveKey(table: string, key: string): Promise<void> {
  const { data, error } = await serviceClient
    .from(table)
    .select("key,status")
    .eq("key", key)
    .eq("status", "active")
    .limit(1);

  if (error) {
    throw error;
  }

  requireCondition((data ?? []).length === 1, `active record is missing: ${table}.${key}.`);
}

async function requireAdminCanReadFirstBusinessModule(adminClient: SupabaseClient): Promise<void> {
  const { data: moduleRecord, error: moduleError } = await adminClient
    .from("business_modules")
    .select("id,key,status")
    .eq("key", "lpg")
    .eq("status", "active")
    .maybeSingle();

  if (moduleError) {
    throw moduleError;
  }

  requireCondition(
    Boolean(moduleRecord?.id),
    "platform super admin cannot read the active LPG module.",
  );

  const { data: versionRecord, error: versionError } = await adminClient
    .from("business_module_versions")
    .select("id,module_id,version,status")
    .eq("module_id", moduleRecord!.id)
    .eq("version", 1)
    .eq("status", "active")
    .maybeSingle();

  if (versionError) {
    throw versionError;
  }

  requireCondition(
    Boolean(versionRecord?.id),
    "platform super admin cannot read active LPG module version 1.",
  );

  const { data: components, error: componentsError } = await adminClient
    .from("business_module_components")
    .select("component_type,component_key,status")
    .eq("module_version_id", versionRecord!.id)
    .eq("status", "active")
    .limit(1);

  if (componentsError) {
    throw componentsError;
  }

  requireCondition(
    (components ?? []).length > 0,
    "platform super admin cannot read active LPG module components.",
  );
}

async function requireRpcError(
  name: string,
  result: PromiseLike<{ error: { message: string } | null }>,
  expectedMessage: string,
): Promise<void> {
  const { error } = await result;

  requireCondition(Boolean(error), `${name} accepted an incomplete operation.`);
  requireCondition(
    error!.message.includes(expectedMessage),
    `${name} returned unexpected error: ${error!.message}`,
  );
}

async function runGate(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function createBrowserSafeClient(key: string): SupabaseClient {
  return createClient(supabaseUrl, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function createDeploymentClient(key: string): SupabaseClient {
  return createClient(supabaseUrl, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function createAuthenticatedClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

async function resolveAdminClient(): Promise<SupabaseClient | null> {
  if (adminAccessToken) {
    return createAuthenticatedClient(adminAccessToken);
  }

  if (!adminEmail || !adminPassword) {
    return null;
  }

  const signInClient = createBrowserSafeClient(anonKey);
  const { data, error } = await signInClient.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });

  if (error) {
    throw new Error(
      `Unable to sign in as the platform super admin: ${error.message}. Run npm run supabase:provision-admin with a fresh deployment-shell password, then rerun this gate.`,
    );
  }

  if (!data.session?.access_token) {
    throw new Error("Supabase Auth did not return an admin access token.");
  }

  return createAuthenticatedClient(data.session.access_token);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json();

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object response.");
  }

  return value as Record<string, unknown>;
}

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
