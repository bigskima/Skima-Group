export async function presentBackendNotification(input: {
  title: string;
  body: string;
  path?: string;
}) {
  if (!("Notification" in globalThis) || Notification.permission !== "granted")
    return;
  const notification = new Notification(input.title, { body: input.body });
  notification.onclick = () => {
    globalThis.focus();
    if (input.path?.startsWith("/") && !input.path.startsWith("//")) {
      globalThis.location.assign(input.path);
    }
    notification.close();
  };
}
