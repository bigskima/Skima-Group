import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const FIXED_ROUTES = new Set([
  "/(customer)", "/(customer)/activity", "/(customer)/wallet", "/(customer)/top-up",
  "/(customer)/withdraw", "/(customer)/beneficiaries", "/(customer)/notifications",
  "/(customer)/store", "/(customer)/account",
]);

function safeRoute(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("://")) return null;
  if (FIXED_ROUTES.has(value)) return value;
  const receiptPrefix = "/(customer)/receipt/";
  if (value.startsWith(receiptPrefix)) {
    const id = value.slice(receiptPrefix.length);
    const groups = id.split("-");
    const expectedLengths = [8, 4, 4, 4, 12];
    const validUuid = groups.length === 5 && groups.every((group, index) =>
      group.length === expectedLengths[index] &&
      [...group].every((character) => "0123456789abcdef".includes(character.toLowerCase()))
    );
    if (validUuid) return value;
  }
  return null;
}

export function BillsNotificationLifecycle() {
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((event) => {
      const route = safeRoute(event.notification.request.content.data?.path);
      if (route) router.push(route as never);
    });
    return () => subscription.remove();
  }, []);
  return null;
}

export async function requestBillsNotificationPermission() {
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error("Notification permission was not granted.");
  return permission;
}
