import {
  defaultIdentifierHint,
  defaultIdentifierLabel,
  firstPath,
  isSafeHeaderName,
  normalizeProviderStatus,
  optionalBoolean,
  optionalNumber,
  optionalRecord,
  optionalString,
  readPath,
  requireRecord,
  requireString,
  slug,
  type JsonRecord,
  type UtilityAdapter,
  type UtilityCatalogItem,
  type UtilityProviderContext,
  UtilityProviderRuntimeError,
} from "./utility-provider-contract.ts";

type TemplateVariables = Readonly<Record<string, unknown>>;
type Credentials = Readonly<Record<string, string>>;

type GenericOperation = Readonly<{
  method: string;
  path: string;
  query: JsonRecord;
  body: unknown;
  headers: JsonRecord;
  response: JsonRecord;
}>;

const DEFAULT_STATUS_PATHS = [
  "data.status",
  "status",
  "data.transaction.status",
  "transaction.status",
  "data.response_description",
  "response_description",
  "data.code",
  "code",
];

export function createGenericHttpUtilityAdapter(context: UtilityProviderContext): UtilityAdapter {
  const contract = requireContract(context);
  const baseUrl = safePublicApiBaseUrl(requireString(context.config.baseUrl, "Configure the provider API base URL."));
  const credentials = resolveCredentials(context, contract);
  const defaults = optionalRecord(contract.defaults) ?? {};
  const operations = optionalRecord(contract.operations) ?? {};
  const statusMap = optionalRecord(contract.statusMap);

  const requestOperation = async (
    operationName: string,
    variables: TemplateVariables = {},
  ): Promise<unknown> => {
    const operation = readOperation(operations, operationName);
    const mergedVariables = {
      providerKey: context.key,
      providerName: context.displayName,
      ...defaults,
      ...variables,
    };
    const path = renderPath(operation.path, mergedVariables, credentials);
    const url = new URL(path.replace(/^\/+/, ""), baseUrl);
    const query = renderTemplate(operation.query, mergedVariables, credentials);
    if (query && typeof query === "object" && !Array.isArray(query)) {
      for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
        if (!/^[A-Za-z0-9_.~-]{1,100}$/.test(key) || value === undefined || value === null || value === "") continue;
        if (Array.isArray(value)) {
          for (const entry of value.slice(0, 100)) url.searchParams.append(key, String(entry));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers = new Headers({ Accept: "application/json" });
    applyConfiguredHeaders(headers, optionalRecord(contract.headers) ?? {}, mergedVariables, credentials);
    applyConfiguredHeaders(headers, operation.headers, mergedVariables, credentials);
    applyAuthentication(headers, url, optionalRecord(contract.auth), mergedVariables, credentials);

    const method = operation.method;
    const renderedBody = renderTemplate(operation.body, mergedVariables, credentials);
    const hasBody = renderedBody !== undefined && renderedBody !== null && !["GET", "HEAD"].includes(method);
    if (hasBody && !headers.has("content-type")) headers.set("content-type", "application/json");

    const controller = new AbortController();
    const timeoutMs = boundedTimeout(optionalNumber(contract.timeoutMs));
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: hasBody ? JSON.stringify(renderedBody) : undefined,
        redirect: "error",
        signal: controller.signal,
      });
      const text = await response.text();
      if (text.length > 1_500_000) {
        throw new UtilityProviderRuntimeError(
          "utility_provider_response_too_large",
          "The utility provider returned an unexpectedly large response.",
          502,
          { providerHttpStatus: response.status, operationName },
        );
      }
      let payload: unknown = {};
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          throw new UtilityProviderRuntimeError(
            "utility_provider_invalid_json",
            "The utility provider returned an invalid JSON response.",
            502,
            { providerHttpStatus: response.status, operationName },
          );
        }
      }

      const message = providerMessage(payload, operation.response);
      if (!response.ok || configuredResponseIsError(payload, operation.response)) {
        const normalizedMessage = message.toLowerCase();
        const duplicateReference =
          normalizedMessage.includes("duplicate") &&
          (normalizedMessage.includes("reference") || normalizedMessage.includes("transaction"));
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
            : message,
          response.status >= 400 && response.status < 600 ? response.status : 502,
          {
            providerHttpStatus: response.status,
            operationName,
            duplicateReference,
          },
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof UtilityProviderRuntimeError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new UtilityProviderRuntimeError(
          "utility_provider_timeout",
          "The utility provider took too long to respond.",
          504,
          { operationName },
        );
      }
      throw new UtilityProviderRuntimeError(
        "utility_provider_network_failed",
        "SKIMA could not reach the utility provider.",
        502,
        { operationName },
      );
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    kind: "generic-http-v1",
    async testConnection() {
      await requestOperation("test", {});
      return {
        adapterKind: "generic-http-v1",
        contractVersion: optionalString(contract.version) ?? "1",
        healthy: true,
        providerKey: context.key,
      };
    },
    async fetchCatalog(options) {
      const operation = readOperation(operations, "catalog");
      const payload = await requestOperation("catalog", {
        categoryCodes: options.categoryCodes ?? [],
      });
      return normalizeCatalog(payload, operation, context, options);
    },
    async validateCustomer(input) {
      const payload = await requestOperation("validate", input);
      const operation = readOperation(operations, "validate");
      const response = operation.response;
      const data = responseData(payload, response);
      const validValue = mappedValue(payload, data, response, "validPath", ["data.valid", "valid", "data.is_valid", "is_valid"]);
      const valid = validValue === undefined ? true : optionalBoolean(validValue) ?? Boolean(validValue);
      return {
        valid,
        customerIdentifier: input.customerIdentifier,
        customerName: mappedString(payload, data, response, "customerNamePath", ["data.customer_name", "data.name", "customer_name", "name"]),
        address: mappedString(payload, data, response, "addressPath", ["data.address", "address"]),
        billerCode: mappedString(payload, data, response, "billerCodePath", ["data.biller_code", "biller_code"]) ?? input.billerCode,
        productCode: mappedString(payload, data, response, "productCodePath", ["data.product_code", "data.item_code", "product_code", "item_code"]) ?? input.itemCode,
        fee: mappedNumber(payload, data, response, "feePath", ["data.fee", "fee", "data.charge", "charge"]),
        minimum: mappedNumber(payload, data, response, "minimumPath", ["data.minimum", "data.min_amount", "minimum", "min_amount"]),
        maximum: mappedNumber(payload, data, response, "maximumPath", ["data.maximum", "data.max_amount", "maximum", "max_amount"]),
        providerResponseMessage: mappedString(payload, data, response, "messagePath", ["message", "data.message", "response_description", "data.response_description"]),
      };
    },
    async purchase(input) {
      const payload = await requestOperation("purchase", input);
      const operation = readOperation(operations, "purchase");
      return normalizeTransaction(payload, operation.response, statusMap, {
        reference: input.reference,
        amount: input.amount,
      });
    },
    async readStatus(reference) {
      const payload = await requestOperation("status", { reference });
      const operation = readOperation(operations, "status");
      return normalizeTransaction(payload, operation.response, statusMap, { reference, amount: null });
    },
  };
}

