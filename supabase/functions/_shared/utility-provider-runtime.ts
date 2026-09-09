import type { SupabaseClient } from "npm:@supabase/supabase-js@2.110.9";

type JsonRecord = Readonly<Record<string, unknown>>;

type UtilityProviderContext = Readonly<{
  id: string;
  key: string;
  displayName: string;
  status: string;
  secretRef: string | null;
  config: JsonRecord;
}>;

type UtilityCatalogItem = Readonly<{
  itemType: "category" | "biller" | "product";
  externalKey: string;
  canonicalKey: string;
  canonicalParentKey?: string | null;
  displayName: string;
  providerProductCode?: string | null;
  amountMode?: "customer" | "fixed" | "provider" | null;
  fixedAmount?: number | null;
  minimumAmount?: number | null;
  maximumAmount?: number | null;
  currencyCode?: string;
  customerIdentifierLabel?: string | null;
  customerIdentifierHint?: string | null;
  normalizedPayload?: JsonRecord;
  rawPayload?: JsonRecord;
  status?: "available" | "unavailable";
}>;

export class UtilityProviderRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
    readonly details: JsonRecord = {},
  ) {
    super(message);
    this.name = "UtilityProviderRuntimeError";
  }
}

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
    const result = await adapter.purchase(input);
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

type UtilityAdapter = Readonly<{
  kind: string;
  testConnection(): Promise<JsonRecord>;
  fetchCatalog(options: Readonly<{ categoryCodes?: string[] }>): Promise<UtilityCatalogItem[]>;
  validateCustomer(input: Readonly<{
    billerCode: string;
    itemCode: string;
    customerIdentifier: string;
  }>): Promise<JsonRecord>;
  purchase(input: Readonly<{
    billerCode: string;
    itemCode: string;
    customerIdentifier: string;
    amount: number;
    reference: string;
    callbackUrl?: string | null;
  }>): Promise<JsonRecord>;
  readStatus(reference: string): Promise<JsonRecord>;
}>;

function resolveUtilityAdapter(context: UtilityProviderContext): UtilityAdapter {
  const adapterKind = optionalString(context.config.adapterKind);
  if (adapterKind === "flutterwave-bills-v3") {
    return createFlutterwaveBillsAdapter(context);
  }
  throw new UtilityProviderRuntimeError(
    "utility_provider_adapter_not_installed",
    "This utility provider has no installed SKIMA runtime adapter yet.",
    503,
    { providerKey: context.key, adapterKind },
  );
}

