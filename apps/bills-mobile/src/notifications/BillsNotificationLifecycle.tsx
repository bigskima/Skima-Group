import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { navigateBillsRoute } from "../navigation/billsNavigation";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function openNotificationRoute(response: Notifications.NotificationResponse | null) {
  if (!response) return;
  const route = response.notification.request.content.data?.path;
  navigateBillsRoute(route);
}

export function BillsNotificationLifecycle() {
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(openNotificationRoute);
    void Notifications.getLastNotificationResponseAsync().then(openNotificationRoute).catch(() => undefined);
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
