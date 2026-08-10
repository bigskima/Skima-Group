import { Redirect } from "expo-router";
import type { PropsWithChildren } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useSession } from "../session/SessionProvider";
import { colors } from "../theme/tokens";
export function WorkspaceGate({ workspace, children }: PropsWithChildren<{ workspace: "customer" | "driver" | "station" }>) { const session = useSession(); if (session.status === "loading") return <View style={styles.loading}><ActivityIndicator size="large" color={colors.brand} /></View>; if (session.status !== "authenticated") return <Redirect href="/(auth)/login" />; if (workspace === "customer" || session.context?.platformAdmin) return <>{children}</>; const keys = session.context?.roles.map((role) => role.key?.toLowerCase() ?? "") ?? []; const allowed = workspace === "driver" ? keys.some((key) => key.includes("driver")) : keys.some((key) => key.includes("station") || key.includes("partner")); return allowed ? <>{children}</> : <Redirect href="/(customer)" />; }
const styles = StyleSheet.create({ loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas } });
