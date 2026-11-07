import { SupportHubScreen as SharedSupportHubScreen } from "@skima/mobile-experience/SupportHubScreen";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";

export function SupportHubScreen({ workspace = "customer", onBack }: {
  workspace?: string;
  onBack?: () => void;
}) {
  const session = useSession();
  const { palette } = useAppTheme();
  return (
    <SharedSupportHubScreen
      supabase={session.supabase}
      userId={session.session?.user.id ?? ""}
      permissions={session.context?.permissions ?? []}
      palette={palette}
      appKey="bills"
      workspace={workspace}
      onBack={onBack}
    />
  );
}
