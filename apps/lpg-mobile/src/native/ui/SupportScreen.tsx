import { useSegments } from "expo-router";
import { SupportCenter } from "./SupportCenter";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";

export function SupportScreen() {
  const segments = useSegments();
  const workspace = String(segments[0] ?? "customer").replace(/[()]/g, "");
  const session = useSession();
  const { palette } = useAppTheme();
  const permissions = session.context?.permissions ?? [];
  const canManage = permissions.includes("platform.support.manage")
    || permissions.includes("platform.support.manage.refill");
  return (
    <SupportCenter
      appKey="refill"
      workspace={workspace}
      supabase={session.supabase}
      palette={palette}
      canManage={canManage}
    />
  );
}
