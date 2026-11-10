import { assertStringIncludes } from "jsr:@std/assert";
const decoder = new TextDecoder();
async function read(path: string) {
  return decoder.decode(await Deno.readFile(path));
}
const [
  refillGate, refillApi, refillReader, logisticsGate, storeGate, billsGate,
  lpgSkeleton, logisticsSkeleton, storeSkeleton, billsSkeleton, lpgScreen, lpgCard,
  lpgEntry, logisticsEntry, storeEntry, billsEntry,
  docsMigration, versionsMigration, admin,
] = await Promise.all([
  read("apps/lpg-mobile/src/native/policies/RefillCustomerPolicyGate.tsx"),
  read("apps/lpg-mobile/src/native/api/policies.ts"),
  read("apps/lpg-mobile/src/native/ui/PolicyDocumentScreen.tsx"),
  read("apps/logistics-mobile/src/policies/PolicyConsentGate.tsx"),
  read("apps/store-mobile/src/policies/PolicyConsentGate.tsx"),
  read("apps/bills-mobile/src/policies/PolicyConsentGate.tsx"),
  read("apps/lpg-mobile/src/native/ui/ScreenSkeleton.tsx"),
  read("apps/logistics-mobile/src/ui/ScreenSkeleton.tsx"),
  read("apps/store-mobile/src/ui/ScreenSkeleton.tsx"),
  read("apps/bills-mobile/src/ui/ScreenSkeleton.tsx"),
  read("apps/lpg-mobile/src/native/ui/Screen.tsx"),
  read("apps/lpg-mobile/src/native/ui/Card.tsx"),
  read("apps/lpg-mobile/app/index.tsx"),
  read("apps/logistics-mobile/app/index.tsx"),
  read("apps/store-mobile/app/index.tsx"),
  read("apps/bills-mobile/app/index.tsx"),
  read("supabase/migrations/20261108001245_add_customer_terms_for_logistics_store_bills.sql"),
  read("supabase/migrations/20261108001644_publish_initial_customer_terms_v1.sql"),
  read("apps/admin/src/features/experience/PolicyWorkspaceV2.tsx"),
]);
Deno.test("all four customer apps require their own current accepted policy", () => {
  for (const [source, key] of [
    [refillGate + refillApi, "policy.customer.terms"],
    [logisticsGate, "policy.customer.logistics.terms"],
    [storeGate, "policy.customer.store.terms"],
    [billsGate, "policy.customer.bills.terms"],
  ] as const) {
    assertStringIncludes(source, key);
    assertStringIncludes(source, "read_current_policy");
    assertStringIncludes(source, "has_accepted_current_policy");
    assertStringIncludes(source, "accept_policy");
    assertStringIncludes(source, "acceptance.data === true");
  }
});
Deno.test("policy readers include progressive reading, contents, read aloud and explicit acceptance", () => {
  for (const source of [refillReader, logisticsGate, storeGate, billsGate]) {
    assertStringIncludes(source, "Read aloud");
    assertStringIncludes(source, "PROGRESSIVE READING");
    assertStringIncludes(source, "allRead");
    assertStringIncludes(source, "acceptanceStatement");
  }
  assertStringIncludes(refillReader, "mandatory = false");
});
Deno.test("all four customer apps use contextual skeleton loaders for policy and app startup", () => {
  for (const skeleton of [lpgSkeleton, logisticsSkeleton, storeSkeleton, billsSkeleton]) {
    assertStringIncludes(skeleton, 'variant === "policy"');
    assertStringIncludes(skeleton, 'variant === "dashboard"');
    assertStringIncludes(skeleton, 'variant === "list"');
    assertStringIncludes(skeleton, "export function ScreenSkeleton");
  }
  for (const gate of [refillGate, logisticsGate, storeGate, billsGate]) {
    assertStringIncludes(gate, "ScreenSkeleton");
    assertStringIncludes(gate, 'variant="policy"');
  }
  for (const entry of [lpgEntry, logisticsEntry, storeEntry, billsEntry]) {
    assertStringIncludes(entry, "ScreenSkeleton");
  }
});
Deno.test("Read aloud automatically covers every chapter and stops cleanly", () => {
  for (const [source, setter] of [
    [refillReader, "setAutoReading"],
    [logisticsGate, "setAutoRead"],
    [storeGate, "setAutoRead"],
    [billsGate, "setAutoRead"],
  ] as const) {
    assertStringIncludes(source, "Speech.speak");
    assertStringIncludes(source, "onDone:");
    assertStringIncludes(source, "nextChapter");
    assertStringIncludes(source, setter);
    assertStringIncludes(source, "void Speech.stop()");
    assertStringIncludes(source, "Read aloud");
  }
  for (const source of [logisticsGate, storeGate, billsGate]) {
    assertStringIncludes(source, "scrollRef.current?.scrollTo");
  }
  assertStringIncludes(refillReader, "key={safeIndex}");
});
Deno.test("admin can draft, edit, publish and review app-specific policies", () => {
  for (const scope of ["lpg", "logistics", "store", "bills"]) assertStringIncludes(admin, scope);
  assertStringIncludes(admin, "read_policy_admin_catalog");
  assertStringIncludes(admin, "create_policy_version");
  assertStringIncludes(admin, "update_policy_draft");
  assertStringIncludes(admin, "publish_policy_version");
});
Deno.test("four customer policy readers use compact, consistent presentation primitives", () => {
  assertStringIncludes(refillReader, "<Screen");
  assertStringIncludes(refillReader, "denseHeader");
  assertStringIncludes(lpgScreen, "denseHeader?: boolean");
  assertStringIncludes(lpgCard, "gap?: number");
  assertStringIncludes(refillReader, '<Card padding="sm" gap={10}>');
  for (const source of [logisticsGate, storeGate, billsGate]) {
    assertStringIncludes(source, "headerBrandRow");
    assertStringIncludes(source, "publishedTag");
    assertStringIncludes(source, "paddingTop: 14");
    assertStringIncludes(source, "fontSize: 20, lineHeight: 25");
    assertStringIncludes(source, "padding: 11");
  }
});

Deno.test("database migrations define and publish the three separate customer policies", () => {
  for (const key of ["policy.customer.logistics.terms", "policy.customer.store.terms", "policy.customer.bills.terms"]) {
    assertStringIncludes(docsMigration + versionsMigration, key);
  }
  assertStringIncludes(versionsMigration, "requires_reacceptance");
  assertStringIncludes(versionsMigration, "'published'");
});