function createFlutterwaveBillsAdapter(context: UtilityProviderContext): UtilityAdapter {
  const secret = resolveEdgeSecret(context.secretRef);
  const baseUrl = safeApiBaseUrl(
    optionalString(context.config.baseUrl) ?? "https://api.flutterwave.com/v3",
    ["api.flutterwave.com"],
  );
  const country = optionalString(context.config.country) ?? "NG";

  const request = async (
    path: string,
    init: RequestInit = {},
  ): Promise<JsonRecord> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(new URL(path, baseUrl), {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${secret}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
        redirect: "error",
        signal: controller.signal,
      });
      const bodyText = await response.text();
      if (bodyText.length > 1_500_000) {
        throw new UtilityProviderRuntimeError(
          "utility_provider_response_too_large",
          "The utility provider returned an unexpectedly large response.",
          502,
          { providerHttpStatus: response.status },
        );
      }
      let body: unknown = {};
      if (bodyText) {
        try {
          body = JSON.parse(bodyText);
        } catch {
          throw new UtilityProviderRuntimeError(
            "utility_provider_invalid_json",
            "The utility provider returned an invalid response.",
            502,
            { providerHttpStatus: response.status },
          );
        }
      }
      const record = requireRecord(body);
      if (!response.ok || optionalString(record.status)?.toLowerCase() === "error") {
        const providerMessage =
          optionalString(record.message) ??
          optionalString(record.error) ??
          "The utility provider could not complete the request.";
        throw new UtilityProviderRuntimeError(
          response.status === 401 || response.status === 403
            ? "utility_provider_authentication_failed"
            : response.status === 429
            ? "utility_provider_rate_limited"
            : "utility_provider_request_failed",
          providerMessage,
          response.status >= 400 && response.status < 600 ? response.status : 502,
          {
            providerHttpStatus: response.status,
            providerMessage,
          },
        );
      }
      return record;
    } catch (error) {
      if (error instanceof UtilityProviderRuntimeError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new UtilityProviderRuntimeError(
          "utility_provider_timeout",
          "The utility provider took too long to respond.",
          504,
        );
      }
      throw new UtilityProviderRuntimeError(
        "utility_provider_network_failed",
        "SKIMA could not reach the utility provider.",
        502,
      );
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    kind: "flutterwave-bills-v3",
    async testConnection() {
      const response = await request(`top-bill-categories?country=${encodeURIComponent(country)}`);
      const categories = dataArray(response);
      return {
        adapterKind: "flutterwave-bills-v3",
        categoryCount: categories.length,
        country,
        healthy: true,
      };
    },
    async fetchCatalog(options) {
      const categoryResponse = await request(
        `top-bill-categories?country=${encodeURIComponent(country)}`,
      );
      const categoryRecords = dataArray(categoryResponse);
      const requested = new Set(
        (options.categoryCodes ?? []).map((value) => value.trim().toUpperCase()).filter(Boolean),
      );
      const selectedCategories = requested.size === 0
        ? categoryRecords
        : categoryRecords.filter((item) => requested.has(requireString(item.code).toUpperCase()));

      const result: UtilityCatalogItem[] = [];
      for (const category of selectedCategories.slice(0, 50)) {
        const categoryCode = requireString(category.code);
        const categoryName = optionalString(category.name) ?? categoryCode;
        const categoryKey = canonicalFlutterwaveCategory(categoryCode, categoryName);
        result.push({
          itemType: "category",
          externalKey: categoryCode,
          canonicalKey: categoryKey,
          displayName: categoryName,
          currencyCode: "NGN",
          normalizedPayload: {
            description: optionalString(category.description),
            providerCategoryCode: categoryCode,
          },
          rawPayload: category,
        });

        const billerResponse = await request(
          `bills/${encodeURIComponent(categoryCode)}/billers?country=${encodeURIComponent(country)}`,
        );
        const billers = dataArray(billerResponse).slice(0, 500);
        for (const biller of billers) {
          const billerCode =
            optionalString(biller.biller_code) ??
            optionalString(biller.code) ??
            requireString(biller.id);
          const billerName =
            optionalString(biller.name) ??
            optionalString(biller.short_name) ??
            billerCode;
          const billerKey = `${categoryKey}.${slug(billerName)}`;
          result.push({
            itemType: "biller",
            externalKey: billerCode,
            canonicalKey: billerKey,
            canonicalParentKey: categoryKey,
            displayName: billerName,
            currencyCode: "NGN",
            customerIdentifierLabel:
              optionalString(biller.label_name) ??
              defaultIdentifierLabel(categoryKey),
            customerIdentifierHint:
              optionalString(biller.label_description) ??
              defaultIdentifierHint(categoryKey),
            normalizedPayload: {
              providerBillerCode: billerCode,
              providerCategoryCode: categoryCode,
              shortName: optionalString(biller.short_name),
            },
            rawPayload: biller,
          });

          const itemsResponse = await request(
            `billers/${encodeURIComponent(billerCode)}/items`,
          );
          const items = dataArray(itemsResponse).slice(0, 2_000);
          for (const item of items) {
            const itemCode =
              optionalString(item.item_code) ??
              optionalString(item.code) ??
              requireString(item.id);
            const itemName =
              optionalString(item.name) ??
              optionalString(item.product_name) ??
              itemCode;
            const amount = optionalNumber(item.amount);
            const fixedFlag =
              optionalBoolean(item.is_amount_fixed) ??
              optionalBoolean(item.is_fixed_amount) ??
              false;
            const amountMode: "customer" | "fixed" =
              fixedFlag || (amount !== null && amount > 0) ? "fixed" : "customer";
            result.push({
              itemType: "product",
              externalKey: `${billerCode}:${itemCode}`,
              canonicalKey: `${billerKey}.${slug(itemName)}`,
              canonicalParentKey: billerKey,
              displayName: itemName,
              providerProductCode: itemCode,
              amountMode,
              fixedAmount: amountMode === "fixed" ? amount : null,
              minimumAmount: optionalNumber(item.minimum),
              maximumAmount: optionalNumber(item.maximum),
              currencyCode: optionalString(item.currency) ?? "NGN",
              customerIdentifierLabel:
                optionalString(item.label_name) ??
                optionalString(biller.label_name) ??
                defaultIdentifierLabel(categoryKey),
              normalizedPayload: {
                providerBillerCode: billerCode,
                providerCategoryCode: categoryCode,
                providerItemCode: itemCode,
                providerFee: optionalNumber(item.fee),
                providerCommission: optionalNumber(item.commission),
              },
              rawPayload: item,
            });
          }
        }
      }
      return result;
    },
    async validateCustomer(input) {
      const response = await request(
        `bill-items/${encodeURIComponent(input.itemCode)}/validate?code=${encodeURIComponent(input.billerCode)}&customer=${encodeURIComponent(input.customerIdentifier)}`,
      );
      const data = optionalRecord(response.data) ?? response;
      return {
        valid: true,
        customerIdentifier: input.customerIdentifier,
        customerName: optionalString(data.name),
        address: optionalString(data.address),
        billerCode: optionalString(data.biller_code) ?? input.billerCode,
        productCode: optionalString(data.product_code) ?? input.itemCode,
        fee: optionalNumber(data.fee),
        minimum: optionalNumber(data.minimum),
        maximum: optionalNumber(data.maximum),
        providerResponseMessage:
          optionalString(data.response_message) ??
          optionalString(response.message),
      };
    },
    async purchase(input) {
      const response = await request(
        `billers/${encodeURIComponent(input.billerCode)}/items/${encodeURIComponent(input.itemCode)}/payment`,
        {
          method: "POST",
          body: JSON.stringify({
            country,
            customer_id: input.customerIdentifier,
            amount: input.amount,
            reference: input.reference,
            ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
          }),
        },
      );
      const data = optionalRecord(response.data) ?? response;
      return {
        status: normalizeFlutterwaveBillStatus(data),
        providerReference:
          optionalString(data.flw_ref) ??
          optionalString(data.tx_ref) ??
          optionalString(data.reference) ??
          input.reference,
        customerReference:
          optionalString(data.customer_reference) ??
          optionalString(data.tx_ref) ??
          input.reference,
        amount: optionalNumber(data.amount) ?? input.amount,
        fee: optionalNumber(data.fee),
        commission: optionalNumber(data.commission),
        token: optionalString(data.extra),
        rawStatus: optionalString(data.status),
      };
    },
    async readStatus(reference) {
      const response = await request(
        `bills/${encodeURIComponent(reference)}?verbose=1`,
      );
      const data = optionalRecord(response.data) ?? response;
      return {
        status: normalizeFlutterwaveBillStatus(data),
        providerReference:
          optionalString(data.flw_ref) ??
          optionalString(data.tx_ref) ??
          reference,
        customerReference:
          optionalString(data.customer_reference) ??
          optionalString(data.tx_ref) ??
          reference,
        amount: optionalNumber(data.amount),
        fee: optionalNumber(data.fee),
        commission: optionalNumber(data.commission),
        token: optionalString(data.extra),
        rawStatus:
          optionalString(data.status) ??
          optionalString(data.response_message),
      };
    },
  };
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

