import { useNetInfo } from "@react-native-community/netinfo";
import type { PropsWithChildren, ReactElement, ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type RefreshControlProps,
} from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, spacing, typography } from "../theme/tokens";

export function Screen({
  children,
  title,
  eyebrow,
  subtitle,
  action,
  refreshControl,
}: PropsWithChildren<{
  title: string;
  eyebrow?: string;
  subtitle?: string;
  action?: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
}>) {
  const { palette } = useAppTheme();
  const network = useNetInfo();
  const { width } = useWindowDimensions();
  const compact = width < 600;

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
      style={[styles.page, { backgroundColor: palette.canvas }]}
      contentContainerStyle={styles.outer}
    >
      <View
        style={[
          styles.content,
          {
            maxWidth: width >= 1024 ? 1120 : 780,
            paddingHorizontal: compact ? 18 : 24,
          },
        ]}
      >
        {network.isConnected === false ? (
          <View
            accessibilityRole="alert"
            style={[
              styles.offline,
              {
                backgroundColor: palette.warningSoft,
                borderColor: palette.warning,
              },
            ]}
          >
            <View style={[styles.offlineDot, { backgroundColor: palette.warning }]} />
            <Text style={[styles.offlineText, { color: palette.ink }]}>You’re offline. Saved details remain available.</Text>
          </View>
        ) : null}

        <View style={[styles.heading, compact && styles.headingCompact]}>
          <View style={styles.headingCopy}>
            {eyebrow ? (
              <View style={[styles.eyebrowPill, { backgroundColor: palette.brandSoft }]}>
                <Text style={[styles.eyebrow, { color: palette.brand }]}>{eyebrow}</Text>
              </View>
            ) : null}
            <Text
              numberOfLines={2}
              style={[
                styles.title,
                { color: palette.ink },
                compact && styles.titleMobile,
              ]}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text style={[styles.subtitle, { color: palette.muted }]}>{subtitle}</Text>
            ) : null}
          </View>
          {action ? <View style={[styles.action, compact && styles.actionCompact]}>{action}</View> : null}
        </View>

        <View style={styles.body}>{children}</View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  outer: { alignItems: "center", paddingTop: spacing.md, paddingBottom: 112 },
  content: { width: "100%" },
  body: { gap: spacing.md },
  heading: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
    marginBottom: spacing.lg,
    paddingTop: spacing.xs,
  },
  headingCompact: { minHeight: 64, marginBottom: spacing.md },
  headingCopy: { flex: 1, alignItems: "flex-start", gap: 7 },
  action: { alignSelf: "center" },
  actionCompact: { alignSelf: "flex-start", paddingTop: 2 },
  eyebrowPill: {
    minHeight: 24,
    justifyContent: "center",
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  eyebrow: {
    ...typography.eyebrow,
    textTransform: "uppercase",
  },
  title: { ...typography.title },
  titleMobile: { fontSize: 25, lineHeight: 30, letterSpacing: -0.55 },
  subtitle: { ...typography.body, maxWidth: 620 },
  offline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: spacing.md,
  },
  offlineDot: { width: 7, height: 7, borderRadius: 4 },
  offlineText: { fontSize: 12, fontWeight: "700", textAlign: "center" },
});
