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

Deno.test("driver daily brief follows canonical LPG lifecycle states", () => {
  const canonicalSql = normalizeWhitespace(lifecycleGuardSql);
  const briefSql = normalizeWhitespace(driverBriefSql);

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
    assertIncludes(
      canonicalSql,
      `'${required}'`,
      `canonical LPG lifecycle guard must recognize ${required}`,
    );
    assertIncludes(
      briefSql,
      `'${required}'`,
      `driver daily brief must use canonical operational state ${required}`,
    );
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
    assertNotIncludes(
      briefSql,
      `'${legacyOrInvented}'`,
      `driver daily brief must not use invented/legacy state ${legacyOrInvented}`,
    );
  }
});

function normalizeWhitespace(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function assertIncludes(value: string, expected: string, message: string): void {
  if (!value.includes(expected)) {
    throw new Error(message + `\nExpected to include: ${expected}`);
  }
}

function assertNotIncludes(value: string, unexpected: string, message: string): void {
  if (value.includes(unexpected)) {
    throw new Error(message + `\nUnexpected content: ${unexpected}`);
  }
}

function assertNotMatch(value: string, pattern: RegExp, message: string): void {
  if (pattern.test(value)) {
    throw new Error(message + `\nUnexpected pattern: ${String(pattern)}`);
  }
}
