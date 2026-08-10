import * as Notifications from "expo-notifications";

export async function presentBackendNotification(input: {
  title: string;
  body: string;
  path?: string;
}) {
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: input.title,
      body: input.body,
      data: input.path ? { path: input.path } : {},
      sound: true,
    },
    trigger: null,
  });
}
