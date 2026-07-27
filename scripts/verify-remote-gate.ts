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

const adminClient = await resolveAdminClient();

if (adminClient) {
  await runGate(
    "real platform super admin can read governed records",
    () => verifyPlatformAdminReadAccess(adminClient),
  );
} else {
  console.log(
    "No real admin session credentials found; real-admin RLS verification remains pending.",
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
