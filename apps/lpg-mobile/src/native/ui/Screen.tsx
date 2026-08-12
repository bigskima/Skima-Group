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
import { colors, radii, spacing } from "../theme/tokens";

export function Screen({ children, title, eyebrow, action, refreshControl }: PropsWithChildren<{
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
}>) {
  const { palette } = useAppTheme();
  const network = useNetInfo();
  const { width } = useWindowDimensions();
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
      <View style={[styles.content, { maxWidth: width >= 1024 ? 1120 : 780, paddingHorizontal: width < 600 ? 18 : 24 }]}>
        {network.isConnected === false ? (
          <View accessibilityRole="alert" style={[styles.offline, { backgroundColor: palette.warningSoft }]}>
            <Text style={[styles.offlineText, { color: palette.ink }]}>You’re offline. Saved details remain available.</Text>
          </View>
        ) : null}
        <View style={styles.heading}>
          <View style={styles.headingCopy}>
            {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
            <Text numberOfLines={2} style={[styles.title, { color: palette.ink }, width < 600 && styles.titleMobile]}>{title}</Text>
          </View>
          {action ? <View style={styles.action}>{action}</View> : null}
        </View>
        {children}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  outer: { alignItems: "center", paddingTop: 10, paddingBottom: 102 },
  content: { width: "100%", gap: 16 },
  heading: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 2 },
  headingCopy: { flex: 1, gap: 3 },
  action: { alignSelf: "center" },
  eyebrow: { color: colors.brand, fontSize: 9, lineHeight: 12, fontWeight: "900", letterSpacing: 1.3, textTransform: "uppercase" },
  title: { fontSize: 28, lineHeight: 32, fontWeight: "900", letterSpacing: -.7 },
  titleMobile: { fontSize: 24, lineHeight: 28, letterSpacing: -.5 },
  offline: { borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 9 },
  offlineText: { fontSize: 12, fontWeight: "700", textAlign: "center" },
});
