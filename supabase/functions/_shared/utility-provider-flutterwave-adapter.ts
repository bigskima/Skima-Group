import {
  defaultIdentifierHint,
  defaultIdentifierLabel,
  normalizeProviderStatus,
  optionalBoolean,
  optionalNumber,
  optionalRecord,
  optionalString,
  requireRecord,
  requireString,
  slug,
  type JsonRecord,
  type UtilityAdapter,
  type UtilityCatalogItem,
  type UtilityProviderContext,
  UtilityProviderRuntimeError,
} from "./utility-provider-contract.ts";

export function createFlutterwaveBillsAdapter(context: UtilityProviderContext): UtilityAdapter {
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
          optionalString(optionalRecord(record.data)?.message) ??
          "The utility provider could not complete the request.";
        const normalizedMessage = providerMessage.toLowerCase();
        const duplicateReference =
          response.status === 400 &&
          normalizedMessage.includes("duplicate") &&
          normalizedMessage.includes("reference");
        throw new UtilityProviderRuntimeError(
          duplicateReference
            ? "utility_provider_duplicate_reference"
            : response.status === 401 || response.status === 403
            ? "utility_provider_authentication_failed"
            : response.status === 429
            ? "utility_provider_rate_limited"
            : "utility_provider_request_failed",
          duplicateReference
            ? "The provider already knows this transaction reference. SKIMA will verify its status instead of charging again."
            : providerMessage,
          response.status >= 400 && response.status < 600 ? response.status : 502,
          {
            providerHttpStatus: response.status,
            providerMessage,
            duplicateReference,
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
      const transactionReference =
        optionalString(data.tx_ref) ??
        optionalString(data.reference) ??
        input.reference;
      return {
        status: normalizeProviderStatus(
          optionalString(data.status) ?? optionalString(data.response_message) ?? optionalString(data.message),
        ),
        providerReference: transactionReference,
        providerFulfillmentReference: optionalString(data.flw_ref),
        customerReference:
          optionalString(data.customer_reference) ??
          transactionReference,
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
      const transactionReference =
        optionalString(data.tx_ref) ??
        reference;
      return {
        status: normalizeProviderStatus(
          optionalString(data.status) ?? optionalString(data.response_message) ?? optionalString(data.message),
        ),
        providerReference: transactionReference,
        providerFulfillmentReference: optionalString(data.flw_ref),
        customerReference:
          optionalString(data.customer_reference) ??
          transactionReference,
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
  return response.data.map((item) => requireRecord(item));
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
