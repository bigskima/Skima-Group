const ROOT = new URL("../", import.meta.url);

async function read(path: string) {
  return await Deno.readTextFile(new URL(path, ROOT));
}

function requireText(source: string, expected: string, message: string) {
  if (!source.includes(expected)) {
    throw new Error(`${message}\nMissing contract text: ${expected}`);
  }
}

function rejectText(source: string, forbidden: string, message: string) {
  if (source.includes(forbidden)) {
    throw new Error(`${message}\nForbidden contract text: ${forbidden}`);
  }
}

Deno.test("LPG shared mobile chrome protects compact layouts and safe areas", async () => {
  const [tabs, screen, button, modal] = await Promise.all([
    read("apps/lpg-mobile/src/native/navigation/WorkspaceTabs.tsx"),
    read("apps/lpg-mobile/src/native/ui/Screen.tsx"),
    read("apps/lpg-mobile/src/native/ui/AppButton.tsx"),
    read("apps/lpg-mobile/src/native/ui/AppModal.tsx"),
  ]);

  requireText(tabs, 'useSafeAreaInsets', "Workspace navigation must explicitly account for device safe areas.");
  requireText(tabs, 'const mobileBottom = Math.max(12, insets.bottom);', "Bottom navigation must stay clear of phone home indicators and navigation bars.");
  requireText(screen, 'headingCompact: { minHeight: 62, marginBottom: 18, flexWrap: "wrap" }', "Compact headers must be able to wrap actions instead of crushing titles.");
  requireText(screen, 'headingCopy: { flex: 1, minWidth: 0', "Screen heading copy must be shrink-safe on narrow widths.");
  requireText(button, '<Text numberOfLines={2}', "Shared action buttons must allow important labels to wrap instead of silently truncating.");
  requireText(button, 'label: { flexShrink: 1, minWidth: 0', "Shared action labels must be shrink-safe.");
  requireText(modal, '<ScrollView', "Shared dialogs must remain usable when their content is taller than the viewport.");
  requireText(modal, 'keyboardShouldPersistTaps="handled"', "Shared dialogs must remain usable with forms and the on-screen keyboard.");
});

Deno.test("LPG public entry, auth and AI surfaces avoid unreadably small helper text", async () => {
  const [welcome, auth, launcher] = await Promise.all([
    read("apps/lpg-mobile/app/(auth)/welcome.tsx"),
    read("apps/lpg-mobile/src/native/ui/AuthShell.tsx"),
    read("apps/lpg-mobile/src/native/ui/AiAssistantLauncher.tsx"),
  ]);

  rejectText(welcome, 'roleNote: { fontSize: 8', "Welcome role guidance must not regress to 8px text.");
  rejectText(welcome, 'trustText: { fontSize: 9', "Welcome trust labels must remain readable.");
  requireText(welcome, 'roleNote: { fontSize: 10', "Welcome role notes must retain the readability pass.");
  rejectText(auth, 'roleBody: { fontSize: 8', "Login and registration role guidance must not regress to 8px text.");
  rejectText(auth, 'privacyText: { fontSize: 9', "Login and registration security guidance must remain readable.");
  requireText(auth, 'roleBody: { fontSize: 10', "Login and registration role guidance must retain the readability pass.");
  requireText(auth, 'privacyText: { fontSize: 10', "Login and registration privacy guidance must retain the readability pass.");
  rejectText(launcher, 'fontSize: 8', "AI launcher helper and action text must not regress to 8px.");
  requireText(launcher, '<Text numberOfLines={2} style={styles.actionText}', "AI launcher actions must remain readable when labels are longer.");
});
