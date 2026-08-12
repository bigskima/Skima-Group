import type { PropsWithChildren, ReactElement, ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions, type RefreshControlProps } from "react-native";
import { colors, radii, spacing } from "../theme/tokens";
import { useNetInfo } from "@react-native-community/netinfo";
import { useAppTheme } from "../theme/ThemeProvider";

export function Screen({ children, title, eyebrow, action, refreshControl }: PropsWithChildren<{ title: string; eyebrow?: string; action?: ReactNode; refreshControl?: ReactElement<RefreshControlProps> }>) {
  const { palette } = useAppTheme();
  const network = useNetInfo();
  const { width } = useWindowDimensions();
  const horizontalPadding = width < 600 ? 18 : spacing.lg;
  return <ScrollView refreshControl={refreshControl} style={[styles.page, { backgroundColor: palette.canvas }]} contentContainerStyle={[styles.outer, { paddingHorizontal: horizontalPadding }]}>
    <View style={[styles.content, { maxWidth: width >= 1024 ? 1120 : 780 }]}>
      {network.isConnected === false ? <View accessibilityRole="alert" style={[styles.offline, { backgroundColor: palette.warningSoft }]}><Text style={[styles.offlineText, { color: palette.ink }]}>You’re offline. We’ll keep your saved details here until you reconnect.</Text></View> : null}
      <View style={styles.heading}><View style={styles.headingCopy}>{eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}<Text style={[styles.title, { color: palette.ink }, width < 600 && styles.titleMobile]}>{title}</Text></View>{action ? <View style={styles.action}>{action}</View> : null}</View>
      {children}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { flex: 1 }, outer: { alignItems: "center", paddingTop: spacing.md, paddingBottom: 96 },
  content: { width: "100%", gap: spacing.lg },
  heading: { minHeight: 64, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md, marginTop: spacing.sm },
  headingCopy: { flex: 1, gap: 5 },
  action: { paddingTop: 3 },
  eyebrow: { color: colors.brand, fontSize: 11, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  title: { fontSize: 34, lineHeight: 40, fontWeight: "900", letterSpacing: -1.05 },
  titleMobile: { fontSize: 28, lineHeight: 34, letterSpacing: -.7 },
  offline: { borderRadius: radii.md, padding: 12 }, offlineText: { fontWeight: "700", textAlign: "center" }
});
