import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const ClientEnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url().optional(),
  VITE_SUPABASE_ANON_KEY: z.string().min(20).optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(20).optional(),
  VITE_API_GATEWAY_URL: z.string().url().optional(),
});

export type ClientEnv = z.infer<typeof ClientEnvSchema>;
export type PermissionKey = string;
export type ModuleKey = string;
export type FeatureKey = string;

export interface ClientRuntimeConfig {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly apiGatewayUrl: string;
}

export interface SessionContext {
  readonly user: {
    readonly id: string;
    readonly email: string | null;
  };
  readonly profile: {
    readonly id: string;
    readonly display_name: string | null;
    readonly avatar_url: string | null;
    readonly status: string;
    readonly metadata: Readonly<Record<string, unknown>>;
  } | null;
  readonly platformAdmin: {
    readonly id: string;
    readonly user_id: string;
    readonly primary_role_id: string;
    readonly admin_kind: string;
    readonly title: string | null;
    readonly status: string;
    readonly metadata: Readonly<Record<string, unknown>>;
  } | null;
  readonly permissions: readonly PermissionKey[];
  readonly roles: readonly SessionRole[];
  readonly organizations: readonly SessionOrganization[];
}

export interface SessionRole {
  readonly id: string;
  readonly roleId: string;
  readonly key: string | null;
  readonly displayName: string | null;
  readonly organizationId: string | null;
  readonly branchId: string | null;
  readonly status: string;
  readonly accessScope: Readonly<Record<string, unknown>>;
  readonly permissions: readonly PermissionKey[];
}

export interface SessionOrganization {
  readonly membershipId: string | null;
  readonly organizationId: string | null;
  readonly slug: string | null;
  readonly displayName: string | null;
  readonly membershipType: string | null;
  readonly status: string | null;
}

export interface PermissionContext {
  readonly permissions: readonly PermissionKey[];
  readonly roles?: readonly SessionRole[];
  readonly organizations?: readonly SessionOrganization[];
  readonly enabledModules?: readonly ModuleKey[];
  readonly enabledFeatures?: readonly FeatureKey[];
}

export interface NavigationItem {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly icon?: string;
  readonly description?: string;
  readonly requiredPermissions?: readonly PermissionKey[];
  readonly requiredModules?: readonly ModuleKey[];
  readonly requiredFeatures?: readonly FeatureKey[];
  readonly children?: readonly NavigationItem[];
}

export type OnboardingStepStatus = "locked" | "available" | "active" | "complete" | "skipped";

export interface OnboardingStepDefinition {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly requiredPermissions?: readonly PermissionKey[];
  readonly requiredModules?: readonly ModuleKey[];
  readonly requiredFeatures?: readonly FeatureKey[];
  readonly dependsOn?: readonly string[];
  readonly href?: string;
}

export interface OnboardingStepState extends OnboardingStepDefinition {
  readonly status: OnboardingStepStatus;
}

export interface OnboardingFlowDefinition {
  readonly key: string;
  readonly title: string;
  readonly audience: "customer" | "driver" | "partner" | "admin" | "platform";
  readonly steps: readonly OnboardingStepDefinition[];
}

export interface GatewayRequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly requiresAuth?: boolean;
}

export interface ApiGatewayClientOptions {
  readonly apiGatewayUrl: string;
  readonly anonKey: string;
  readonly getAccessToken: () => Promise<string | null>;
  readonly fetcher?: typeof fetch;
  readonly defaultTimeoutMs?: number;
  readonly developmentLogger?: (entry: GatewayLogEntry) => void;
}

export interface GatewayLogEntry {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly status?: number;
  readonly durationMs: number;
  readonly ok: boolean;
}

export interface GatewayEnvelope<TData = unknown> {
  readonly ok: boolean;
  readonly data?: TData;
  readonly id?: string;
  readonly error?: string;
  readonly code?: string;
  readonly message?: string;
  readonly requestId?: string;
}

