import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";

const root = new URL("../", import.meta.url);

async function read(path: string) {
  return Deno.readTextFile(new URL(path, root));
}

const [
  migration,
  partnerMediaMigration,
  runtime,
  providerWebhook,
  sharedVerification,
  mobileVerification,
  applicationScreen,
  documentScreen,
  adminApp,
  adminNavigation,
  adminWorkspaceRouter,
  adminVerification,
  supabaseConfig,
] = await Promise.all([
  read("supabase/migrations/20260907070000_automatic_partner_verification_engine.sql"),
  read("supabase/migrations/20260819214411_lpg_granular_partner_media_privacy.sql"),
  read("supabase/functions/verification-runtime/index.ts"),
  read("supabase/functions/verification-provider-webhook/index.ts"),
  read("supabase/functions/_shared/partner-verification.ts"),
  read("apps/lpg-mobile/src/native/api/verification.ts"),
  read("apps/lpg-mobile/src/native/ui/ApplicationOverviewScreen.tsx"),
  read("apps/lpg-mobile/src/native/ui/DocumentWorkflowScreen.tsx"),
  read("apps/admin/src/App.tsx"),
  read("apps/admin/src/admin-navigation-config.ts"),
  read("apps/admin/src/admin-workspace-router.tsx"),
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
    assertStringIncludes(partnerMediaMigration, key);
  }
});

Deno.test("verification runtime uses secure provider sessions and normalized decisions", () => {
  assertStringIncludes(runtime, "partner-verification.ts");
  assertStringIncludes(sharedVerification, 'resolveEdgeSecret("DIDIT_API_KEY")');
  assertStringIncludes(sharedVerification, '"https://verification.didit.me/v3/session/"');
  assertStringIncludes(sharedVerification, "/decision/");
  assertStringIncludes(sharedVerification, '"x-api-key": apiKey');
  assertStringIncludes(sharedVerification, 'if (status === "APPROVED") return "passed"');
  assertStringIncludes(sharedVerification, 'if (status === "DECLINED") return "failed"');
  assert(
    !/result_summary:\s*providerBody/.test(sharedVerification),
    "Raw KYC provider responses must not be persisted as the normalized result summary.",
  );
});

Deno.test("mobile uses automatic verification first and controlled fallback evidence", () => {
  assertStringIncludes(mobileVerification, "/runtime/partner-verification/requirements");
  assertStringIncludes(mobileVerification, "/runtime/partner-verification/sessions");
  assertStringIncludes(mobileVerification, "shouldShowVerificationFallback");
  assertStringIncludes(mobileVerification, "satisfiedVerificationDocumentKeys");
  assertStringIncludes(applicationScreen, "AutomatedVerificationCard");
  assertStringIncludes(applicationScreen, 'verificationKey="verification.person.identity"');
  assertStringIncludes(applicationScreen, 'verificationKey="verification.business.registry"');
  assertStringIncludes(documentScreen, "pendingAutomaticChecks");
  assertStringIncludes(documentScreen, "shouldShowVerificationFallback");
});

Deno.test("admin exposes provider routing, launch KYC/KYB policy and exception-only review", () => {
  assertStringIncludes(adminApp, "AdminWorkspaceRouter");
  assertStringIncludes(adminApp, "foundationNavigation");
  assertStringIncludes(adminNavigation, 'href: "/verification"');
  assertStringIncludes(adminWorkspaceRouter, 'props.route === "/verification"');
  assertStringIncludes(adminWorkspaceRouter, "AdminVerificationWorkspace");
  assertStringIncludes(adminVerification, '"/admin/verification/configuration"');
  assertStringIncludes(adminVerification, '"/admin/verification/exceptions"');
  assertStringIncludes(adminVerification, '"/admin/verification/provider-route"');
  assertStringIncludes(adminVerification, "KYC automatic · KYB assisted");
  assertStringIncludes(adminVerification, "Enable automatic KYB");
  assertStringIncludes(adminVerification, "Use assisted KYB");
  assertStringIncludes(adminVerification, "Exception-only review");
});

Deno.test("mobile partner verification uses the canonical API gateway", () => {
  assertStringIncludes(mobileVerification, "useGatewayQuery");
  assertStringIncludes(mobileVerification, "useGatewayMutation");
  assertStringIncludes(mobileVerification, "/runtime/partner-verification/");
  assert(
    !mobileVerification.includes("verificationBaseUrl") &&
      !mobileVerification.includes("fetch("),
    "The LPG app must not bypass the API gateway for partner verification.",
  );
});

