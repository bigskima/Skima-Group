import { assertStringIncludes } from "jsr:@std/assert";
const decoder = new TextDecoder();
async function read(path: string) {
  return decoder.decode(await Deno.readFile(path));
}
const [refillGate, refillReader, logisticsGate, storeGate, billsGate, docsMigration, versionsMigration, admin] = await Promise.all([
  read("apps/lpg-mobile/src/native/policies/RefillCustomerPolicyGate.tsx"),
  read("apps/lpg-mobile/src/native/ui/PolicyDocumentScreen.tsx"),
  read("apps/logistics-mobile/src/policies/PolicyConsentGate.tsx"),
  read("apps/store-mobile/src/policies/PolicyConsentGate.tsx"),
  read("apps/bills-mobile/src/policies/PolicyConsentGate.tsx"),
  read("supabase/migrations/20261108001245_add_customer_terms_for_logistics_store_bills.sql"),
  read("supabase/migrations/20261108001644_publish_initial_customer_terms_v1.sql"),
  read("apps/admin/src/features/experience/PolicyWorkspaceV2.tsx"),
]);
Deno.test("all four customer apps require their own current accepted policy", () => {
  for (const [source, key] of [
    [refillGate, "policy.customer.terms"],
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
Deno.test("admin can draft, edit, publish and review app-specific policies", () => {
  for (const scope of ["lpg", "logistics", "store", "bills"]) assertStringIncludes(admin, scope);
  assertStringIncludes(admin, "read_policy_admin_catalog");
  assertStringIncludes(admin, "create_policy_version");
  assertStringIncludes(admin, "update_policy_draft");
  assertStringIncludes(admin, "publish_policy_version");
});
Deno.test("database migrations define and publish the three separate customer policies", () => {
  for (const key of ["policy.customer.logistics.terms", "policy.customer.store.terms", "policy.customer.bills.terms"]) {
    assertStringIncludes(docsMigration + versionsMigration, key);
  }
  assertStringIncludes(versionsMigration, "requires_reacceptance");
  assertStringIncludes(versionsMigration, "'published'");
});
