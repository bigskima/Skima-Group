import { Redirect } from "expo-router";
import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
export function WorkspaceGate({ workspace, children }: PropsWithChildren<{ workspace: "customer" | "driver" | "station" }>) { const session = useSession(); const { palette } = useAppTheme(); if (session.status === "loading") return <View style={[styles.loading, { backgroundColor: palette.canvas }]}><ScreenSkeleton cards={4} /></View>; if (session.status !== "authenticated") return <Redirect href="/(auth)/login" />; if (workspace === "customer" || session.context?.platformAdmin) return <>{children}</>; const keys = session.context?.roles.map((role) => role.key?.toLowerCase() ?? "") ?? []; const allowed = workspace === "driver" ? keys.some((key) => key.includes("driver")) : keys.some((key) => key.includes("station") || key.includes("partner")); return allowed ? <>{children}</> : <Redirect href="/(customer)" />; }
const styles = StyleSheet.create({ loading: { flex: 1, padding: 24 } });
