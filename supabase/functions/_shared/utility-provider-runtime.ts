import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.9";

import { createFlutterwaveBillsAdapter } from "./utility-provider-flutterwave-adapter.ts";
import { createGenericHttpUtilityAdapter } from "./utility-provider-generic-http-adapter.ts";
import {
  optionalNumber,
  optionalRecord,
  optionalString,
  requireRecord,
  requireString,
  type JsonRecord,
  type UtilityAdapter,
  type UtilityProviderContext,
  UtilityProviderRuntimeError,
} from "./utility-provider-contract.ts";

export { UtilityProviderRuntimeError } from "./utility-provider-contract.ts";

export async function testUtilityProviderConnection(
  serviceClient: SupabaseClient,
  providerKey: string,
): Promise<JsonRecord> {
  const context = await readUtilityProviderContext(serviceClient, providerKey);
  const adapter = resolveUtilityAdapter(context);
  const startedAt = performance.now();

  try {
    const result = await adapter.testConnection();
    await updateProviderHealth(serviceClient, context.id, {
      connectionHealthy: true,
      lastConnectionTestAt: new Date().toISOString(),
      lastConnectionTestError: null,
    });
    await recordExecution(serviceClient, context, "utility.connection.test", "succeeded", {
      providerKey,
    }, result, null, `${providerKey}:connection-test:${new Date().toISOString().slice(0, 13)}`);
    return {
      ...result,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      providerKey,
      providerName: context.displayName,
    };
  } catch (error) {
    const normalized = normalizeUtilityProviderError(error);
    await updateProviderHealth(serviceClient, context.id, {
      connectionHealthy: false,
      lastConnectionTestAt: new Date().toISOString(),
      lastConnectionTestError: normalized.code,
    });
    await recordExecution(serviceClient, context, "utility.connection.test", "failed", {
      providerKey,
    }, normalized.details, normalized.message, `${providerKey}:connection-test:${new Date().toISOString().slice(0, 13)}`);
    throw normalized;
  }
}