function resolveEdgeSecret(secretRef: string | null): string {
  if (!secretRef || !/^SUPABASE_SECRET:[A-Z][A-Z0-9_]{2,100}$/.test(secretRef)) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_secret_reference_missing",
      "Configure the provider Edge Function secret reference before testing this integration.",
      503,
    );
  }
  const secretName = secretRef.slice("SUPABASE_SECRET:".length);
  const value = Deno.env.get(secretName)?.trim();
  if (!value) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_secret_missing",
      `The Edge Function secret ${secretName} has not been configured yet.`,
      503,
      { secretName },
    );
  }
  return value;
}

function safeApiBaseUrl(value: string, allowedHosts: string[]): URL {
  let url: URL;
  try {
    url = new URL(value.endsWith("/") ? value : `${value}/`);
  } catch {
    throw new UtilityProviderRuntimeError(
      "utility_provider_base_url_invalid",
      "The utility provider API URL is invalid.",
      500,
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !allowedHosts.includes(url.hostname.toLowerCase())
  ) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_base_url_invalid",
      "The utility provider API URL is not an approved HTTPS endpoint.",
      500,
    );
  }
  return url;
}

function dataArray(response: JsonRecord): JsonRecord[] {
  if (!Array.isArray(response.data)) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_catalog_invalid",
      "The utility provider returned an unexpected catalogue response.",
      502,
    );
  }
  return response.data.map(requireRecord);
}

function canonicalFlutterwaveCategory(code: string, name: string): string {
  const normalizedCode = code.trim().toUpperCase();
  const aliases: Record<string, string> = {
    AIRTIME: "airtime",
    MOBILEDATA: "data",
    UTILITYBILLS: "electricity",
    CABLEBILLS: "cable-tv",
    INTSERVICE: "internet",
    TAX: "tax",
  };
  return aliases[normalizedCode] ?? slug(name);
}

function defaultIdentifierLabel(categoryKey: string): string {
  if (categoryKey === "airtime" || categoryKey === "data") return "Phone number";
  if (categoryKey === "electricity") return "Meter number";
  if (categoryKey === "cable-tv") return "Smart card or decoder number";
  return "Account number";
}

function defaultIdentifierHint(categoryKey: string): string {
  if (categoryKey === "airtime" || categoryKey === "data") {
    return "Enter the phone number that should receive this service.";
  }
  if (categoryKey === "electricity") {
    return "Enter the meter number for the electricity account.";
  }
  return "Enter the account identifier supplied by the service company.";
}

function normalizeFlutterwaveBillStatus(data: JsonRecord): "processing" | "succeeded" | "failed" | "reversed" {
  const value = (
    optionalString(data.status) ??
    optionalString(data.response_message) ??
    optionalString(data.message) ??
    ""
  ).toLowerCase();
  if (/success|successful|completed|complete/.test(value)) return "succeeded";
  if (/reverse|reversed|refunded/.test(value)) return "reversed";
  if (/fail|failed|declined|cancel/.test(value)) return "failed";
  return "processing";
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

function slug(value: string): string {
  const result = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return result || "service";
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

function requireRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_response_invalid",
      "The utility provider returned an invalid response.",
      502,
    );
  }
  return value as JsonRecord;
}

function optionalRecord(value: unknown): JsonRecord | null {
  if (value === undefined || value === null) return null;
  return requireRecord(value);
}

function requireString(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string" || !value.trim()) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_response_invalid",
      "The utility provider returned an incomplete response.",
      502,
    );
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
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