export interface QueryDescriptor {
  readonly key: readonly unknown[];
  readonly path: string;
  readonly requiredPermissions?: readonly PermissionKey[];
}

export class ApiGatewayError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;
  readonly details: unknown;

  constructor(input: {
    readonly status: number;
    readonly code: string;
    readonly message: string;
    readonly requestId?: string | null;
    readonly retryAfterSeconds?: number | null;
    readonly details?: unknown;
  }) {
    super(input.message);
    this.name = "ApiGatewayError";
    this.status = input.status;
    this.code = input.code;
    this.requestId = input.requestId ?? null;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
    this.details = input.details;
  }
}

export const SessionRoleSchema: z.ZodType<SessionRole> = z.object({
  id: z.string().uuid(),
  roleId: z.string().uuid(),
  key: z.string().nullable(),
  displayName: z.string().nullable(),
  organizationId: z.string().uuid().nullable(),
  branchId: z.string().uuid().nullable(),
  status: z.string(),
  accessScope: z.record(z.unknown()),
  permissions: z.array(z.string()),
});

export const SessionOrganizationSchema: z.ZodType<SessionOrganization> = z.object({
  membershipId: z.string().uuid().nullable(),
  organizationId: z.string().uuid().nullable(),
  slug: z.string().nullable(),
  displayName: z.string().nullable(),
  membershipType: z.string().nullable(),
  status: z.string().nullable(),
});

export const SessionContextSchema: z.ZodType<SessionContext> = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email().nullable(),
  }),
  profile: z.object({
    id: z.string().uuid(),
    display_name: z.string().nullable(),
    avatar_url: z.string().nullable(),
    status: z.string(),
    metadata: z.record(z.unknown()),
  }).nullable(),
  platformAdmin: z.object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    primary_role_id: z.string().uuid(),
    admin_kind: z.string(),
    title: z.string().nullable(),
    status: z.string(),
    metadata: z.record(z.unknown()),
  }).nullable(),
  permissions: z.array(z.string()),
  roles: z.array(SessionRoleSchema),
  organizations: z.array(SessionOrganizationSchema),
});

export const RouteCatalogSchema = z.object({
  routes: z.array(z.string()),
});

export const CurrencyDefinitionSchema = z.object({
  code: z.string(),
  display_name: z.string(),
  symbol: z.string().nullable().optional(),
  decimal_places: z.number().int(),
  status: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export const GatewayEnvelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  id: z.string().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  requestId: z.string().optional(),
}).passthrough();