function requireContract(context: UtilityProviderContext): JsonRecord {
  const contract = optionalRecord(context.config.genericContract);
  if (!contract) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_contract_missing",
      "Configure the provider API contract before testing this integration.",
      503,
      { providerKey: context.key },
    );
  }
  const operations = optionalRecord(contract.operations);
  if (!operations || !optionalRecord(operations.purchase) || !optionalRecord(operations.status) || !optionalRecord(operations.test)) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_contract_incomplete",
      "The generic provider contract must define test, purchase and status operations.",
      503,
      { providerKey: context.key },
    );
  }
  return contract;
}

function readOperation(operations: JsonRecord, name: string): GenericOperation {
  const raw = optionalRecord(operations[name]);
  if (!raw) {
    throw new UtilityProviderRuntimeError(
      `utility_provider_${name}_not_configured`,
      `The provider ${name} operation has not been configured.`,
      503,
    );
  }
  const method = (optionalString(raw.method) ?? (name === "status" || name === "test" || name === "catalog" ? "GET" : "POST")).toUpperCase();
  if (!["GET", "HEAD", "POST", "PUT", "PATCH"].includes(method)) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_contract_invalid",
      `The ${name} operation uses an unsupported HTTP method.`,
      500,
    );
  }
  const path = optionalString(raw.path);
  if (!path || /^https?:\/\//i.test(path) || path.startsWith("//")) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_contract_invalid",
      `The ${name} operation must use a relative API path.`,
      500,
    );
  }
  return {
    method,
    path,
    query: optionalRecord(raw.query) ?? {},
    body: raw.body,
    headers: optionalRecord(raw.headers) ?? {},
    response: optionalRecord(raw.response) ?? {},
  };
}

function safePublicApiBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.endsWith("/") ? value : `${value}/`);
  } catch {
    throw new UtilityProviderRuntimeError(
      "utility_provider_base_url_invalid",
      "The utility provider API base URL is invalid.",
      500,
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal") ||
    hostname.includes(":") ||
    isBlockedIpv4(hostname)
  ) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_base_url_invalid",
      "The utility provider API must use a public HTTPS hostname.",
      500,
    );
  }
  url.hash = "";
  url.search = "";
  return url;
}

function isBlockedIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const parts = hostname.split(".").map(Number);
  if (parts.some((part) => part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127);
}

function resolveCredentials(context: UtilityProviderContext, contract: JsonRecord): Credentials {
  const refs: Record<string, string> = {};
  if (context.secretRef) refs.primary = context.secretRef;
  const configuredRefs = optionalRecord(context.config.credentialRefs) ?? optionalRecord(contract.credentialRefs) ?? {};
  for (const [alias, value] of Object.entries(configuredRefs)) {
    const ref = optionalString(value);
    if (ref && /^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/.test(alias)) refs[alias] = ref;
  }
  const resolved: Record<string, string> = {};
  for (const [alias, ref] of Object.entries(refs)) {
    if (!/^SUPABASE_SECRET:[A-Z][A-Z0-9_]{2,100}$/.test(ref)) {
      throw new UtilityProviderRuntimeError(
        "utility_provider_secret_reference_invalid",
        `The credential reference for ${alias} must use SUPABASE_SECRET:NAME.`,
        503,
      );
    }
    const secretName = ref.slice("SUPABASE_SECRET:".length);
    const value = Deno.env.get(secretName)?.trim();
    if (!value) {
      throw new UtilityProviderRuntimeError(
        "utility_provider_secret_missing",
        `The Edge Function secret ${secretName} has not been configured yet.`,
        503,
        { secretName, credentialAlias: alias },
      );
    }
    resolved[alias] = value;
  }
  return resolved;
}

