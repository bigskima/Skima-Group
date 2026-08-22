import { useNetInfo } from "@react-native-community/netinfo";
import { WifiOff } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing } from "../theme/tokens";

export function ConnectivityNotice() {
  const network = useNetInfo();
  const insets = useSafeAreaInsets();
  const { palette } = useAppTheme();
  const offline =
    network.isConnected === false || network.isInternetReachable === false;

  if (!offline) return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.notice,
        {
          bottom: Math.max(insets.bottom, spacing.sm) + 72,
          backgroundColor: palette.surface,
          borderColor: palette.borderStrong,
        },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: palette.warningSoft }]}>
        <WifiOff color={palette.warning} size={18} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: palette.ink }]}>You’re offline</Text>
        <Text style={[styles.body, { color: palette.muted }]}>
          Some information may be out of date. Actions that need internet will work again after you reconnect.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    position: "absolute",
    zIndex: 1100,
    left: spacing.md,
    right: spacing.md,
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 8,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 13, fontWeight: "900" },
  body: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
});
