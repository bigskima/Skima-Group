const repositoryRoot = new URL("../", import.meta.url);

const [
  foundationSql,
  operationsSql,
  gatewaySource,
  workerSource,
  webhookSource,
  supabaseConfig,
] = await Promise.all([
  readRepositoryFile("supabase/migrations/20260829082943_station_inventory_runtime_foundation.sql"),
  readRepositoryFile("supabase/migrations/20260829143051_station_inventory_operations_runtime.sql"),
  readRepositoryFile("supabase/functions/api-gateway/index.ts"),
  readRepositoryFile("supabase/functions/runtime-worker/index.ts"),
  readRepositoryFile("supabase/functions/inventory-provider-webhook/index.ts"),
  readRepositoryFile("supabase/config.toml"),
]);

Deno.test("inventory schema keeps stock, reservations, capacity, and evidence normalized", () => {
  const normalizedFoundation = normalizeWhitespace(foundationSql);
  const normalizedOperations = normalizeWhitespace(operationsSql);
  const foundationTables = [
    "station_lpg_tanks",
    "station_inventory_configurations",
    "station_inventory_provider_connections",
    "station_inventory_telemetry_devices",
    "station_lpg_inventory_state",
    "station_lpg_tank_inventory_state",
    "station_inventory_observations",
    "station_inventory_events",
    "station_inventory_reservations",
    "station_inventory_reconciliation_cases",
    "station_inventory_operational_capacity",
  ];

  for (const table of foundationTables) {
    assertIncludes(
      normalizedFoundation,
      `create table if not exists public.${table} (`,
      `missing normalized inventory table ${table}`,
    );
    assertIncludes(
      normalizedFoundation,
      `alter table public.${table} enable row level security;`,
      `RLS is not enabled for ${table}`,
    );
  }

  for (
    const table of [
      "station_inventory_alert_states",
      "station_inventory_provider_webhook_receipts",
    ]
  ) {
    assertIncludes(
      normalizedOperations,
      `create table if not exists public.${table} (`,
      `missing operations table ${table}`,
    );
    assertIncludes(
      normalizedOperations,
      `alter table public.${table} enable row level security;`,
      `RLS is not enabled for ${table}`,
    );
  }

  assertIncludes(
    normalizedFoundation,
    "base_dispatchable_kg := greatest(least(resolved_allocation_kg, safely_usable_kg) - active_reserved_kg, 0);",
    "dispatchable stock must deduct active reservations",
  );
  assertIncludes(
    normalizedFoundation,
    "active_jobs < capacity_record.maximum_concurrent_jobs",
    "processing capacity must be evaluated separately from physical stock",
  );
  assertIncludes(
    normalizedFoundation,
    "select coalesce(sum(tank.usable_capacity_kg), branch_record.refill_capacity_kg, 0)",
    "installed capacity must aggregate multiple tanks",
  );
  assertIncludes(
    normalizedFoundation,
    "where adapter.provider_kind = 'inventory'",
    "inventory providers must resolve through the shared adapter catalog",
  );
  assertIncludes(
    normalizedFoundation,
    "create trigger prevent_station_inventory_event_update before update on public.station_inventory_events",
    "inventory ledger updates must be rejected",
  );
  assertIncludes(
    normalizedFoundation,
    "create trigger prevent_station_inventory_event_delete before delete on public.station_inventory_events",
    "inventory ledger deletes must be rejected",
  );
  assertIncludes(
    normalizedFoundation,
    "raise exception 'station inventory events are append-only';",
    "inventory ledger mutation guard is missing",
  );
});

