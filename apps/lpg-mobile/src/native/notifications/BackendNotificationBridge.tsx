import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef } from "react";
import { domainQueries } from "../api/domains";
import { firstString, nestedRecord, recordId } from "../api/records";
import { useSession } from "../session/SessionProvider";
import { presentBackendNotification } from "./presenter";

export function BackendNotificationBridge() {
  const session = useSession();
  const messages = domainQueries.notifications();
  const processing = useRef(false);
  const owner = session.context?.profile?.id ?? session.context?.user.id;

  useEffect(() => {
    if (!owner || !messages.data || processing.current) return;
    processing.current = true;
    void reconcile(owner, messages.data).finally(() => {
      processing.current = false;
    });
  }, [messages.data, owner]);
  return null;
}

async function reconcile(owner: string, messages: Record<string, unknown>[]) {
  const key = `skima:lpg:notification-seen:v1:${owner}`;
  const currentIds = messages.map(recordId).filter(Boolean) as string[];
  const stored = await AsyncStorage.getItem(key);
  if (!stored) {
    await AsyncStorage.setItem(key, JSON.stringify(currentIds.slice(0, 250)));
    return;
  }
  let seen: string[] = [];
  try {
    const parsed = JSON.parse(stored) as unknown;
    seen = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    seen = [];
  }
  const known = new Set(seen);
  const fresh = messages.filter((message) => {
    const id = recordId(message);
    return Boolean(id && !known.has(id));
  });
  for (const message of fresh.reverse()) {
    const payload = nestedRecord(message, "payload");
    await presentBackendNotification({
      title: firstString(payload, ["title", "subject"]) ?? notificationTitle(message),
      body:
        firstString(payload, ["body", "message", "text"]) ??
        "You have a new update in SKIMA.",
      path:
        firstString(payload, ["deepLink", "deep_link", "route"]) ?? undefined,
    });
  }
  await AsyncStorage.setItem(
    key,
    JSON.stringify([...currentIds, ...seen].slice(0, 250)),
  );
}

function notificationTitle(message: Record<string, unknown>) {
  const purpose = firstString(message, ["purpose"]);
  const titles: Record<string, string> = {
    delivery_completed: "Delivery complete",
    driver_assigned: "Driver assigned",
    order_created: "Order received",
    payment_received: "Payment received",
    pickup_confirmed: "Cylinder collected",
    refill_completed: "Refill complete",
    returning: "Your cylinder is on the way",
  };
  return (purpose && titles[purpose]) || "SKIMA update";
}
