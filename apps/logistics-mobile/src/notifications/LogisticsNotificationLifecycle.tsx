import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { useSession } from "../session/SessionProvider";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const INSTALLATION_KEY = "skima.push.installation.logistics.v1";

export async function registerLogisticsPushDevice(session: Session | null, supabase: ReturnType<typeof useSession>["supabase"]) {
  if (!session?.user.id || !Device.isDevice || (Platform.OS !== "ios" && Platform.OS !== "android")) return false;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return false;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("logistics", {
      name: "Logistics and delivery updates",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#E21D2E",
    });
  }
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return false;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  let installationId = await AsyncStorage.getItem(INSTALLATION_KEY);
  if (!installationId) {
    installationId = "skima-logistics-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
    await AsyncStorage.setItem(INSTALLATION_KEY, installationId);
  }
  const { error } = await supabase.rpc("register_skima_push_device", {
    target_app_key: "logistics",
    target_platform: Platform.OS,
    target_expo_push_token: token,
    target_expo_project_id: projectId,
    target_installation_id: installationId,
    target_permission_status: "granted",
    target_app_version: Constants.expoConfig?.version ?? null,
    target_device_name: Device.modelName ?? null,
  });
  if (error) throw error;
  return true;
}

function openNotificationRoute(response: Notifications.NotificationResponse | null) {
  if (!response) return;
  const data = response.notification.request.content.data;
  const raw = data?.path ?? data?.deepLink ?? data?.route;
  if (typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//")) {
    router.push(raw as never);
  }
}

export function LogisticsNotificationLifecycle() {
  const session = useSession();
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(openNotificationRoute);
    void Notifications.getLastNotificationResponseAsync().then(openNotificationRoute).catch(() => undefined);
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (session.status === "authenticated") {
      void registerLogisticsPushDevice(session.session, session.supabase).catch((cause) => {
        if (__DEV__) console.info("SKIMA Logistics push registration unavailable", cause);
      });
    }
  }, [session.status, session.session?.user.id, session.supabase]);
  useEffect(() => {
    const subscription = Notifications.addPushTokenListener(() => {
      if (session.status === "authenticated") {
        void registerLogisticsPushDevice(session.session, session.supabase).catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [session.status, session.session?.user.id, session.supabase]);
  return null;
}

export async function requestLogisticsNotificationPermission() {
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error("Notification permission was not granted.");
  await Notifications.setNotificationChannelAsync("logistics", {
    name: "Logistics and delivery updates",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#E21D2E",
  });
  return permission;
}