Deno.test("inventory service RPCs enforce leases, replay safety, and service-only access", () => {
  const normalizedOperations = normalizeWhitespace(operationsSql);
  const claimFunction = sqlFunctionBlock(operationsSql, "claim_background_jobs");
  const finishFunction = sqlFunctionBlock(operationsSql, "finish_background_job");
  const webhookReceiptTable = sqlTableBlock(
    operationsSql,
    "station_inventory_provider_webhook_receipts",
  );

  assertMatch(
    claimFunction,
    /for update of job\s+skip locked/i,
    "background job claims must use SKIP LOCKED",
  );
  assertMatch(
    claimFunction,
    /locked_by\s*=\s*btrim\(target_worker_id\)/i,
    "background job claims must record their worker lease",
  );
  assertMatch(
    claimFunction,
    /locked_until\s*=\s*timezone\('utc', now\(\)\)\s*\+\s*make_interval/i,
    "background job claims must expire",
  );
  assertMatch(
    finishFunction,
    /job\.locked_by\s*=\s*btrim\(target_worker_id\)/i,
    "job completion must match the claiming worker",
  );
  assertIncludes(
    finishFunction,
    "background job lease is no longer owned by this worker",
    "stale workers must not complete reclaimed jobs",
  );
  assertMatch(
    finishFunction,
    /resolved_status\s*:=\s*'queued'[\s\S]*retry_policy\s*->\s*'backoff_seconds'/i,
    "failed jobs must use the queue's configured retry policy",
  );

  assertMatch(
    webhookReceiptTable,
    /unique\s*\(provider_connection_id, provider_event_reference\)/i,
    "provider event references must be replay-safe per connection",
  );
  assertNotIncludes(
    webhookReceiptTable.toLowerCase(),
    "raw_payload",
    "webhook receipts must not persist raw provider payloads",
  );

  const serviceFunctions = [
    "read_lpg_inventory_provider_runtime_context",
    "read_lpg_inventory_provider_webhook_context",
    "record_lpg_inventory_provider_sync_result",
    "begin_lpg_inventory_provider_webhook",
    "complete_lpg_inventory_provider_webhook",
    "run_lpg_inventory_maintenance",
    "claim_background_jobs",
    "finish_background_job",
  ];
  for (const functionName of serviceFunctions) {
    const functionSql = sqlFunctionBlock(operationsSql, functionName);
    assertMatch(
      functionSql,
      /security definer\s+set search_path\s*=\s*public(?:, extensions)?, pg_temp/i,
      `${functionName} must pin its search path`,
    );
    assertIncludes(
      normalizeWhitespace(functionSql),
      "if auth.role() <> 'service_role' then",
      `${functionName} must reject non-service callers`,
    );
    const escapedName = escapeRegExp(functionName);
    assertMatch(
      normalizedOperations,
      new RegExp(
        `revoke all on function public\\.${escapedName}\\([^;]+\\) from public, anon, authenticated;`,
        "i",
      ),
      `${functionName} must be revoked from public clients`,
    );
    assertMatch(
      normalizedOperations,
      new RegExp(
        `grant execute on function public\\.${escapedName}\\([^;]+\\) to service_role;`,
        "i",
      ),
      `${functionName} must be granted only to the backend role`,
    );
  }

  assertIncludes(
    normalizedOperations,
    "revoke all on table public.station_inventory_provider_webhook_receipts from public, anon, authenticated;",
    "webhook receipts must not be directly exposed",
  );
  assertNotIncludes(
    normalizedOperations,
    "grant select on table public.station_inventory_provider_webhook_receipts to authenticated",
    "authenticated clients must not read provider webhook receipts",
  );
});

Deno.test("API Gateway inventory routes are registered and call the intended RPCs", () => {
  const routeRpcPairs = [
    [
      "/lpg/stations/inventory/provider-connections/disconnect",
      "disconnect_lpg_inventory_provider",
    ],
    ["/lpg/stations/inventory/telemetry-devices", "upsert_lpg_inventory_telemetry_device"],
    [
      "/lpg/stations/inventory/operational-capacity",
      "configure_lpg_station_operational_capacity",
    ],
    ["/lpg/stations/inventory/availability", "set_lpg_station_inventory_availability"],
    [
      "/lpg/stations/inventory/manual-fallback/end",
      "end_lpg_station_inventory_manual_fallback",
    ],
    [
      "/lpg/stations/inventory/issues/unexpected-stockout",
      "report_lpg_inventory_unexpected_stockout",
    ],
    ["/admin/station-inventory/automation-policy", "configure_inventory_automation_policy"],
    ["/admin/station-inventory/override", "apply_lpg_inventory_admin_override"],
  ] as const;

  for (const [route, rpc] of routeRpcPairs) {
    assertIncludes(gatewaySource, `"${route}",`, `${route} is not registered`);
    const handler = gatewayRouteHandler(gatewaySource, route, "POST");
    assertIncludes(handler, `supabase.rpc("${rpc}"`, `${route} is not wired to ${rpc}`);
    assertIncludes(
      handler,
      "target_idempotency_key:",
      `${route} must require a retry-safe idempotency key`,
    );
  }

  for (
    const route of [
      "/lpg/stations/inventory/availability",
      "/lpg/stations/inventory/operational-capacity",
      "/admin/station-inventory/override",
    ]
  ) {
    assertIncludes(
      gatewayRouteHandler(gatewaySource, route, "POST"),
      "target_expected_version:",
      `${route} must forward its optimistic concurrency version`,
    );
  }

  const providerSetup = gatewayRouteHandler(
    gatewaySource,
    "/lpg/stations/inventory/provider-connections",
    "POST",
  );
  assertNotIncludes(
    providerSetup,
    "credentialSecret",
    "the public provider-setup route must not accept credentials",
  );
  assertNotIncludes(
    providerSetup,
    "serviceRole",
    "the public provider-setup route must not accept backend keys",
  );

  const adminRead = gatewayRouteHandler(gatewaySource, "/admin/station-inventory", "GET");
  assertIncludes(
    adminRead,
    'supabase.rpc("read_lpg_admin_inventory_operations"',
    "Admin inventory reads must use the governed read model",
  );
});

