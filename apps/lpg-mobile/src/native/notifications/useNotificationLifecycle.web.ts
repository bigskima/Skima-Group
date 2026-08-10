export function useNotificationLifecycle() {}
export async function enableNotifications() { if (!("Notification" in globalThis)) throw new Error("Browser notifications are not available."); const result = await Notification.requestPermission(); if (result !== "granted") throw new Error("Notification permission was not granted."); }