function applyAuthentication(
  headers: Headers,
  url: URL,
  auth: JsonRecord | null,
  variables: TemplateVariables,
  credentials: Credentials,
): void {
  if (!auth) {
    if (credentials.primary) headers.set("Authorization", `Bearer ${credentials.primary}`);
    return;
  }

  const bindings = Array.isArray(auth.bindings) ? auth.bindings : null;
  if (bindings) {
    for (const rawBinding of bindings.slice(0, 20)) {
      const binding = optionalRecord(rawBinding);
      if (!binding) continue;
      const target = optionalString(binding.target)?.toLowerCase();
      const name = optionalString(binding.name);
      const valueTemplate = optionalString(binding.value);
      if (!target || !name || !valueTemplate) continue;
      const rendered = String(renderTemplate(valueTemplate, variables, credentials) ?? "");
      if (target === "header") {
        if (!isSafeHeaderName(name)) throw new UtilityProviderRuntimeError("utility_provider_contract_invalid", "The provider authentication header is invalid.", 500);
        headers.set(name, rendered);
      } else if (target === "query") {
        if (!/^[A-Za-z0-9_.~-]{1,100}$/.test(name)) throw new UtilityProviderRuntimeError("utility_provider_contract_invalid", "The provider authentication query field is invalid.", 500);
        url.searchParams.set(name, rendered);
      }
    }
    return;
  }

  const type = (optionalString(auth.type) ?? "bearer").toLowerCase();
  if (type === "none") return;
  const credentialAlias = optionalString(auth.credential) ?? "primary";
  const secret = credentials[credentialAlias];
  if (!secret) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_secret_missing",
      `The configured ${credentialAlias} provider credential is unavailable.`,
      503,
    );
  }
  if (type === "bearer") {
    headers.set(optionalString(auth.headerName) ?? "Authorization", `${optionalString(auth.prefix) ?? "Bearer "}${secret}`);
    return;
  }
  if (type === "header") {
    const headerName = optionalString(auth.headerName) ?? "X-API-Key";
    if (!isSafeHeaderName(headerName)) throw new UtilityProviderRuntimeError("utility_provider_contract_invalid", "The provider authentication header is invalid.", 500);
    headers.set(headerName, `${optionalString(auth.prefix) ?? ""}${secret}`);
    return;
  }
  if (type === "query") {
    const queryParam = optionalString(auth.queryParam) ?? "api_key";
    if (!/^[A-Za-z0-9_.~-]{1,100}$/.test(queryParam)) throw new UtilityProviderRuntimeError("utility_provider_contract_invalid", "The provider authentication query field is invalid.", 500);
    url.searchParams.set(queryParam, secret);
    return;
  }
  if (type === "basic") {
    const username = optionalString(auth.username) ?? "api";
    headers.set("Authorization", `Basic ${btoa(`${username}:${secret}`)}`);
    return;
  }
  throw new UtilityProviderRuntimeError(
    "utility_provider_contract_invalid",
    "The provider authentication type is not supported.",
    500,
  );
}

function applyConfiguredHeaders(
  headers: Headers,
  configured: JsonRecord,
  variables: TemplateVariables,
  credentials: Credentials,
): void {
  for (const [name, value] of Object.entries(configured)) {
    if (!isSafeHeaderName(name)) {
      throw new UtilityProviderRuntimeError("utility_provider_contract_invalid", `The provider header ${name} is not allowed.`, 500);
    }
    const rendered = renderTemplate(value, variables, credentials);
    if (rendered !== undefined && rendered !== null) headers.set(name, String(rendered));
  }
}

function renderPath(template: string, variables: TemplateVariables, credentials: Credentials): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, token: string) => {
    const value = resolveTemplateToken(token, variables, credentials);
    return encodeURIComponent(String(value ?? ""));
  });
}

function renderTemplate(value: unknown, variables: TemplateVariables, credentials: Credentials): unknown {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
    if (exact) return resolveTemplateToken(exact[1], variables, credentials);
    return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, token: string) => String(resolveTemplateToken(token, variables, credentials) ?? ""));
  }
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, variables, credentials));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, renderTemplate(entry, variables, credentials)]));
  }
  return value;
}

function resolveTemplateToken(token: string, variables: TemplateVariables, credentials: Credentials): unknown {
  const normalized = token.trim();
  if (normalized.startsWith("credential:")) {
    const alias = normalized.slice("credential:".length).trim();
    const value = credentials[alias];
    if (!value) throw new UtilityProviderRuntimeError("utility_provider_secret_missing", `The provider credential ${alias} is unavailable.`, 503);
    return value;
  }
  return readPath(variables, normalized);
}

