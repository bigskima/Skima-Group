import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import {
  initiatePaystackTransfer,
  PaystackPayoutError,
} from "../supabase/functions/_shared/paystack-payouts.ts";

const root = new URL("../", import.meta.url);

async function read(path: string) {
  return Deno.readTextFile(new URL(path, root));
}

const [financeRuntime, withdrawalUi, payoutMigration, paystackAdapter] = await Promise.all([
  read("supabase/functions/finance-runtime/index.ts"),
  read("apps/lpg-mobile/src/native/ui/FinanceWithdrawalExperience.tsx"),
  read("supabase/migrations/20260907061500_payout_directory_resilience.sql"),
  read("supabase/functions/_shared/paystack-payouts.ts"),
]);

Deno.test("finance runtime accepts the SKIMA web client CORS header", () => {
  assertStringIncludes(financeRuntime, "x-skima-client");
  assertStringIncludes(financeRuntime, "Access-Control-Allow-Headers");
});

Deno.test("payout bank discovery survives payment-provider readiness failures", () => {
  assertStringIncludes(financeRuntime, 'source: "configured-fallback"');
  assertStringIncludes(financeRuntime, "directoryAvailable");
  assertStringIncludes(financeRuntime, "beneficiaryVerificationAvailable");
  assert(
    /try\s*\{[\s\S]{0,200}providerKey = await activePaymentProvider\(serviceClient\);[\s\S]{0,500}catch/.test(
      financeRuntime,
    ),
    "Bank discovery must not fail just because the active payment provider cannot be resolved.",
  );
  assert(
    /banks:\s*configuredBanks/.test(financeRuntime),
    "Configured fallback banks must remain available to the client.",
  );
});

Deno.test("payout directory migration preserves a governed Nigerian fallback", () => {
  assertStringIncludes(payoutMigration, "skima.configured_fallback");
  assertStringIncludes(payoutMigration, "public_bank_directory");
  assertStringIncludes(payoutMigration, "OPay Digital Services");
  assertStringIncludes(payoutMigration, "Moniepoint Microfinance Bank");
  assertStringIncludes(payoutMigration, "create or replace function public.sync_public_payout_directory()");
  assert(
    !/jsonb_build_object\('available',\s*false,\s*'banks',\s*'\[\]'::jsonb\)/i.test(payoutMigration),
    "Provider loss must not erase the configured payout bank directory.",
  );
});

Deno.test("withdrawal UI separates bank discovery from KYC and provider readiness", () => {
  assertStringIncludes(withdrawalUi, "This is a SKIMA payout configuration issue, not a KYC requirement for your account.");
  assertStringIncludes(withdrawalUi, "beneficiaryVerificationAvailable");
  assertStringIncludes(withdrawalUi, "Retry bank directory");
  assertStringIncludes(withdrawalUi, 'nestedRecord(result, "transfer")');
  assertStringIncludes(withdrawalUi, "providerMessage");
});

Deno.test("withdrawal response carries provider transfer diagnostics inside data", () => {
  assert(
    /data:\s*\{\s*\.\.\.record\.data,\s*transfer,\s*\}/m.test(financeRuntime),
    "The client must receive the provider transfer result with the withdrawal record.",
  );
});

Deno.test("Paystack transfer restrictions become a clear business-readiness error", async () => {
  const error = await assertRejects(
    () =>
      initiatePaystackTransfer(
        "sk_test_placeholder",
        {
          amountMajor: 1000,
          recipientCode: "RCP_test",
          reference: "skima-test-transfer-0001",
          reason: "SKIMA test",
        },
        async () =>
          new Response(
            JSON.stringify({
              status: false,
              message: "Transfers are not enabled for your business",
            }),
            {
              status: 403,
              headers: { "content-type": "application/json" },
            },
          ),
      ),
    PaystackPayoutError,
  );

  assertEquals(error.code, "paystack_transfers_unavailable");
  assertStringIncludes(error.message, "not yet enabled for live transfers");
});

Deno.test("Paystack payout holds surface as compliance holds", async () => {
  const error = await assertRejects(
    () =>
      initiatePaystackTransfer(
        "sk_test_placeholder",
        {
          amountMajor: 1000,
          recipientCode: "RCP_test",
          reference: "skima-test-transfer-0002",
          reason: "SKIMA test",
        },
        async () =>
          new Response(
            JSON.stringify({
              status: false,
              message: "Payouts are currently on hold while compliance review is completed",
            }),
            {
              status: 409,
              headers: { "content-type": "application/json" },
            },
          ),
      ),
    PaystackPayoutError,
  );

  assertEquals(error.code, "paystack_payouts_on_hold");
  assertStringIncludes(error.message, "compliance review");
});

Deno.test("Paystack adapter still requires verified recipients before transfer", () => {
  assertStringIncludes(paystackAdapter, "transferrecipient");
  assertStringIncludes(paystackAdapter, "bank/resolve");
});
