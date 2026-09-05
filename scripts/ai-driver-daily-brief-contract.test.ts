const repositoryRoot = new URL("../", import.meta.url);

const [driverBriefSql, lifecycleGuardSql] = await Promise.all([
  Deno.readTextFile(new URL(
    "supabase/migrations/20260906013000_ai_driver_daily_brief.sql",
    repositoryRoot,
  )),
  Deno.readTextFile(new URL(
    "supabase/migrations/20260905223500_ai_demand_forecast_configuration_guard.sql",
    repositoryRoot,
  )),
]);

Deno.test("driver daily brief stays own-driver scoped and read-only", () => {
  const sql = normalizeWhitespace(driverBriefSql);

  assertIncludes(
    sql,
    "where driver.user_id = auth.uid()",
    "driver brief must resolve only the signed-in driver's profile",
  );
  assertIncludes(
    sql,
    "where orders.driver_profile_id = driver_record.id",
    "driver brief jobs must be scoped to that driver's assignments",
  );
  assertIncludes(
    sql,
    "join public.lpg_refill_orders orders on orders.id = commission.order_id",
    "earnings summary must prove commission ownership through the assigned LPG order",
  );
  assertIncludes(
    sql,
    "commission.status = 'posted'",
    "posted earnings must be distinguished from non-posted commission state",
  );

  for (const boundary of [
    "'doesnotchangeavailability', true",
    "'doesnotchangelocation', true",
    "'doesnotassignjobs', true",
    "'doesnotchangedispatchrank', true",
    "'doesnotchangeorderstate', true",
    "'doesnotpostcommission', true",
    "'doesnotmovewalletfunds', true",
  ]) {
    assertIncludes(
      sql,
      boundary,
      "driver brief must preserve boundary " + boundary,
    );
  }

  assertNotMatch(
    driverBriefSql,
    /\b(?:update|insert\s+into|delete\s+from)\s+public\.(?:driver_profiles|lpg_driver_locations|lpg_refill_orders|dispatch_requests|dispatch_candidates|commission_executions|wallet_accounts|wallet_ledger_entries|financial_transactions)\b/i,
    "driver daily brief must never mutate canonical driver, dispatch, order or finance state",
  );
  assertNotMatch(
    driverBriefSql,
    /provider\.ai\.|resolve_ai_provider_route|executeAiText|generativelanguage|chat\/completions/,
    "driver brief calculation must not require an LLM provider",
  );
});

Deno.test("driver daily brief uses only canonical LPG lifecycle states", () => {
  const canonicalStates = extractCanonicalLifecycleStates(lifecycleGuardSql);
  const referencedStates = extractDriverBriefOrderStates(driverBriefSql);

  const unknown = [...referencedStates].filter((status) => !canonicalStates.has(status));
  if (unknown.length) {
    throw new Error(
      "driver daily brief references non-canonical LPG order states: " + unknown.join(", "),
    );
  }

  for (const required of [
    "driver_offered",
    "driver_accepted",
    "pickup_en_route",
    "pickup_verified",
    "station_en_route",
    "station_verified",
    "refill_in_progress",
    "refill_confirmed",
    "station_settled",
    "return_en_route",
    "delivery_verification_pending",
    "delivered",
    "disputed",
  ]) {
    if (!referencedStates.has(required)) {
      throw new Error("driver daily brief is missing canonical operational state " + required);
    }
  }

  for (const legacyOrInvented of [
    "driver_assigned",
    "pickup_started",
    "pickup_confirmed",
    "arrived_station",
    "return_in_transit",
    "delivery_arrived",
    "delivery_challenge_pending",
    "delivery_verified",
  ]) {
    if (referencedStates.has(legacyOrInvented)) {
      throw new Error("driver daily brief must not use invented/legacy state " + legacyOrInvented);
    }
  }
});

function extractCanonicalLifecycleStates(sql: string): Set<string> {
  const marker = "forecast order statuses must use canonical non-failed lpg lifecycle states";
  const normalized = sql.toLowerCase();
  const markerIndex = normalized.indexOf(marker);
  const source = markerIndex >= 0 ? normalized.slice(Math.max(0, markerIndex - 2600), markerIndex) : normalized;
  return new Set(
    [...source.matchAll(/'([a-z][a-z0-9_]*)'/g)].map((match) => match[1]),
  );
}

function extractDriverBriefOrderStates(sql: string): Set<string> {
  const ignored = new Set([
    "approved",
    "available",
    "busy",
    "online",
    "posted",
    "authentication required",
    "driver workspace access is required",
  ]);
  return new Set(
    [...sql.toLowerCase().matchAll(/'([a-z][a-z0-9_]*)'/g)]
      .map((match) => match[1])
      .filter((value) =>
        !ignored.has(value) &&
        (
          value.includes("driver") ||
          value.includes("pickup") ||
          value.includes("station") ||
          value.includes("refill") ||
          value.includes("return") ||
          value.includes("delivery") ||
          ["delivered","completed","cancelled","refunded","failed","disputed"].includes(value)
        )
      ),
  );
}

function normalizeWhitespace(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function assertIncludes(value: string, expected: string, message: string): void {
  if (!value.includes(expected)) {
    throw new Error(message + `\nExpected to include: ${expected}`);
  }
}

function assertNotMatch(value: string, pattern: RegExp, message: string): void {
  if (pattern.test(value)) {
    throw new Error(message + `\nUnexpected pattern: ${String(pattern)}`);
  }
}
