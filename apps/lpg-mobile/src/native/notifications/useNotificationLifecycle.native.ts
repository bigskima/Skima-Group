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

function openNotificationRoute(response: Notifications.NotificationResponse | null) {
  if (!response) return;

  const data = response.notification.request.content.data ?? {};
  const routeData = data.route;
  const routePath = routeData && typeof routeData === "object" && !Array.isArray(routeData)
    ? (routeData as Record<string, unknown>).path
    : data.path ?? data.deepLink;

  if (data.app === "bills") {
    const safePath = typeof routePath === "string" && routePath.startsWith("/") && !routePath.startsWith("//")
      ? routePath
      : "/";
    router.push({ pathname: "/(customer)/bills", params: { moduleRoute: safePath } } as never);
    return;
  }

  if (typeof routePath === "string" && routePath.startsWith("/") && !routePath.startsWith("//")) {
    router.push(routePath as never);
  }
}

export function useNotificationLifecycle() {
  useEffect(() => {
    const response = Notifications.addNotificationResponseReceivedListener(openNotificationRoute);
    void Notifications.getLastNotificationResponseAsync()
      .then(openNotificationRoute)
      .catch(() => undefined);
    return () => response.remove();
  }, []);
}

export async function enableNotifications() {
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error("Notification permission was not granted.");
}
