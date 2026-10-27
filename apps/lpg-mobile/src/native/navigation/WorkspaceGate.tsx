import { Redirect } from "expo-router";
import { useEffect, type PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import { domainQueries } from "../api/domains";
import { firstString, nestedRecords, type PlatformRecord } from "../api/records";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { useInAppGuide } from "../onboarding/InAppGuideProvider";

type Workspace = "customer" | "driver" | "station" | "station_driver";

export function WorkspaceGate({
  workspace,
  children,
}: PropsWithChildren<{ workspace: Workspace }>) {
  const session = useSession();
  const { palette } = useAppTheme();
  const guide = useInAppGuide();
  const access = domainQueries.workspaceAccess(
    session.status === "authenticated" && workspace !== "customer",
  );

  useEffect(() => {
    // Station Managed drivers have a separate route group and no independent-driver guide routes.
    // Do not launch the independent-driver tour from this workspace.
    if (session.status === "authenticated" && workspace !== "station_driver") guide.setWorkspace(workspace);
  }, [guide, session.status, workspace]);


  if (session.status === "loading") {
    return <Loading canvas={palette.canvas} />;
  }

  if (session.status !== "authenticated") {
    return <Redirect href="/(auth)/login" />;
  }

  if (workspace === "customer" || session.context?.platformAdmin) {
    return <>{children}</>;
  }

  if (access.isPending) {
    return <Loading canvas={palette.canvas} />;
  }

  return hasWorkspace(access.data, workspace) ? <>{children}</> : <Redirect href="/(customer)" />;
}

function Loading({ canvas }: { canvas: string }) {
  return (
    <View style={[styles.loading, { backgroundColor: canvas }]}>
      <ScreenSkeleton cards={4} />
    </View>
  );
}

function hasWorkspace(data: PlatformRecord | null | undefined, workspace: Workspace) {
  return nestedRecords(data, "workspaces").some((item) =>
    firstString(item, ["key"]) === workspace &&
    firstString(item, ["status"]) === "active"
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, padding: 24 },
});
