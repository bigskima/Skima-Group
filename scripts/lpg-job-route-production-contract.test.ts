const root = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

Deno.test("stale LPG job routes require historical assignment evidence", async () => {
  const migration = await read(
    "supabase/migrations/20260913160448_lpg_historical_job_route_states.sql",
  );

  assertIncludes(migration, "public.can_access_lpg_order(target_lpg_order_id)");
  assertIncludes(migration, "public.lpg_station_capacity_reservations");
  assertIncludes(migration, "public.lpg_order_events");
  assertIncludes(migration, "event.metadata ->> 'station_branch_id'");
  assertIncludes(migration, "event.metadata ->> 'driver_profile_id'");
  assertIncludes(migration, "public.user_can_operate_lpg_station_branch(");
  assertIncludes(migration, "driver.user_id = auth.uid()");
  assertIncludes(migration, "raise exception 'LPG order access permission is required'");
});

Deno.test("stale LPG job routes expose only minimal reason states", async () => {
  const migration = await read(
    "supabase/migrations/20260913160448_lpg_historical_job_route_states.sql",
  );

  for (const reason of [
    "payment_expired",
    "cancelled",
    "failed",
    "refunded",
    "completed",
    "reassigned",
  ]) {
    assertIncludes(migration, `'${reason}'`);
  }

  assertIncludes(migration, "'publicReference', order_record.public_reference");
  assertNotIncludes(migration, "'customerUserId'");
  assertNotIncludes(migration, "'pickupLocation'");
  assertNotIncludes(migration, "'deliveryLocation'");
});

Deno.test("Station and Driver stale job screens explain why work disappeared", async () => {
  const screen = await read("apps/lpg-mobile/src/native/ui/JobDetailRouteScreen.tsx");

  assertIncludes(screen, 'reason === "payment_expired"');
  assertIncludes(screen, 'reason === "reassigned"');
  assertIncludes(screen, 'reason === "completed"');
  assertIncludes(screen, 'reason === "cancelled" || reason === "failed"');
  assertIncludes(screen, 'title: "Order reassigned to another Station"');
  assertIncludes(screen, 'title: "Delivery reassigned"');
  assertIncludes(screen, 'title: "Order was cancelled"');
  assertIncludes(screen, 'title: "Job already completed"');
  assertIncludes(screen, "Do not process the cylinder from this old job");
  assertIncludes(screen, "Do not continue pickup or delivery from this old job");
});

function assertIncludes(value: string, expected: string) {
  if (!value.includes(expected)) throw new Error(`Expected source to include: ${expected}`);
}

function assertNotIncludes(value: string, expected: string) {
  if (value.includes(expected)) throw new Error(`Expected source not to include: ${expected}`);
}
