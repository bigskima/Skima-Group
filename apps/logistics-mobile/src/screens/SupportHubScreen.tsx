import { router } from "expo-router";
import { SupportCenter } from "../ui/SupportCenter";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";

export function SupportHubScreen({ workspace = "customer" }: { workspace?: string }) {
  const session = useSession();
  const { palette } = useAppTheme();
  const permissions = session.context?.permissions ?? [];
  const canManage = permissions.includes("platform.support.manage")
    || permissions.includes("platform.support.manage.logistics");
  return (
    <SupportCenter
      appKey="logistics"
      workspace={workspace}
      supabase={session.supabase}
      palette={palette}
      canManage={canManage}
      onBack={() => router.back()}
    />
  );
}
