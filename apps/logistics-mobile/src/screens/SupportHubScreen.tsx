import { SupportHubScreen as SharedSupportHubScreen } from "@skima/mobile-experience/SupportHubScreen";
import { router } from "expo-router";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";

export function SupportHubScreen({ workspace = "customer" }: { workspace?: string }) {
  const session = useSession();
  const { palette } = useAppTheme();
  return (
    <SharedSupportHubScreen
      supabase={session.supabase}
      userId={session.session?.user.id ?? ""}
      permissions={session.context?.permissions ?? []}
      palette={palette}
      appKey="logistics"
      workspace={workspace}
      onBack={() => router.back()}
    />
  );
}