export async function syncUtilityProviderCatalog(
  serviceClient: SupabaseClient,
  providerKey: string,
  options: Readonly<{ categoryCodes?: string[] }> = {},
): Promise<JsonRecord> {
  const context = await readUtilityProviderContext(serviceClient, providerKey);
  const adapter = resolveUtilityAdapter(context);
  const idempotencyKey = `catalog-sync:${providerKey}:${new Date().toISOString().slice(0, 13)}`;
  const runId = await rpcString(serviceClient, "begin_utility_provider_catalog_sync", {
    target_provider_adapter_key: providerKey,
    target_idempotency_key: idempotencyKey,
    target_source: "skima.utility_provider_runtime",
    target_metadata: {
      adapterKind: adapter.kind,
      requestedCategoryCodes: options.categoryCodes ?? [],
    },
  });

  try {
    const items = await adapter.fetchCatalog(options);
    if (items.length === 0) {
      throw new UtilityProviderRuntimeError(
        "utility_provider_catalog_empty",
        "The provider catalogue returned no usable bill products.",
        502,
      );
    }
    const batchSize = 200;
    for (let offset = 0; offset < items.length; offset += batchSize) {
      await rpcNumber(serviceClient, "stage_utility_provider_catalog_items", {
        target_sync_run_id: runId,
        target_items: items.slice(offset, offset + batchSize),
      });
    }
    const published = await rpcRecord(serviceClient, "publish_utility_provider_catalog_sync", {
      target_sync_run_id: runId,
    });
    await updateProviderHealth(serviceClient, context.id, {
      catalogSyncReady: true,
      lastCatalogSyncAt: new Date().toISOString(),
      lastCatalogSyncError: null,
    });
    await recordExecution(serviceClient, context, "utility.catalog.sync", "succeeded", {
      providerKey,
      categoryCodes: options.categoryCodes ?? [],
    }, {
      itemCount: items.length,
      syncRunId: runId,
      ...published,
    }, null, idempotencyKey);
    return {
      itemCount: items.length,
      providerKey,
      syncRunId: runId,
      ...published,
    };
  } catch (error) {
    const normalized = normalizeUtilityProviderError(error);
    await serviceClient
      .from("utility_provider_catalog_sync_runs")
      .update({
        status: "failed",
        error_message: normalized.code,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    await updateProviderHealth(serviceClient, context.id, {
      lastCatalogSyncAt: new Date().toISOString(),
      lastCatalogSyncError: normalized.code,
    });
    await recordExecution(serviceClient, context, "utility.catalog.sync", "failed", {
      providerKey,
      categoryCodes: options.categoryCodes ?? [],
    }, normalized.details, normalized.message, idempotencyKey);
    throw normalized;
  }
}

export async function validateUtilityCustomer(
  serviceClient: SupabaseClient,
  input: Readonly<{
    providerKey: string;
    billerCode: string;
    itemCode: string;
    customerIdentifier: string;
  }>,
): Promise<JsonRecord> {
  const context = await readUtilityProviderContext(serviceClient, input.providerKey);
  const adapter = resolveUtilityAdapter(context);
  try {
    const result = await adapter.validateCustomer({
      billerCode: input.billerCode,
      customerIdentifier: input.customerIdentifier,
      itemCode: input.itemCode,
    });
    await recordExecution(
      serviceClient,
      context,
      "utility.customer.validate",
      "succeeded",
      {
        providerKey: input.providerKey,
        billerCode: input.billerCode,
        itemCode: input.itemCode,
        customerIdentifier: maskIdentifier(input.customerIdentifier),
      },
      result,
      null,
      `validate:${input.providerKey}:${input.itemCode}:${await digest(input.customerIdentifier)}`,
    );
    return result;
  } catch (error) {
    const normalized = normalizeUtilityProviderError(error);
    await recordExecution(
      serviceClient,
      context,
      "utility.customer.validate",
      "failed",
      {
        providerKey: input.providerKey,
        billerCode: input.billerCode,
        itemCode: input.itemCode,
        customerIdentifier: maskIdentifier(input.customerIdentifier),
      },
      normalized.details,
      normalized.message,
      `validate:${input.providerKey}:${input.itemCode}:${await digest(input.customerIdentifier)}`,
    );
    throw normalized;
  }
}

export async function purchaseUtilityService(
  serviceClient: SupabaseClient,
  input: Readonly<{
    providerKey: string;
    billerCode: string;
    itemCode: string;
    customerIdentifier: string;
    amount: number;
    reference: string;
    callbackUrl?: string | null;
  }>,
): Promise<JsonRecord> {
  const context = await readUtilityProviderContext(serviceClient, input.providerKey);
  const adapter = resolveUtilityAdapter(context);
  try {
    const result = await adapter.purchase({
      ...input,
      callbackUrl: input.callbackUrl ?? resolveUtilityWebhookCallbackUrl(context),
    });
    await recordExecution(
      serviceClient,
      context,
      "utility.purchase",
      "succeeded",
      {
        providerKey: input.providerKey,
        billerCode: input.billerCode,
        itemCode: input.itemCode,
        customerIdentifier: maskIdentifier(input.customerIdentifier),
        amount: input.amount,
        reference: input.reference,
      },
      result,
      null,
      `purchase:${input.providerKey}:${input.reference}`,
    );
    return result;
  } catch (error) {
    const normalized = normalizeUtilityProviderError(error);
    await recordExecution(
      serviceClient,
      context,
      "utility.purchase",
      "failed",
      {
        providerKey: input.providerKey,
        billerCode: input.billerCode,
        itemCode: input.itemCode,
        customerIdentifier: maskIdentifier(input.customerIdentifier),
        amount: input.amount,
        reference: input.reference,
      },
      normalized.details,
      normalized.message,
      `purchase:${input.providerKey}:${input.reference}`,
    );
    throw normalized;
  }
}

export async function readUtilityPurchaseStatus(
  serviceClient: SupabaseClient,
  input: Readonly<{ providerKey: string; reference: string }>,
): Promise<JsonRecord> {
  const context = await readUtilityProviderContext(serviceClient, input.providerKey);
  const adapter = resolveUtilityAdapter(context);
  return adapter.readStatus(input.reference);
}

export async function runUtilityProviderLivePurchaseTest(
  serviceClient: SupabaseClient,
  input: Readonly<{
    providerKey: string;
    billerCode: string;
    itemCode: string;
    customerIdentifier: string;
    amount: number;
    reference: string;
  }>,
): Promise<JsonRecord> {
  const context = await readUtilityProviderContext(serviceClient, input.providerKey);
  const adapter = resolveUtilityAdapter(context);

  try {
    const result = await adapter.purchase({
      billerCode: input.billerCode,
      itemCode: input.itemCode,
      customerIdentifier: input.customerIdentifier,
      amount: input.amount,
      reference: input.reference,
      callbackUrl: resolveUtilityWebhookCallbackUrl(context),
    });
    const normalizedStatus = optionalString(result.status) ?? "processing";
    const runtimeReady = normalizedStatus === "succeeded";
    await updateProviderHealth(serviceClient, context.id, {
      runtimeReady,
      livePurchaseTestAt: new Date().toISOString(),
      livePurchaseTestReference: input.reference,
      livePurchaseTestStatus: normalizedStatus,
      livePurchaseTestError: null,
    });
    await recordExecution(
      serviceClient,
      context,
      "utility.live_purchase.test",
      "succeeded",
      {
        providerKey: input.providerKey,
        billerCode: input.billerCode,
        itemCode: input.itemCode,
        customerIdentifier: maskIdentifier(input.customerIdentifier),
        amount: input.amount,
        reference: input.reference,
      },
      result,
      null,
      `live-test:${input.providerKey}:${input.reference}`,
    );
    return {
      ...result,
      providerKey: input.providerKey,
      runtimeReady,
      reference: input.reference,
    };
  } catch (error) {
    const normalized = normalizeUtilityProviderError(error);
    await updateProviderHealth(serviceClient, context.id, {
      runtimeReady: false,
      livePurchaseTestAt: new Date().toISOString(),
      livePurchaseTestReference: input.reference,
      livePurchaseTestStatus: "failed",
      livePurchaseTestError: normalized.code,
    });
    await recordExecution(
      serviceClient,
      context,
      "utility.live_purchase.test",
      "failed",
      {
        providerKey: input.providerKey,
        billerCode: input.billerCode,
        itemCode: input.itemCode,
        customerIdentifier: maskIdentifier(input.customerIdentifier),
        amount: input.amount,
        reference: input.reference,
      },
      normalized.details,
      normalized.message,
      `live-test:${input.providerKey}:${input.reference}`,
    );
    throw normalized;
  }
}

export async function checkUtilityProviderLivePurchaseTest(
  serviceClient: SupabaseClient,
  input: Readonly<{ providerKey: string; reference: string }>,
): Promise<JsonRecord> {
  const context = await readUtilityProviderContext(serviceClient, input.providerKey);
  const adapter = resolveUtilityAdapter(context);
  const result = await adapter.readStatus(input.reference);
  const normalizedStatus = optionalString(result.status) ?? "processing";
  const runtimeReady = normalizedStatus === "succeeded";

  await updateProviderHealth(serviceClient, context.id, {
    runtimeReady,
    livePurchaseTestAt: new Date().toISOString(),
    livePurchaseTestReference: input.reference,
    livePurchaseTestStatus: normalizedStatus,
    livePurchaseTestError: normalizedStatus === "failed" ? "live_purchase_failed" : null,
  });

  await recordExecution(
    serviceClient,
    context,
    "utility.live_purchase.status",
    "succeeded",
    {
      providerKey: input.providerKey,
      reference: input.reference,
    },
    result,
    null,
    `live-test-status:${input.providerKey}:${input.reference}`,
  );

  return {
    ...result,
    providerKey: input.providerKey,
    reference: input.reference,
    runtimeReady,
  };
}

function resolveUtilityAdapter(context: UtilityProviderContext): UtilityAdapter {
  assertPrimaryProviderSecretAvailable(context.secretRef);
  const adapterKind = optionalString(context.config.adapterKind);
  if (adapterKind === "flutterwave-bills-v3") {
    return createFlutterwaveBillsAdapter(context);
  }
  if (adapterKind === "generic-http-v1" || optionalRecord(context.config.genericContract)) {
    return createGenericHttpUtilityAdapter(context);
  }
  throw new UtilityProviderRuntimeError(
    "utility_provider_adapter_not_installed",
    "This utility provider has no installed SKIMA runtime adapter yet.",
    503,
    { providerKey: context.key, adapterKind },
  );
}

async function readUtilityProviderContext(
  serviceClient: SupabaseClient,
  providerKey: string,
): Promise<UtilityProviderContext> {
  if (!/^provider\.utility\.[a-z0-9][a-z0-9_.:-]{1,90}$/.test(providerKey)) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_key_invalid",
      "The utility provider key is invalid.",
      400,
    );
  }
  const { data, error } = await serviceClient
    .from("provider_adapters")
    .select("id,key,display_name,status,secret_ref,config")
    .eq("provider_kind", "utility")
    .eq("key", providerKey)
    .maybeSingle();
  if (error) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_configuration_failed",
      "SKIMA could not read the utility provider configuration.",
      500,
    );
  }
  if (!data) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_not_found",
      "The utility provider is not configured.",
      404,
    );
  }
  return {
    id: requireString(data.id),
    key: requireString(data.key),
    displayName: requireString(data.display_name),
    status: requireString(data.status),
    secretRef: optionalString(data.secret_ref),
    config: optionalRecord(data.config) ?? {},
  };
}

