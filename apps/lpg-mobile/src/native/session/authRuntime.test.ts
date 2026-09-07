import { AuthRuntimeError, verifySkimaAuthRuntime } from "./authRuntime";

describe("SKIMA auth runtime verification", () => {
  it("accepts the canonical SKIMA health identity", async () => {
    await expect(
      verifySkimaAuthRuntime({
        supabaseUrl: "https://example.supabase.co",
        anonKey: "public-key",
        fetchImpl: jest.fn(async () =>
          new Response(JSON.stringify({
            ok: true,
            service: "skima-platform",
            backend: "supabase",
          }), { status: 200 })
        ) as typeof fetch,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a different backend before credentials are submitted", async () => {
    await expect(
      verifySkimaAuthRuntime({
        supabaseUrl: "https://wrong.supabase.co",
        anonKey: "public-key",
        fetchImpl: jest.fn(async () =>
          new Response(JSON.stringify({
            ok: true,
            service: "another-product",
            backend: "supabase",
          }), { status: 200 })
        ) as typeof fetch,
      }),
    ).rejects.toMatchObject<AuthRuntimeError>({
      kind: "configuration",
    });
  });

  it("turns network failures into a safe customer-facing runtime error", async () => {
    await expect(
      verifySkimaAuthRuntime({
        supabaseUrl: "https://example.supabase.co",
        anonKey: "public-key",
        fetchImpl: jest.fn(async () => {
          throw new Error("network down");
        }) as typeof fetch,
      }),
    ).rejects.toMatchObject<AuthRuntimeError>({
      kind: "network",
    });
  });
});