function providerMessage(payload: unknown, response: JsonRecord): string {
  const configuredPath = optionalString(response.messagePath);
  const resolved = configuredPath ? readPath(payload, configuredPath) : undefined;
  return optionalString(resolved) ??
    optionalString(firstPath(payload, ["message", "data.message", "error.message", "error", "response_description", "data.response_description"])) ??
    "The utility provider could not complete the request.";
}

function configuredResponseIsError(payload: unknown, response: JsonRecord): boolean {
  const errorPath = optionalString(response.errorPath);
  if (errorPath) {
    const value = readPath(payload, errorPath);
    if (value === true) return true;
    const normalized = optionalString(value)?.toLowerCase();
    if (normalized && !["false", "0", "none", "null", "ok", "success"].includes(normalized)) return true;
  }
  const okPath = optionalString(response.okPath);
  if (okPath) {
    const value = readPath(payload, okPath);
    const allowed = Array.isArray(response.okValues)
      ? response.okValues.map((item) => String(item).trim().toLowerCase())
      : ["true", "1", "ok", "success", "successful", "200"];
    return !allowed.includes(String(value ?? "").trim().toLowerCase());
  }
  return false;
}

function responseData(payload: unknown, response: JsonRecord): unknown {
  const dataPath = optionalString(response.dataPath);
  return dataPath ? readPath(payload, dataPath) : firstPath(payload, ["data", "result"]) ?? payload;
}

function mappedValue(
  payload: unknown,
  data: unknown,
  response: JsonRecord,
  configKey: string,
  fallbacks: readonly string[],
): unknown {
  const configured = optionalString(response[configKey]);
  if (configured) {
    const fromPayload = readPath(payload, configured);
    if (fromPayload !== undefined) return fromPayload;
    return readPath(data, configured);
  }
  return firstPath(payload, fallbacks) ?? firstPath(data, fallbacks.map((path) => path.replace(/^data\./, "")));
}

function mappedString(payload: unknown, data: unknown, response: JsonRecord, configKey: string, fallbacks: readonly string[]): string | null {
  return optionalString(mappedValue(payload, data, response, configKey, fallbacks));
}

function mappedNumber(payload: unknown, data: unknown, response: JsonRecord, configKey: string, fallbacks: readonly string[]): number | null {
  return optionalNumber(mappedValue(payload, data, response, configKey, fallbacks));
}

function normalizeTransaction(
  payload: unknown,
  response: JsonRecord,
  statusMap: JsonRecord | null,
  fallback: Readonly<{ reference: string; amount: number | null }>,
): JsonRecord {
  const data = responseData(payload, response);
  const rawStatus = mappedString(payload, data, response, "statusPath", DEFAULT_STATUS_PATHS) ?? "processing";
  const localStatusMap = optionalRecord(response.statusMap) ?? statusMap;
  const providerReference = mappedString(payload, data, response, "providerReferencePath", [
    "data.reference", "data.tx_ref", "data.transaction_id", "data.request_id", "data.id",
    "reference", "tx_ref", "transaction_id", "request_id", "id",
  ]) ?? fallback.reference;
  return {
    status: normalizeProviderStatus(rawStatus, localStatusMap),
    providerReference,
    providerFulfillmentReference: mappedString(payload, data, response, "providerFulfillmentReferencePath", [
      "data.provider_reference", "data.providerReference", "data.flw_ref", "data.external_reference",
      "provider_reference", "providerReference", "flw_ref", "external_reference",
    ]),
    customerReference: mappedString(payload, data, response, "customerReferencePath", [
      "data.customer_reference", "data.customerReference", "customer_reference", "customerReference",
    ]) ?? providerReference,
    amount: mappedNumber(payload, data, response, "amountPath", ["data.amount", "amount"]) ?? fallback.amount,
    fee: mappedNumber(payload, data, response, "feePath", ["data.fee", "fee", "data.charge", "charge"]),
    commission: mappedNumber(payload, data, response, "commissionPath", ["data.commission", "commission", "data.discount", "discount"]),
    token: mappedString(payload, data, response, "tokenPath", ["data.token", "data.pin", "data.extra", "token", "pin", "extra"]),
    rawStatus,
  };
}

