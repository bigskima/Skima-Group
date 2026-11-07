import { SupportCenter } from "../ui/SupportCenter";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";

export function SupportHubScreen({ workspace = "customer", onBack }: {
  workspace?: string;
  onBack?: () => void;
}) {
  const session = useSession();
  const { palette } = useAppTheme();
  const permissions = session.context?.permissions ?? [];
  const canManage = permissions.includes("platform.support.manage")
    || permissions.includes("platform.support.manage.store");
  return (
    <SupportCenter
      appKey="store"
      workspace={workspace}
      supabase={session.supabase}
      palette={palette}
      canManage={canManage}
      onBack={onBack}
    />
  );
}
