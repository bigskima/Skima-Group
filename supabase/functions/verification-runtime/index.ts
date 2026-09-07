import { createClient, type User } from "npm:@supabase/supabase-js@2.110.9";
import {
  readPartnerVerificationRequirements,
  reconcilePartnerVerificationApplication,
  refreshPartnerVerificationSession,
  startPartnerVerificationSession,
  VerificationRuntimeError,
  type VerificationBody,
} from "../_shared/partner-verification.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const requestId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("authorization");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return json({ ok: false, error: "unauthorized", requestId }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });

  const userResult = await userClient.auth.getUser();
  const user = userResult.data.user;
  if (userResult.error || !user) {
    return json({ ok: false, error: "unauthorized", requestId }, 401);
  }

  try {
    const path = verificationPath(request.url);

    if (path === "/requirements" && request.method === "GET") {
      const applicationId = new URL(request.url).searchParams.get("applicationId") ?? "";
      const data = await readPartnerVerificationRequirements(userClient, applicationId);
      return json({ ok: true, data, requestId });
    }

    if (path === "/sessions" && request.method === "POST") {
      const data = await startPartnerVerificationSession(
        serviceClient,
        user,
        await readBody(request),
      );
      return json({ ok: true, data, requestId });
    }

    if (path === "/sessions/refresh" && request.method === "POST") {
      const data = await refreshPartnerVerificationSession(
        serviceClient,
        user,
        await readBody(request),
      );
      return json({ ok: true, data, requestId });
    }

    if (path === "/applications/reconcile" && request.method === "POST") {
      const data = await reconcilePartnerVerificationApplication(
        serviceClient,
        user,
        await readBody(request),
      );
      return json({ ok: true, data, requestId });
    }

    return json({ ok: false, error: "not_found", requestId }, 404);
  } catch (error) {
    return verificationErrorResponse(error, requestId, user);
  }
});

function verificationPath(urlValue: string): string {
  let path = new URL(urlValue).pathname.replace(/\/+$/, "");
  const marker = "/verification-runtime";
  const index = path.indexOf(marker);
  if (index >= 0) path = path.slice(index + marker.length);
  return path || "/";
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: CORS_HEADERS });
}

async function readBody(request: Request): Promise<VerificationBody> {
  const value = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VerificationRuntimeError(
      "invalid_request",
      "Request body must be a JSON object.",
    );
  }
  return value as VerificationBody;
}

function verificationErrorResponse(
  error: unknown,
  requestId: string,
  user: User,
): Response {
  console.error(JSON.stringify({
    severity: "error",
    source: "verification-runtime",
    requestId,
    userId: user.id,
    message: error instanceof Error ? error.message : "unknown verification runtime error",
  }));

  const runtimeError = error instanceof VerificationRuntimeError
    ? error
    : new VerificationRuntimeError(
        "verification_runtime_error",
        "SKIMA could not complete this verification request.",
        500,
      );

  return json(
    {
      ok: false,
      error: runtimeError.code,
      message: runtimeError.message,
      details: runtimeError.details,
      requestId,
    },
    runtimeError.status,
  );
}