function normalizeCatalog(
  payload: unknown,
  operation: GenericOperation,
  context: UtilityProviderContext,
  options: Readonly<{ categoryCodes?: string[] }>,
): UtilityCatalogItem[] {
  const response = operation.response;
  const arrayPath = optionalString(response.arrayPath) ?? optionalString(response.dataPath) ?? "data";
  const rawRows = readPath(payload, arrayPath);
  const rows = Array.isArray(rawRows)
    ? rawRows
    : Array.isArray(payload)
    ? payload
    : null;
  if (!rows) {
    throw new UtilityProviderRuntimeError(
      "utility_provider_catalog_invalid",
      "The provider catalogue contract did not resolve to an array.",
      502,
      { arrayPath },
    );
  }
  const genericContract = optionalRecord(context.config.genericContract);
  const genericOperations = optionalRecord(genericContract?.operations);
  const catalogContract = optionalRecord(genericOperations?.catalog);
  const mapping = optionalRecord(response.mapping) ?? optionalRecord(catalogContract?.mapping) ?? {};
  const defaults = optionalRecord(response.defaults) ?? {};
  const requested = new Set((options.categoryCodes ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean));
  const categories = new Set<string>();
  const billers = new Set<string>();
  const result: UtilityCatalogItem[] = [];

  for (const rawRow of rows.slice(0, 10_000)) {
    const row = optionalRecord(rawRow);
    if (!row) continue;
    const categoryName = catalogString(row, mapping, "categoryName", ["category_name", "category.name", "category", "service_type", "type"]) ?? optionalString(defaults.categoryName) ?? "Other";
    const categoryCode = catalogString(row, mapping, "categoryCode", ["category_code", "category.code", "category_id", "categoryId"]) ?? optionalString(defaults.categoryCode) ?? slug(categoryName);
    const categoryKey = catalogString(row, mapping, "categoryKey", ["category_key", "category.slug"]) ?? slug(categoryName);
    if (requested.size && !requested.has(categoryCode.toLowerCase()) && !requested.has(categoryKey.toLowerCase())) continue;

    const billerName = catalogString(row, mapping, "billerName", ["biller_name", "biller.name", "provider_name", "network", "company", "operator"]) ?? optionalString(defaults.billerName) ?? context.displayName;
    const billerCode = catalogString(row, mapping, "billerCode", ["biller_code", "biller.code", "provider_code", "network_code", "company_code", "operator_id"]) ?? optionalString(defaults.billerCode) ?? slug(billerName);
    const billerKey = catalogString(row, mapping, "billerKey", ["biller_key", "biller.slug"]) ?? `${categoryKey}.${slug(billerName)}`;

    const productCode = catalogString(row, mapping, "productCode", ["product_code", "item_code", "code", "variation_code", "service_id", "id"]);
    const productName = catalogString(row, mapping, "productName", ["product_name", "item_name", "name", "variation_name", "service_name", "title"]);
    if (!productCode || !productName) continue;
    const productKey = catalogString(row, mapping, "productKey", ["product_key", "slug"]) ?? `${billerKey}.${slug(productName)}`;

    const currency = catalogString(row, mapping, "currency", ["currency", "currency_code"]) ?? optionalString(defaults.currency) ?? "NGN";
    const amount = catalogNumber(row, mapping, "amount", ["amount", "price", "fixed_amount"]);
    const fixedFlag = catalogBoolean(row, mapping, "fixedFlag", ["is_fixed", "is_amount_fixed", "fixed"]);
    const explicitMode = catalogString(row, mapping, "amountMode", ["amount_mode"]);
    const amountMode: "customer" | "fixed" | "provider" =
      explicitMode === "provider" ? "provider" :
      explicitMode === "fixed" ? "fixed" :
      explicitMode === "customer" ? "customer" :
      fixedFlag === true || (amount !== null && amount > 0) ? "fixed" : "customer";

    if (!categories.has(categoryKey)) {
      categories.add(categoryKey);
      result.push({
        itemType: "category",
        externalKey: categoryCode,
        canonicalKey: categoryKey,
        displayName: categoryName,
        currencyCode: currency,
        normalizedPayload: { providerCategoryCode: categoryCode },
        rawPayload: { source: "generic-http-v1" },
      });
    }
    if (!billers.has(billerKey)) {
      billers.add(billerKey);
      result.push({
        itemType: "biller",
        externalKey: billerCode,
        canonicalKey: billerKey,
        canonicalParentKey: categoryKey,
        displayName: billerName,
        currencyCode: currency,
        customerIdentifierLabel: catalogString(row, mapping, "identifierLabel", ["customer_identifier_label", "label_name"]) ?? defaultIdentifierLabel(categoryKey),
        customerIdentifierHint: catalogString(row, mapping, "identifierHint", ["customer_identifier_hint", "label_description"]) ?? defaultIdentifierHint(categoryKey),
        normalizedPayload: {
          providerBillerCode: billerCode,
          providerCategoryCode: categoryCode,
        },
        rawPayload: { source: "generic-http-v1" },
      });
    }
    result.push({
      itemType: "product",
      externalKey: `${billerCode}:${productCode}`,
      canonicalKey: productKey,
      canonicalParentKey: billerKey,
      displayName: productName,
      providerProductCode: productCode,
      amountMode,
      fixedAmount: amountMode === "fixed" ? amount : null,
      minimumAmount: catalogNumber(row, mapping, "minimumAmount", ["minimum_amount", "min_amount", "minimum"]),
      maximumAmount: catalogNumber(row, mapping, "maximumAmount", ["maximum_amount", "max_amount", "maximum"]),
      currencyCode: currency,
      customerIdentifierLabel: catalogString(row, mapping, "identifierLabel", ["customer_identifier_label", "label_name"]) ?? defaultIdentifierLabel(categoryKey),
      customerIdentifierHint: catalogString(row, mapping, "identifierHint", ["customer_identifier_hint", "label_description"]) ?? defaultIdentifierHint(categoryKey),
      normalizedPayload: {
        providerBillerCode: billerCode,
        providerCategoryCode: categoryCode,
        providerItemCode: productCode,
        providerFee: catalogNumber(row, mapping, "fee", ["fee", "charge"]),
        providerCommission: catalogNumber(row, mapping, "commission", ["commission", "discount"]),
      },
      rawPayload: row,
    });
  }
  return result;
}

function catalogPath(mapping: JsonRecord, key: string, fallbacks: readonly string[]): readonly string[] {
  const configured = optionalString(mapping[key]);
  return configured ? [configured] : fallbacks;
}

function catalogString(row: JsonRecord, mapping: JsonRecord, key: string, fallbacks: readonly string[]): string | null {
  return optionalString(firstPath(row, catalogPath(mapping, key, fallbacks)));
}

function catalogNumber(row: JsonRecord, mapping: JsonRecord, key: string, fallbacks: readonly string[]): number | null {
  return optionalNumber(firstPath(row, catalogPath(mapping, key, fallbacks)));
}

function catalogBoolean(row: JsonRecord, mapping: JsonRecord, key: string, fallbacks: readonly string[]): boolean | null {
  return optionalBoolean(firstPath(row, catalogPath(mapping, key, fallbacks)));
}

function boundedTimeout(value: number | null): number {
  if (value === null) return 20_000;
  return Math.max(3_000, Math.min(30_000, Math.round(value)));
}
