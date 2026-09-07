import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";

const root = new URL("../", import.meta.url);

async function read(path: string) {
  return Deno.readTextFile(new URL(path, root));
}

const [
  migration,
  runtime,
  mobileVerification,
  applicationScreen,
  documentScreen,
  adminApp,
  adminVerification,
  supabaseConfig,
] = await Promise.all([
  read("supabase/migrations/20260907070000_automatic_partner_verification_engine.sql"),
  read("supabase/functions/verification-runtime/index.ts"),
  read("apps/lpg-mobile/src/native/api/verification.ts"),
  read("apps/lpg-mobile/src/native/ui/ApplicationOverviewScreen.tsx"),
  read("apps/lpg-mobile/src/native/ui/DocumentWorkflowScreen.tsx"),
  read("apps/admin/src/App.tsx"),
  read("apps/admin/src/admin-verification-workspace.tsx"),
  read("supabase/config.toml"),
]);

Deno.test("verification migration is a single valid transaction shell", () => {
  assertEquals((migration.match(/\bbegin;/gi) ?? []).length >= 1, true);
  assertEquals((migration.match(/\bcommit;/gi) ?? []).length, 1);
  assert(
    !/as \$\s*$/m.test(migration),
    "PL/pgSQL bodies must use complete dollar-quote delimiters.",
  );
  assert(
    !/\{2,120\}\s*\n\s*commit;/m.test(migration),
    "Platform-key regexes must not be interrupted by transaction text.",
  );
  assertStringIncludes(migration, "provider_kind in (");
  assertStringIncludes(migration, "'verification'");
});

Deno.test("automatic verification satisfies only explicitly mapped evidence", () => {
  assertStringIncludes(migration, "application_document_requirement_satisfied");
  assertStringIncludes(migration, "application_verification_has_passed");
  assertStringIncludes(migration, "requirement_record.key = any(mapping.satisfies_document_keys)");
  assertStringIncludes(migration, "verification.person.identity");
  assertStringIncludes(migration, "verification.business.registry");
  assertStringIncludes(migration, "verification.driver.licence");

  assert(
    !/\('verification\.driver\.licence',\s*\d+,\s*'identity_document'\)/.test(migration),
    "A generic identity-document route must not be treated as driving-licence validation.",
  );
});

Deno.test("customer LPG ordering remains low friction", () => {
  assertStringIncludes(migration, "'require_identity_for_lpg_order', false");
  assertStringIncludes(migration, "'require_identity_for_standard_customer_account', false");
  assertStringIncludes(migration, "'step_up_for_regulated_or_high_risk_capabilities', true");
});

Deno.test("redundant partner paperwork is reduced without removing safety evidence", () => {
  for (const key of [
    "driver.address-evidence",
    "station.settlement-evidence",
    "station.representative-photo",
  ]) {
    assertStringIncludes(migration, key);
  }
  for (const key of [
    "station.business-permit",
    "station.fire-safety-certificate",
    "station.regulatory-certificate",
    "vehicle.registration",
    "vehicle.insurance",
    "vehicle.roadworthiness",
  ]) {
    assertStringIncludes(migration, key);
  }
});

Deno.test("verification runtime uses secure provider sessions and normalized decisions", () => {
  assertStringIncludes(runtime, 'Deno.env.get("DIDIT_API_KEY")');
  assertStringIncludes(runtime, '"https://verification.didit.me/v3/session/"');
  assertStringIncludes(runtime, '"/decision/"');
  assertStringIncludes(runtime, '"x-api-key": apiKey');
  assertStringIncludes(runtime, 'if (status === "APPROVED") return "passed"');
  assertStringIncludes(runtime, 'if (status === "DECLINED") return "failed"');
  assert(
    !/result_summary:\s*providerBody/.test(runtime),
    "Raw KYC provider responses must not be persisted as the normalized result summary.",
  );
});

Deno.test("mobile uses automatic verification first and controlled fallback evidence", () => {
  assertStringIncludes(mobileVerification, "shouldShowVerificationFallback");
  assertStringIncludes(mobileVerification, "satisfiedVerificationDocumentKeys");
  assertStringIncludes(applicationScreen, "AutomatedVerificationCard");
  assertStringIncludes(applicationScreen, 'verificationKey="verification.person.identity"');
  assertStringIncludes(applicationScreen, 'verificationKey="verification.business.registry"');
  assertStringIncludes(documentScreen, "pendingAutomaticChecks");
  assertStringIncludes(documentScreen, "shouldShowVerificationFallback");
});

Deno.test("admin exposes provider routing and exception-only review", () => {
  assertStringIncludes(adminApp, 'href: "/verification"');
  assertStringIncludes(adminApp, 'props.route === "/verification"');
  assertStringIncludes(adminApp, "AdminVerificationWorkspace");
  assertStringIncludes(adminVerification, '"/admin/verification/configuration"');
  assertStringIncludes(adminVerification, '"/admin/verification/exceptions"');
  assertStringIncludes(adminVerification, '"/admin/verification/provider-route"');
  assertStringIncludes(adminVerification, "Exception-only review");
});

Deno.test("verification runtime is JWT protected", () => {
  assertStringIncludes(supabaseConfig, "[functions.verification-runtime]");
  assertStringIncludes(supabaseConfig, "verify_jwt = true");
});
