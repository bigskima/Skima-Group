import { router } from "expo-router";
import { SupportCenter } from "@skima/mobile-experience/SupportCenter";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";

export function SupportRouteScreen({ workspace }: {
  workspace: "customer" | "driver" | "station";
}) {
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
      onBack={() => router.back()}
    />
  );
}