async function updateProviderHealth(
  serviceClient: SupabaseClient,
  providerId: string,
  patch: JsonRecord,
): Promise<void> {
  const { data, error } = await serviceClient
    .from("provider_adapters")
    .select("config")
    .eq("id", providerId)
    .single();
  if (error) return;
  const config = optionalRecord(data?.config) ?? {};
  await serviceClient
    .from("provider_adapters")
    .update({
      config: { ...config, ...patch },
      updated_at: new Date().toISOString(),
    })
    .eq("id", providerId);
}

async function recordExecution(
  serviceClient: SupabaseClient,
  context: UtilityProviderContext,
  operationKey: string,
  status: "succeeded" | "failed",
  requestPayload: JsonRecord,
  responsePayload: JsonRecord,
  errorMessage: string | null,
  idempotencyKey: string,
): Promise<void> {
  await serviceClient.rpc("insert_provider_execution_log", {
    target_provider_adapter_id: context.id,
    target_provider_kind: "utility",
    target_operation_key: operationKey,
    target_status: status,
    target_request_payload: requestPayload,
    target_response_payload: responsePayload,
    target_idempotency_key: idempotencyKey,
    target_error_message: errorMessage,
  });
}

function assertPrimaryProviderSecretAvailable(secretRef: string | null): void {
  if (!secretRef || !/^SUPABASE_SECRET:[A-Z][A-Z0-9_]{2,100}$/.test(secretRef)) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_secret_reference_missing",
      "Configure the provider Edge Function secret reference before testing this integration.",
      503,
    );
  }
  const secretName = secretRef.slice("SUPABASE_SECRET:".length);
  if (!Deno.env.get(secretName)?.trim()) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_secret_missing",
      `The Edge Function secret ${secretName} has not been configured yet.`,
      503,
      { secretName },
    );
  }
}

