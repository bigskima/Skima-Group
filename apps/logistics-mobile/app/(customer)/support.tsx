import { router } from "expo-router";
import { SupportCenter } from "../../src/ui/SupportCenter";
import { useSession } from "../../src/session/SessionProvider";
import { useAppTheme } from "../../src/theme/ThemeProvider";

export default function CustomerSupportRoute() {
  const { supabase, context } = useSession();
  const { palette } = useAppTheme();
  const permissions = context?.permissions ?? [];
  const canManage = permissions.includes("platform.support.manage")
    || permissions.includes("platform.support.manage.logistics");
  return <SupportCenter appKey="logistics" workspace="customer" supabase={supabase} palette={palette} canManage={canManage} onBack={() => router.back()} />;
}