export function readClientRuntimeConfig(
  source: Readonly<Record<string, unknown>>,
): ClientRuntimeConfig {
  const parsed = ClientEnvSchema.safeParse(source);

  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Client Supabase configuration is missing or invalid: ${fields}`);
  }

  const supabaseUrl = parsed.data.VITE_SUPABASE_URL ?? parsed.data.SUPABASE_URL;
  const supabaseAnonKey = parsed.data.VITE_SUPABASE_ANON_KEY ?? parsed.data.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Client Supabase URL and anon key are required.");
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    apiGatewayUrl: parsed.data.VITE_API_GATEWAY_URL ??
      `${supabaseUrl.replace(/\/$/, "")}/functions/v1/api-gateway`,
  };
}

export function createSkimaSupabaseClient(config: ClientRuntimeConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
    global: {
      headers: {
        "x-skima-client": "frontend-foundation",
      },
    },
  });
}

export function createClientIdempotencyKey(scope: string, targetId?: string): string {
  const normalizedScope = scope.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, "-");

  if (!normalizedScope) {
    throw new Error("A non-empty operation scope is required.");
  }

  return [
    "frontend",
    normalizedScope,
    targetId?.trim() || "record",
    crypto.randomUUID(),
  ].join(":");
}

export function createApiGatewayClient(options: ApiGatewayClientOptions): ApiGatewayClient {
  return new ApiGatewayClient(options);
}

export class ApiGatewayClient {
  private readonly apiGatewayUrl: string;
  private readonly anonKey: string;
  private readonly getAccessToken: () => Promise<string | null>;
  private readonly fetcher: typeof fetch;
  private readonly defaultTimeoutMs: number;
  private readonly developmentLogger?: (entry: GatewayLogEntry) => void;

  constructor(options: ApiGatewayClientOptions) {
    this.apiGatewayUrl = options.apiGatewayUrl.replace(/\/$/, "");
    this.anonKey = options.anonKey;
    this.getAccessToken = options.getAccessToken;
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 20_000;
    this.developmentLogger = options.developmentLogger;
  }

  get<TData>(path: string, schema: z.ZodType<TData>, options: GatewayRequestOptions = {}) {
    return this.request(path, schema, { ...options, method: "GET" });
  }

  post<TData>(
    path: string,
    body: unknown,
    schema: z.ZodType<TData>,
    options: GatewayRequestOptions = {},
  ) {
    return this.request(path, schema, { ...options, body, method: "POST" });
  }

  async request<TData>(
    path: string,
    schema: z.ZodType<TData>,
    options: GatewayRequestOptions = {},
  ): Promise<TData> {
    const startedAt = performance.now();
    const requestId = crypto.randomUUID();
    const method = options.method ?? "GET";
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    if (options.signal) {
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const accessToken = await this.getAccessToken();

      if (options.requiresAuth !== false && !accessToken) {
        throw new ApiGatewayError({
          status: 401,
          code: "missing_session",
          message: "A valid session is required.",
          requestId,
        });
      }

      const response = await this.fetcher(`${this.apiGatewayUrl}${normalizePath(path)}`, {
        method,
        headers: {
          apikey: this.anonKey,
          "content-type": "application/json",
          "x-request-id": requestId,
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });

      const envelope = await parseGatewayEnvelope(response);
      const durationMs = Math.round(performance.now() - startedAt);
      this.developmentLogger?.({
        requestId: envelope.requestId ?? requestId,
        method,
        path,
        status: response.status,
        durationMs,
        ok: response.ok && envelope.ok,
      });

      if (!response.ok || !envelope.ok) {
        throw normalizeGatewayError(response, envelope);
      }

      const parsedData = schema.safeParse(envelope.data ?? envelope.id ?? null);

      if (!parsedData.success) {
        throw new ApiGatewayError({
          status: 502,
          code: "invalid_backend_response",
          message: "The backend response did not match the expected contract.",
          requestId: envelope.requestId ?? requestId,
          details: parsedData.error.flatten(),
        });
      }

      return parsedData.data;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      this.developmentLogger?.({
        requestId,
        method,
        path,
        durationMs,
        ok: false,
      });

      if (error instanceof ApiGatewayError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiGatewayError({
          status: 408,
          code: "request_timeout",
          message: "The request timed out.",
          requestId,
        });
      }

      throw new ApiGatewayError({
        status: 0,
        code: "network_error",
        message: "We could not reach Skima services. Please try again.",
        requestId,
        details: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function getAccessTokenFromSession(session: Session | null): string | null {
  return session?.access_token ?? null;
}

export function hasPermission(
  context: PermissionContext | null | undefined,
  requiredPermissions: readonly PermissionKey[] | PermissionKey | null | undefined,
): boolean {
  if (!requiredPermissions || requiredPermissions.length === 0) {
    return true;
  }

  const required = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
  const granted = new Set(context?.permissions ?? []);

  return required.every((permission) => granted.has(permission));
}

export function hasModule(
  context: PermissionContext | null | undefined,
  requiredModules: readonly ModuleKey[] | ModuleKey | null | undefined,
): boolean {
  if (!requiredModules || requiredModules.length === 0) {
    return true;
  }

  const required = Array.isArray(requiredModules) ? requiredModules : [requiredModules];
  const enabled = new Set(context?.enabledModules ?? []);

  return required.every((moduleKey) => enabled.has(moduleKey));
}

export function hasFeature(
  context: PermissionContext | null | undefined,
  requiredFeatures: readonly FeatureKey[] | FeatureKey | null | undefined,
): boolean {
  if (!requiredFeatures || requiredFeatures.length === 0) {
    return true;
  }

  const required = Array.isArray(requiredFeatures) ? requiredFeatures : [requiredFeatures];
  const enabled = new Set(context?.enabledFeatures ?? []);

  return required.every((featureKey) => enabled.has(featureKey));
}

export function canAccessNavigationItem(
  item: NavigationItem,
  context: PermissionContext | null | undefined,
): boolean {
  return hasPermission(context, item.requiredPermissions) &&
    hasModule(context, item.requiredModules) &&
    hasFeature(context, item.requiredFeatures);
}

export function filterNavigationItems(
  items: readonly NavigationItem[],
  context: PermissionContext | null | undefined,
): NavigationItem[] {
  return items
    .filter((item) => canAccessNavigationItem(item, context))
    .map((item) => ({
      ...item,
      children: item.children ? filterNavigationItems(item.children, context) : undefined,
    }));
}

export function resolveOnboardingFlow(
  flow: OnboardingFlowDefinition,
  completedStepKeys: readonly string[],
  context: PermissionContext | null | undefined,
  activeStepKey?: string | null,
): OnboardingStepState[] {
  const completed = new Set(completedStepKeys);

  return flow.steps.map((step) => {
    const dependenciesMet = (step.dependsOn ?? []).every((dependency) => completed.has(dependency));
    const accessGranted = hasPermission(context, step.requiredPermissions) &&
      hasModule(context, step.requiredModules) &&
      hasFeature(context, step.requiredFeatures);

    if (completed.has(step.key)) {
      return { ...step, status: "complete" };
    }

    if (!dependenciesMet || !accessGranted) {
      return { ...step, status: "locked" };
    }

    if (activeStepKey === step.key) {
      return { ...step, status: "active" };
    }

    return { ...step, status: "available" };
  });
}

export function createQueryDescriptor(
  key: readonly unknown[],
  path: string,
  requiredPermissions?: readonly PermissionKey[],
): QueryDescriptor {
  return {
    key,
    path,
    requiredPermissions,
  };
}

export function formatMoney(
  amountMinor: number,
  currencyCode: string,
  locale = "en-NG",
  decimalPlaces = 2,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  }).format(amountMinor / 10 ** decimalPlaces);
}

export function normalizeStatusLabel(status: string): string {
  return status
    .split(/[_:-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

async function parseGatewayEnvelope(response: Response): Promise<GatewayEnvelope> {
  const text = await response.text();

  if (text.trim().length === 0) {
    return {
      ok: response.ok,
    };
  }

  try {
    const parsed = GatewayEnvelopeSchema.parse(JSON.parse(text));

    return parsed as GatewayEnvelope;
  } catch (error) {
    throw new ApiGatewayError({
      status: response.status,
      code: "invalid_json_response",
      message: "The backend returned an invalid JSON response.",
      details: error,
    });
  }
}

function normalizeGatewayError(response: Response, envelope: GatewayEnvelope): ApiGatewayError {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfter ? Number.parseInt(retryAfter, 10) : null;

  return new ApiGatewayError({
    status: response.status,
    code: envelope.error ?? envelope.code ?? "gateway_error",
    message: envelope.message ?? safeStatusMessage(response.status),
    requestId: envelope.requestId ?? null,
    retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
    details: envelope,
  });
}

function safeStatusMessage(status: number): string {
  if (status === 400) return "The request was invalid.";
  if (status === 401) return "Authentication is required.";
  if (status === 403) return "You do not have permission for this action.";
  if (status === 404) return "The requested resource was not found.";
  if (status === 409) return "The request conflicts with the current state.";
  if (status === 422) return "The request could not be processed.";
  if (status === 429) return "Too many requests. Please try again shortly.";
  if (status >= 500) return "The service is temporarily unavailable.";

  return "The request failed.";
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}
