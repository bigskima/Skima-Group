import { Text, View, StyleSheet } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, typography } from "../theme/tokens";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.row}>
      <View style={[styles.mark, compact && styles.markCompact, { backgroundColor: palette.brand }]}>
        <View style={styles.route} />
        <View style={styles.routeDot} />
      </View>
      {!compact ? (
        <View style={styles.wordmark}>
          <Text style={[styles.name, { color: palette.ink }]}>SKIMA</Text>
          <Text style={[styles.product, { color: palette.muted }]}>LOGISTICS</Text>
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  mark: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  markCompact: { width: 34, height: 34, borderRadius: 12 },
  route: { width: 20, height: 13, borderTopWidth: 2.5, borderRightWidth: 2.5, borderColor: "#FFFFFF", borderTopRightRadius: 9, transform: [{ rotate: "14deg" }] },
  routeDot: { position: "absolute", right: 10, bottom: 10, width: 5, height: 5, borderRadius: 3, backgroundColor: "#FFFFFF" },
  wordmark: { gap: 0 },
  name: { ...typography.sectionTitle, fontSize: 15, letterSpacing: 1.1, lineHeight: 18 },
  product: { ...typography.eyebrow, fontSize: 8, letterSpacing: 1.35 },
});
