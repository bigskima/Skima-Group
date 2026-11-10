import { z } from "zod";

import { ApiGatewayError, createApiGatewayClient } from "../packages/frontend-core/src/index.ts";

function clientFor(body: string, status = 200) {
  return createApiGatewayClient({
    apiGatewayUrl: "https://skima.invalid/functions/v1/api-gateway",
    anonKey: "test-public-anon-key",
    getAccessToken: async () => "test-access-token",
    fetcher: async () =>
      new Response(body, {
        status,
        headers: { "content-type": "application/json" },
      }),
  });
}

Deno.test("gateway client accepts a successful bare JSON payload and still validates route data", async () => {
  const client = clientFor(JSON.stringify([{ id: "fuel.pms" }]));
  const result = await client.get(
    "/runtime/fuel/products",
    z.array(z.object({ id: z.string() })),
  );

  if (result.length !== 1 || result[0].id !== "fuel.pms") {
    throw new Error("A valid successful JSON payload was not returned to the route schema.");
  }
});

Deno.test("gateway client preserves the standard success envelope", async () => {
  const client = clientFor(JSON.stringify({
    ok: true,
    data: [{ id: "fuel.ago" }],
    requestId: "test-request",
  }));
  const result = await client.get(
    "/runtime/fuel/products",
    z.array(z.object({ id: z.string() })),
  );

  if (result.length !== 1 || result[0].id !== "fuel.ago") {
    throw new Error("The standard gateway envelope was not unwrapped.");
  }
});

Deno.test("gateway client does not treat malformed JSON as a successful payload", async () => {
  const client = clientFor("{not-json");
  try {
    await client.get("/runtime/fuel/products", z.array(z.record(z.unknown())));
    throw new Error("Malformed JSON unexpectedly succeeded.");
  } catch (error) {
    if (!(error instanceof ApiGatewayError) || error.code !== "invalid_json_response") {
      throw error;
    }
  }
});

Deno.test("gateway client does not silently accept an unwrapped HTTP error", async () => {
  const client = clientFor(JSON.stringify({ message: "Forbidden" }), 403);
  try {
    await client.get("/runtime/fuel/products", z.array(z.record(z.unknown())));
    throw new Error("An unwrapped HTTP error unexpectedly succeeded.");
  } catch (error) {
    if (!(error instanceof ApiGatewayError) || error.code !== "invalid_gateway_envelope") {
      throw error;
    }
  }
});