Deno.test("verification admin exception queue uses a real application identifier", async () => {
  const remediation = await read(
    "supabase/migrations/20260908193000_live_lpg_runtime_admin_reconciliation.sql",
  );
  assertStringIncludes(remediation, "create or replace function public.read_verification_exception_queue()");
  assertStringIncludes(remediation, "'APP-' || upper(substr(replace(application.id::text, '-', ''), 1, 12))");
  assert(
    !remediation.includes("application.public_reference"),
    "The repaired exception queue must not reference a column that application_records does not own.",
  );
});

Deno.test("verification credit exhaustion keeps personal KYC retryable and isolates paid routes", async () => {
  const [routePauseMigration, card, friendlyErrors] = await Promise.all([
    read("supabase/migrations/20260908204515_pause_verification_routes_on_credit_exhaustion.sql"),
    read("apps/lpg-mobile/src/native/ui/AutomatedVerificationCard.tsx"),
    read("apps/lpg-mobile/src/native/utilities/friendlyError.ts"),
  ]);

  assertStringIncludes(sharedVerification, "verification_provider_credits_exhausted");
  assertStringIncludes(sharedVerification, "pauseVerificationRoute");
  assertStringIncludes(sharedVerification, "shouldPauseVerificationRouteForCreditFailure");
  assertStringIncludes(sharedVerification, 'verificationKey === "verification.person.identity"');
  assertStringIncludes(sharedVerification, "return false");
  assertStringIncludes(sharedVerification, '.eq("id", routeId)');
  assert(
    !sharedVerification.includes("pauseVerificationProviderRoutes"),
    "A paid KYB credit failure must not pause unrelated personal KYC routes.",
  );
  assertStringIncludes(sharedVerification, 'runtimePauseReason: "provider_credits_exhausted"');
  assertStringIncludes(sharedVerification, 'status: "paused"');

  assertStringIncludes(routePauseMigration, "provider_credits_exhausted");
  assertStringIncludes(routePauseMigration, "provider_execution_logs");

  assertStringIncludes(card, "localApplicationId");
  assertStringIncludes(card, "localAutomaticUnavailable");
  assertStringIncludes(friendlyErrors, "not enough credits");
  assertStringIncludes(friendlyErrors, "Secure verification is temporarily unavailable");
});

Deno.test("launch policy keeps personal KYC automatic and business KYB assisted", async () => {
  const [policy, card, verificationApi, documents] = await Promise.all([
    read("supabase/migrations/20260908215010_automatic_kyc_assisted_kyb_launch_policy.sql"),
    read("apps/lpg-mobile/src/native/ui/AutomatedVerificationCard.tsx"),
    read("apps/lpg-mobile/src/native/api/verification.ts"),
    read("apps/lpg-mobile/src/native/ui/DocumentWorkflowScreen.tsx"),
  ]);

  assertStringIncludes(policy, "'verification.person.identity'");
  assertStringIncludes(policy, "'automatic_kyc'");
  assertStringIncludes(policy, "'station_representative_only'");
  assertStringIncludes(policy, "'business_owner_or_ubo_scope', false");
  assertStringIncludes(policy, "array['station.representative-identity']::text[]");
  assertStringIncludes(policy, "'verification.business.registry'");
  assertStringIncludes(policy, "'assisted_kyb'");
  assertStringIncludes(policy, "'automatic_route_retained', true");
  assertStringIncludes(policy, "status = 'paused'");
  assertStringIncludes(policy, "status = 'active'");

  assertStringIncludes(verificationApi, "routeMode");
  assertStringIncludes(verificationApi, "routeConfigured");
  assertStringIncludes(card, "ASSISTED BUSINESS REVIEW");
  assertStringIncludes(card, "Automatic KYB retained for future admin activation");
  assertStringIncludes(documents, 'check.routeMode === "assisted_kyb"');
  assertStringIncludes(applicationScreen, 'stationRole !== "owner"');
  assertStringIncludes(applicationScreen, "Automatic KYC is used for station representatives at launch");
  assertStringIncludes(applicationScreen, "The automatic KYB route is retained for future activation");
});

Deno.test("Didit personal KYC uses the free workflow and authority remains assisted", async () => {
  const policy = await read(
    "supabase/migrations/20260909004500_didit_free_kyc_workflow_reconciliation.sql",
  );

  assertStringIncludes(policy, "108e2fb0-6f50-4a39-87c9-a87060dabcd1");
  assertStringIncludes(policy, "'Free KYC'");
  assertStringIncludes(policy, "'freeTierEligible', true");
  assertStringIncludes(policy, "'freeTierAllowancePerFeaturePerMonth', 500");
  assertStringIncludes(policy, "'PASSIVE_LIVENESS'");
  assertStringIncludes(policy, "'IP_ANALYSIS'");
  assertStringIncludes(policy, "'verification.person.identity'");
  assertStringIncludes(policy, "'verification.station.authority'");
  assertStringIncludes(policy, "'assisted_authority_review'");
  assertStringIncludes(adminVerification, "Didit Free KYC");
  assertStringIncludes(adminVerification, "Assisted review");
  assertStringIncludes(adminVerification, "paid active-liveness/AML/NFC workflows");
  assertStringIncludes(sharedVerification, "providerHttpStatus");
  assertStringIncludes(sharedVerification, "providerRequestId");
  assertStringIncludes(sharedVerification, "providerMessage");
});

