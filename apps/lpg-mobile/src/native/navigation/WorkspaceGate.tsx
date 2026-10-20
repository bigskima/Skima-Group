import { Redirect } from "expo-router";
import { useEffect, useState, type PropsWithChildren } from "react";
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
  const [stationInviteChecked, setStationInviteChecked] = useState(workspace !== "station_driver");
  const access = domainQueries.workspaceAccess(
    session.status === "authenticated" && workspace !== "customer",
  );

  useEffect(() => {
    if (session.status === "authenticated") guide.setWorkspace(workspace === "station_driver" ? "driver" : workspace);
  }, [guide, session.status, workspace]);

  useEffect(() => {
    if (workspace !== "station_driver" || session.status !== "authenticated") {
      setStationInviteChecked(true);
      return;
    }
    let active = true;
    setStationInviteChecked(false);
    void Promise.resolve(session.supabase.rpc("accept_lpg_station_managed_driver_invite")).then(async ({ error }) => {
      if (!active) return;
      // No matching invitation is expected for users who already have workspace access.
      if (!error) await access.refetch();
      if (active) setStationInviteChecked(true);
    }).catch(() => { if (active) setStationInviteChecked(true); });
    return () => { active = false; };
  }, [workspace, session.status, session.supabase, access.refetch]);

  if (session.status === "loading") {
    return <Loading canvas={palette.canvas} />;
  }

  if (session.status !== "authenticated") {
    return <Redirect href="/(auth)/login" />;
  }

  if (workspace === "customer" || session.context?.platformAdmin) {
    return <>{children}</>;
  }

  if (access.isPending || (workspace === "station_driver" && !stationInviteChecked)) {
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
