import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }) });
export function useNotificationLifecycle() { useEffect(() => { const response = Notifications.addNotificationResponseReceivedListener((event) => { const path = event.notification.request.content.data?.path; if (typeof path === "string" && path.startsWith("/") && !path.startsWith("//")) router.push(path as never); }); return () => response.remove(); }, []); }
export async function enableNotifications() { const current = await Notifications.getPermissionsAsync(); const permission = current.granted ? current : await Notifications.requestPermissionsAsync(); if (!permission.granted) throw new Error("Notification permission was not granted."); }