Deno.test("driver and station onboarding form colors follow the active app palette", () => {
  assertStringIncludes(applicationScreen, "useAppTheme");
  assertStringIncludes(applicationScreen, "const { palette } = useAppTheme()");
  assertStringIncludes(applicationScreen, "placeholderTextColor={palette.muted}");
  assertStringIncludes(applicationScreen, "backgroundColor: palette.input");
  assertStringIncludes(applicationScreen, "color: palette.ink");
  assertStringIncludes(applicationScreen, "backgroundColor: palette.brandSoft");
  assertStringIncludes(applicationScreen, "backgroundColor: palette.successSoft");
});

Deno.test("verification runtime is JWT protected", () => {
  assertStringIncludes(supabaseConfig, "[functions.verification-runtime]");
  assertStringIncludes(supabaseConfig, "verify_jwt = true");
});

Deno.test("Didit credentials are Edge Function secrets only", async () => {
  const policy = await read(
    "supabase/migrations/20260909011500_didit_edge_secret_only_runtime.sql",
  );

  assertStringIncludes(sharedVerification, 'resolveEdgeSecret("DIDIT_API_KEY")');
  assertStringIncludes(sharedVerification, "Deno.env.get(name)");
  assert(
    !sharedVerification.includes('rpc("read_server_secret"'),
    "Personal KYC must not fall back to database/Vault secret reads.",
  );

  assertStringIncludes(providerWebhook, 'resolveEdgeSecret("DIDIT_WEBHOOK_SECRET")');
  assertStringIncludes(providerWebhook, "Deno.env.get(name)");
  assert(
    !providerWebhook.includes('rpc("read_server_secret"'),
    "Didit webhook verification must not fall back to database/Vault secret reads.",
  );

  assertStringIncludes(policy, "'credential_source', 'supabase_edge_function_secret'");
  assertStringIncludes(policy, "'database_secret_fallback', false");
  assertStringIncludes(policy, "'SUPABASE_SECRET:DIDIT_API_KEY'");
  assertStringIncludes(policy, "'SUPABASE_SECRET:DIDIT_WEBHOOK_SECRET'");
  assertStringIncludes(adminVerification, "there is no database-secret fallback");
  assertStringIncludes(adminVerification, "Edge secret reference");
});

Deno.test("Didit live route activation binds published KYC and KYB workflows", async () => {
  const migration = await read(
    "supabase/migrations/20260908081707_didit_vault_route_activation.sql",
  );
  assertStringIncludes(migration, "read_server_secret");
  assertStringIncludes(migration, "grant execute on function public.read_server_secret(text) to service_role");
  assertStringIncludes(migration, "f08c2586-0b0c-42a7-b386-c220eb320c37");
  assertStringIncludes(migration, "bcdcd368-63c0-47ab-8427-35e865dfdde2");
  assertStringIncludes(migration, "verification.person.identity");
  assertStringIncludes(migration, "verification.business.registry");
  assertStringIncludes(migration, "status = 'active'");
});

Deno.test("Didit webhook is public-to-provider but HMAC authenticated and idempotent", () => {
  assertStringIncludes(supabaseConfig, "[functions.verification-provider-webhook]");
  assertStringIncludes(supabaseConfig, "verify_jwt = false");
  assertStringIncludes(providerWebhook, 'resolveEdgeSecret("DIDIT_WEBHOOK_SECRET")');
  assertStringIncludes(providerWebhook, 'request.headers.get("x-signature-v2")');
  assertStringIncludes(providerWebhook, "canonicalJson(payload)");
  assertStringIncludes(providerWebhook, 'request.headers.get("x-signature")');
  assertStringIncludes(providerWebhook, 'request.headers.get("x-signature-simple")');
  assertStringIncludes(providerWebhook, 'request.headers.get("x-timestamp")');
  assertStringIncludes(providerWebhook, "MAX_TIMESTAMP_SKEW_SECONDS = 300");
  assertStringIncludes(providerWebhook, '"status.updated"');
  assertStringIncludes(providerWebhook, '"data.updated"');
  assertStringIncludes(providerWebhook, 'provider_kind: "verification"');
  assertStringIncludes(providerWebhook, 'idempotency_key: eventId');
  assertStringIncludes(providerWebhook, 'reconcile_application_verification');
  assert(
    !providerWebhook.includes("decision: payload.decision"),
    "Raw Didit decision payloads must not be persisted by the webhook runtime.",
  );
});
