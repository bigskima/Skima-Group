import { assert, assertStringIncludes } from "jsr:@std/assert@1.0.18";

const migration = await Deno.readTextFile("supabase/migrations/20260906072000_utility_rewards_and_safe_admin_directory.sql");
const stationLayout = await Deno.readTextFile("apps/lpg-mobile/app/(station)/_layout.tsx");
const dashboard = await Deno.readTextFile("apps/lpg-mobile/src/native/ui/PremiumDashboard.tsx");
const guide = await Deno.readTextFile("apps/admin/src/admin-utility-provider-guide.tsx");

Deno.test("cashback is prepared from policy and only earned after confirmed success", () => {
  assertStringIncludes(migration, "create table if not exists public.utility_reward_policies");
  assertStringIncludes(migration, "new.status='succeeded'");
  assertStringIncludes(migration, "status='earned'");
  assertStringIncludes(migration, "status='cancelled'");
  assert(!migration.includes("insert into public.wallet_ledger_entries"));
});

Deno.test("admin provider directory never exposes provider credentials", () => {
  const safeDirectory = migration.slice(migration.indexOf("'providers'"));
  assert(!safeDirectory.includes("secret_ref"));
  assert(!safeDirectory.includes("row_to_json(item) from public.provider_adapters"));
});

Deno.test("customer home exposes bills while station location screens stay off the tab bar", () => {
  assertStringIncludes(dashboard, "CustomerServiceCards");
  assertStringIncludes(dashboard, 'router.push("/(customer)/bills")');
  assertStringIncludes(stationLayout, '"locations"');
  assertStringIncludes(stationLayout, '"location-editor"');
});

Deno.test("admin includes provider access guidance from official provider sites", () => {
  assertStringIncludes(guide, "https://www.vtpass.com/documentation/");
  assertStringIncludes(guide, "https://developers.reloadly.com/airtime/docs");
  assertStringIncludes(guide, "test credentials");
});