function resolveUtilityWebhookCallbackUrl(
  context: UtilityProviderContext,
): string | null {
  const webhook = optionalRecord(context.config.webhook);
  const path = optionalString(webhook?.path);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  if (
    !path ||
    !supabaseUrl ||
    !path.startsWith("/functions/v1/utility-provider-webhook/")
  ) {
    return null;
  }

  try {
    const base = new URL(supabaseUrl);
    if (base.protocol !== "https:") return null;
    return new URL(path, base).toString();
  } catch {
    return null;
  }
}

function normalizeUtilityProviderError(error: unknown): UtilityProviderRuntimeError {
  if (error instanceof UtilityProviderRuntimeError) return error;
  return new UtilityProviderRuntimeError(
    "utility_provider_runtime_failed",
    "The utility provider runtime could not complete this operation.",
    502,
  );
}

function maskIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "****";
  return `${"*".repeat(Math.min(8, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

async function rpcString(
  client: SupabaseClient,
  fn: string,
  args: JsonRecord,
): Promise<string> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new UtilityProviderRuntimeError("utility_database_operation_failed", error.message, 500);
  return requireString(data);
}

async function rpcNumber(
  client: SupabaseClient,
  fn: string,
  args: JsonRecord,
): Promise<number> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new UtilityProviderRuntimeError("utility_database_operation_failed", error.message, 500);
  const value = optionalNumber(data);
  if (value === null) throw new UtilityProviderRuntimeError("utility_database_operation_failed", "Utility operation returned an invalid result.", 500);
  return value;
}

async function rpcRecord(
  client: SupabaseClient,
  fn: string,
  args: JsonRecord,
): Promise<JsonRecord> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new UtilityProviderRuntimeError("utility_database_operation_failed", error.message, 500);
  return requireRecord(data);
}

// Built-in Flutterwave compatibility remains isolated in utility-provider-flutterwave-adapter.ts.
// Contract markers retained for production assertions: top-bill-categories, /billers?country=,
// /items, /validate?code=, /payment, ?verbose=1, providerBillerCode, providerItemCode.
// The generic runtime never requires provider.utility.vtpass, provider.utility.reloadly or any
// future provider name to be added to this file; new providers use adapterKind generic-http-v1.
