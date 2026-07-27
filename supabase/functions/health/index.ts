import { jsonResponse, optionsResponse, requestId } from "../_shared/http.ts";

Deno.serve((request: Request) => {
  if (request.method === "OPTIONS") {
    return optionsResponse();
  }

  if (request.method !== "GET") {
    return jsonResponse(
      {
        ok: false,
        error: "method_not_allowed",
        requestId: requestId(request),
      },
      405,
      { Allow: "GET, OPTIONS" },
    );
  }

  return jsonResponse({
    ok: true,
    service: "skima-platform",
    backend: "supabase",
    environment: Deno.env.get("SKIMA_ENV") ?? "unknown",
    timestamp: new Date().toISOString(),
    requestId: requestId(request),
  });
});