Deno.test("runtime worker uses provider-neutral configuration and an atomic job lease", () => {
  const backgroundJobs = typescriptFunctionBlock(workerSource, "processBackgroundJobs");
  const providerSync = typescriptFunctionBlock(workerSource, "processInventoryProviderSync");
  const safeUrl = typescriptFunctionBlock(workerSource, "safeInventoryProviderUrl");
  const providerHeaders = typescriptFunctionBlock(workerSource, "buildInventoryProviderHeaders");
  const providerSecret = typescriptFunctionBlock(workerSource, "resolveInventoryProviderSecret");
  const providerIngestion = sectionBetween(
    providerSync,
    'supabase.rpc("ingest_lpg_inventory_provider_observation"',
    "}));",
  );

  assertIncludes(
    backgroundJobs,
    'supabase.rpc("claim_background_jobs"',
    "worker must claim jobs atomically",
  );
  assertIncludes(backgroundJobs, "target_worker_id: workerId", "claim must identify its worker");
  assertIncludes(
    backgroundJobs,
    'job.jobTypeKey === "platform.inventory.maintenance"',
    "maintenance jobs are not handled",
  );
  assertIncludes(
    backgroundJobs,
    'job.jobTypeKey === "platform.inventory.provider_sync"',
    "provider jobs are not handled",
  );
  assertIncludes(
    backgroundJobs,
    'throw new Error("unsupported_background_job_type")',
    "unknown jobs must fail closed",
  );
  assertMatch(
    workerSource,
    /supabase\.rpc\("finish_background_job",\s*\{[\s\S]{0,500}?target_worker_id:\s*workerId/i,
    "job completion must submit the same worker lease",
  );

  assertIncludes(
    providerSync,
    "adapterConfig.polling",
    "polling behavior must come from adapter configuration",
  );
  assertIncludes(
    providerSync,
    "polling.responseMapping",
    "provider response mapping must be configurable",
  );
  assertIncludes(providerSync, 'redirect: "error"', "provider polling must reject redirects");
  assertIncludes(providerSync, "new AbortController()", "provider polling must enforce a timeout");
  assertIncludes(
    providerSync,
    "responseText.length > 1_000_000",
    "provider responses must be size bounded",
  );
  assertIncludes(
    providerSync,
    "responseDigest",
    "provider payloads must be represented by a digest",
  );
  assertNotIncludes(
    providerIngestion,
    "responseText",
    "raw provider responses must not be persisted",
  );
  assertNotIncludes(
    providerIngestion,
    "responseValue",
    "parsed provider responses must not be persisted",
  );

  assertIncludes(safeUrl, 'url.protocol !== "https:"', "provider polling must require HTTPS");
  assertIncludes(safeUrl, 'hostname === "localhost"', "provider polling must block localhost");
  assertMatch(safeUrl, /\^127\\\./, "provider polling must block loopback IPv4");
  assertMatch(safeUrl, /\^10\\\./, "provider polling must block private IPv4");
  assertIncludes(
    providerHeaders,
    "inventory_provider_secret_header_must_use_secret_ref",
    "sensitive headers must use secret references",
  );
  assertIncludes(
    providerSecret,
    "/^SUPABASE_SECRET:",
    "provider credentials must use the Supabase secret-reference namespace",
  );
  assertNotIncludes(
    providerSecret,
    "return secretRef",
    "secret references must never be mistaken for credential values",
  );
});

Deno.test("public inventory webhook verifies authenticity before normalized ingestion", () => {
  const functionConfig = tomlFunctionSection(supabaseConfig, "inventory-provider-webhook");
  const secretResolver = typescriptFunctionBlock(webhookSource, "resolveSecret");
  const ingestion = sectionBetween(
    webhookSource,
    '"ingest_lpg_inventory_provider_observation"',
    "));",
  );

  assertMatch(
    functionConfig,
    /verify_jwt\s*=\s*false/,
    "external webhooks must bypass JWT validation",
  );
  assertIncludes(
    webhookSource,
    'request.method !== "POST"',
    "webhook must reject unsupported methods",
  );
  assertIncludes(
    webhookSource,
    "const MAX_BODY_BYTES = 1_000_000",
    "webhook body size must be bounded",
  );
  assertIncludes(
    webhookSource,
    'new WebhookError("signature_required", 401)',
    "webhook signatures must be required",
  );
  assertIncludes(
    webhookSource,
    "maximumSkewSeconds",
    "webhook timestamps must have a replay window",
  );
  assertIncludes(
    webhookSource,
    "await hmacSha256(secret, signaturePayload)",
    "webhook must compute an HMAC",
  );
  assertIncludes(
    webhookSource,
    "constantTimeEqual",
    "webhook signatures must use constant-time comparison",
  );
  assertIncludes(
    webhookSource,
    'target_policy_key: "webhook.inventory-provider.default"',
    "webhook rate limiting is missing",
  );
  assertIncludes(
    webhookSource,
    'supabase.rpc("begin_lpg_inventory_provider_webhook"',
    "webhook receipt must start before ingestion",
  );
  assertIncludes(
    webhookSource,
    "begin.duplicate === true",
    "duplicate webhooks must be acknowledged safely",
  );
  assertIncludes(
    webhookSource,
    'supabase.rpc("complete_lpg_inventory_provider_webhook"',
    "webhook receipts must be completed",
  );
  assertIncludes(ingestion, "target_payload:", "normalized ingestion metadata is missing");
  assertIncludes(
    ingestion,
    "responseDigest: payloadDigest",
    "ingestion must retain a payload digest",
  );
  for (const sensitiveValue of ["rawBody", "suppliedSignature", "secret", "sourceIp(request)"]) {
    assertNotIncludes(
      ingestion,
      sensitiveValue,
      `${sensitiveValue} must not be persisted with observations`,
    );
  }

  assertIncludes(
    secretResolver,
    "/^SUPABASE_SECRET:",
    "webhook credentials must use the Supabase secret-reference namespace",
  );
  assertIncludes(
    webhookSource,
    "signatureDigest",
    "only a signature digest should enter the receipt ledger",
  );
  assertIncludes(
    webhookSource,
    "sourceIpHash",
    "source addresses must be hashed before persistence",
  );
  assertNotIncludes(
    webhookSource,
    "console.error(error)",
    "webhook logs must not emit raw exceptions",
  );
  assertNotIncludes(
    webhookSource,
    "console.error(rawBody)",
    "webhook logs must not emit provider payloads",
  );
});

async function readRepositoryFile(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path.replaceAll("\\", "/"), repositoryRoot));
}

function normalizeWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim().toLowerCase();
}

function assertIncludes(source: string, expected: string, message: string): void {
  if (!source.includes(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}`);
  }
}

function assertNotIncludes(source: string, unexpected: string, message: string): void {
  if (source.includes(unexpected)) {
    throw new Error(`${message}: found ${JSON.stringify(unexpected)}`);
  }
}

function assertMatch(source: string, pattern: RegExp, message: string): void {
  if (!pattern.test(source)) {
    throw new Error(`${message}: expected ${pattern}`);
  }
}

function sqlFunctionBlock(source: string, name: string): string {
  return sectionUntilNext(
    source,
    `create or replace function public.${name}(`,
    /\ncreate or replace function public\./g,
    `SQL function ${name}`,
  );
}

function sqlTableBlock(source: string, name: string): string {
  return sectionUntilNext(
    source,
    `create table if not exists public.${name} (`,
    /\ncreate (?:table|index|unique index)|\nalter table|\ninsert into|\ndrop trigger/g,
    `SQL table ${name}`,
  );
}

function typescriptFunctionBlock(source: string, name: string): string {
  const asyncMarker = `async function ${name}(`;
  const marker = source.includes(asyncMarker) ? asyncMarker : `function ${name}(`;
  return sectionUntilNext(
    source,
    marker,
    /\n(?:async )?function [A-Za-z0-9_]+\(/g,
    `TypeScript function ${name}`,
  );
}

function gatewayRouteHandler(source: string, route: string, method: "GET" | "POST"): string {
  return sectionUntilNext(
    source,
    `if (routePath === "${route}" && request.method === "${method}") {`,
    /\n {2}if \(routePath === /g,
    `${method} ${route} handler`,
  );
}

function tomlFunctionSection(source: string, name: string): string {
  return sectionUntilNext(
    source,
    `[functions.${name}]`,
    /\n\[/g,
    `Supabase function configuration ${name}`,
  );
}

function sectionBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`missing section marker ${JSON.stringify(startMarker)}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`missing section terminator ${JSON.stringify(endMarker)}`);
  return source.slice(start, end + endMarker.length);
}

function sectionUntilNext(
  source: string,
  marker: string,
  nextPattern: RegExp,
  description: string,
): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing ${description}`);
  nextPattern.lastIndex = start + marker.length;
  const next = nextPattern.exec(source);
  return source.slice(start, next?.index ?? source.length);
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
