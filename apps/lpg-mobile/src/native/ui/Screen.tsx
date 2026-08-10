import type { PropsWithChildren, ReactElement, ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions, type RefreshControlProps } from "react-native";
import { colors, spacing } from "../theme/tokens";
import { useNetInfo } from "@react-native-community/netinfo";
import { useAppTheme } from "../theme/ThemeProvider";

export function Screen({ children, title, eyebrow, action, refreshControl }: PropsWithChildren<{ title: string; eyebrow?: string; action?: ReactNode; refreshControl?: ReactElement<RefreshControlProps> }>) {
  const { palette } = useAppTheme();
  const network = useNetInfo();
  const { width } = useWindowDimensions();
  return <ScrollView refreshControl={refreshControl} style={[styles.page, { backgroundColor: palette.canvas }]} contentContainerStyle={styles.outer}>
    <View style={[styles.content, { maxWidth: width >= 1024 ? 1180 : 760 }]}>
      {network.isConnected === false ? <View accessibilityRole="alert" style={styles.offline}><Text style={styles.offlineText}>You’re offline. Saved drafts remain available; reconnect before submitting backend actions.</Text></View> : null}
      <View style={styles.heading}>{eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}<Text style={[styles.title, { color: palette.ink }]}>{title}</Text>{action}</View>
      {children}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1 }, outer: { alignItems: "center", padding: spacing.lg, paddingBottom: 80 },
  content: { width: "100%", gap: spacing.lg }, heading: { gap: spacing.sm, marginTop: spacing.md },
  eyebrow: { color: colors.brand, fontSize: 13, fontWeight: "700", letterSpacing: 1.4, textTransform: "uppercase" },
  title: { fontSize: 32, lineHeight: 38, fontWeight: "800", letterSpacing: -0.8 },
  offline: { borderRadius: 12, padding: 12, backgroundColor: "#FFF0D8" }, offlineText: { color: "#7A4900", fontWeight: "700", textAlign: "center" }
});
