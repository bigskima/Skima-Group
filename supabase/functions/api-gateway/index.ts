import { createRequestSupabaseClient, requireAuthenticatedUser } from "../_shared/supabase-auth.ts";
import { jsonResponse, optionsResponse, requestId } from "../_shared/http.ts";

const ROUTES = new Set([
  "/health",
  "/admin/role-templates",
  "/admin/users",
  "/admin/users/revoke",
  "/engines/catalog",
  "/engines/currencies",
  "/engines/pricing-policies",
  "/engines/settlement-policies",
  "/engines/dispatch-policies",
  "/engines/verification-definitions",
  "/engines/notification-templates",
  "/engines/ai-task-definitions",
  "/engines/provider-adapters",
]);

Deno.serve(async (request: Request) => {
  const id = requestId(request);

  if (request.method === "OPTIONS") {
    return optionsResponse();
  }

  const authResult = await requireAuthenticatedUser(request, id);

  if ("response" in authResult) {
    return authResult.response;
  }

  const url = new URL(request.url);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !anonKey) {
    return jsonResponse(
      {
        ok: false,
        error: "server_misconfigured",
        requestId: id,
      },
      500,
    );
  }

  const supabase = createRequestSupabaseClient(request, supabaseUrl, anonKey);

  if (url.pathname === "/health") {
    return jsonResponse({
      ok: true,
      service: "skima-platform",
      backend: "supabase",
      gateway: "api-gateway",
      authenticated: true,
      timestamp: new Date().toISOString(),
      requestId: id,
    });
  }

  if (url.pathname === "/engines/catalog" && request.method === "GET") {
    return jsonResponse({
      ok: true,
      data: {
        routes: Array.from(ROUTES).filter((route) => route.startsWith("/engines/")),
      },
      requestId: id,
    });
  }

  if (url.pathname === "/engines/currencies" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("currency_definitions")
        .select("code,display_name,symbol,decimal_places,status,metadata")
        .order("code", { ascending: true }),
      id,
    );
  }

  if (url.pathname === "/engines/pricing-policies" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("pricing_policies")
        .select("id,key,display_name,pricing_mode,scope_type,scope_id,currency_code,status,version")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (url.pathname === "/engines/settlement-policies" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("settlement_policies")
        .select("id,key,display_name,scope_type,scope_id,status,version")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (url.pathname === "/engines/dispatch-policies" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("dispatch_policies")
        .select("id,key,display_name,matching_strategy,status")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (url.pathname === "/engines/verification-definitions" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("verification_definitions")
        .select("id,key,display_name,verification_mode,event_type_key,status")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (url.pathname === "/engines/notification-templates" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("notification_templates")
        .select("id,key,channel,locale,subject_template,status")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (url.pathname === "/engines/ai-task-definitions" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("ai_task_definitions")
        .select("id,key,display_name,task_type,provider_adapter_id,status")
        .order("key", { ascending: true }),
      id,
    );
  }

  if (url.pathname === "/engines/provider-adapters" && request.method === "GET") {
    return selectRecords(
      supabase
        .from("provider_adapters")
        .select("id,provider_kind,key,display_name,status")
        .in("provider_kind", ["payment", "maps", "notification", "ai", "queue", "cache"])
        .order("provider_kind", { ascending: true })
        .order("key", { ascending: true }),
      id,
    );
  }

  if (url.pathname === "/admin/role-templates") {
    if (request.method === "GET") {
      const { data, error } = await supabase
        .from("platform_admin_role_templates")
        .select("id,key,display_name,description,permission_keys,status,is_system,metadata")
        .order("key", { ascending: true });

      if (error) {
        return databaseError(error, id);
      }

      return jsonResponse({
        ok: true,
        data,
        requestId: id,
      });
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      const { data, error } = await supabase.rpc("configure_platform_admin_role", {
        target_description: optionalString(payload.description),
        target_display_name: requireString(payload.displayName, "displayName"),
        target_metadata: optionalRecord(payload.metadata) ?? {},
        target_permission_keys: requireStringArray(payload.permissionKeys, "permissionKeys"),
        target_role_key: requireString(payload.roleKey, "roleKey"),
        target_status: optionalString(payload.status) ?? "active",
      });

      if (error) {
        return databaseError(error, id);
      }

      return jsonResponse({
        ok: true,
        id: data,
        requestId: id,
      });
    }
  }

  if (url.pathname === "/admin/users") {
    if (request.method === "GET") {
      const { data, error } = await supabase
        .from("platform_admins")
        .select("id,user_id,primary_role_id,admin_kind,title,status,metadata,created_at,updated_at")
        .order("created_at", { ascending: false });

      if (error) {
        return databaseError(error, id);
      }

      return jsonResponse({
        ok: true,
        data,
        requestId: id,
      });
    }

    if (request.method === "POST") {
      const body = await readJsonBody(request, id);

      if ("response" in body) {
        return body.response;
      }

      const payload = body.value;
      const { data, error } = await supabase.rpc("configure_platform_admin", {
        admin_metadata: optionalRecord(payload.metadata) ?? {},
        admin_title: optionalString(payload.title),
        target_role_key: requireString(payload.roleKey, "roleKey"),
        target_user_id: requireString(payload.userId, "userId"),
      });

      if (error) {
        return databaseError(error, id);
      }

      return jsonResponse({
        ok: true,
        id: data,
        requestId: id,
      });
    }
  }

  if (url.pathname === "/admin/users/revoke" && request.method === "POST") {
    const body = await readJsonBody(request, id);

    if ("response" in body) {
      return body.response;
    }

    const { error } = await supabase.rpc("revoke_platform_admin", {
      target_user_id: requireString(body.value.userId, "userId"),
    });

    if (error) {
      return databaseError(error, id);
    }

    return jsonResponse({
      ok: true,
      requestId: id,
    });
  }

  return jsonResponse(
    {
      ok: false,
      error: "route_not_found",
      route: url.pathname,
      availableRoutes: Array.from(ROUTES),
      requestId: id,
    },
    404,
  );
});

type JsonBodyResult =
  | { readonly value: Readonly<Record<string, unknown>> }
  | { readonly response: Response };

interface SelectQuery {
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

async function selectRecords(query: SelectQuery, id: string): Promise<Response> {
  const { data, error } = await query;

  if (error) {
    return databaseError(error as { readonly message: string; readonly code?: string }, id);
  }

  return jsonResponse({
    ok: true,
    data: Array.isArray(data) ? data : [],
    requestId: id,
  });
}

async function readJsonBody(request: Request, id: string): Promise<JsonBodyResult> {
  try {
    const value = await request.json();

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return invalidRequest(id, "request body must be a JSON object");
    }

    return { value: value as Readonly<Record<string, unknown>> };
  } catch (_error) {
    return invalidRequest(id, "request body must be valid JSON");
  }
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required.`);
  }

  return value;
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("optional string field must be a string.");
  }

  return value;
}

function requireStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${fieldName} must be an array of strings.`);
  }

  return value;
}

function optionalRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("metadata must be a JSON object.");
  }

  return value as Readonly<Record<string, unknown>>;
}

function invalidRequest(requestIdValue: string, message: string): JsonBodyResult {
  return {
    response: jsonResponse(
      {
        ok: false,
        error: "invalid_request",
        message,
        requestId: requestIdValue,
      },
      400,
    ),
  };
}

function databaseError(
  error: { readonly message: string; readonly code?: string },
  id: string,
): Response {
  return jsonResponse(
    {
      ok: false,
      error: "database_error",
      code: error.code,
      message: error.message,
      requestId: id,
    },
    400,
  );
}
