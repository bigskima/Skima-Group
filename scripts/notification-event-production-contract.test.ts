const root = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

Deno.test("support replies notify only on SKIMA admin messages", async () => {
  const migration = await read("supabase/migrations/20260913161409_support_complaint_notifications.sql");

  assertIncludes(migration, "new.author_kind <> 'admin'");
  assertIncludes(migration, "support.thread.reply");
  assertIncludes(migration, "support-reply-notification:' || new.id::text");
  assertIncludes(migration, "'category', 'support'");
  assertIncludes(migration, "when 'driver' then '/(driver)/support'");
  assertIncludes(migration, "when 'station' then '/(station)/support'");
  assertIncludes(migration, "else '/(customer)/support'");
  assertNotIncludes(migration, "'body', new.body");
});

Deno.test("complaint review notifications expose public-safe state only", async () => {
  const migration = await read("supabase/migrations/20260913161409_support_complaint_notifications.sql");

  assertIncludes(migration, "new.event_type <> 'complaint.status_changed'");
  assertIncludes(migration, "nullif(btrim(new.public_message), '')");
  assertIncludes(migration, "support.complaint.' || coalesce(new.to_status, 'updated')");
  assertIncludes(migration, "'deepLink', '/(customer)/support'");
  assertIncludes(migration, "'status', new.to_status");
  assertNotIncludes(migration, "new.internal_note");
  assertNotIncludes(migration, "complaint_record.description");
});

Deno.test("notification center has a first-class support filter", async () => {
  const screen = await read("apps/lpg-mobile/src/native/ui/NotificationsScreen.tsx");

  assertIncludes(screen, 'type NotificationCategory = "all" | "wallet" | "order" | "partner" | "support"');
  assertIncludes(screen, 'label="Support"');
  assertIncludes(screen, 'category === "support" || /support|complaint|case/.test(purpose)');
  assertIncludes(screen, 'if (category === "support") return <MessageCircle');
  assertIncludes(screen, "partner, and support updates will appear here");
});

function assertIncludes(value: string, expected: string) {
  if (!value.includes(expected)) throw new Error(`Expected source to include: ${expected}`);
}

function assertNotIncludes(value: string, expected: string) {
  if (value.includes(expected)) throw new Error(`Expected source not to include: ${expected}`);
}
