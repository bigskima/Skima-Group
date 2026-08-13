import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { usePublishedProductContent } from "../api/productContent";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii } from "../theme/tokens";

export function BrandMark({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  const placement = compact ? "mobile.brand.logo.compact" : "mobile.brand.logo.primary";
  const content = usePublishedProductContent([placement], {
    audience: "public",
    moduleKey: "lpg",
  });
  const publication = content.data
    ?.filter((item) => item.placementKey === placement)
    .sort((left, right) => right.priority - left.priority)[0];
  const { palette } = useAppTheme();
  const title = publication?.title ?? (compact ? "S" : "SKIMA");

  if (publication?.mediaUrl)
    return (
      <Image
        accessibilityLabel={publication.accessibilityLabel ?? "SKIMA"}
        contentFit="contain"
        source={{ uri: publication.mediaUrl }}
        style={compact ? styles.compactImage : styles.image}
      />
    );

  return (
    <View
      accessibilityLabel="SKIMA"
      style={compact ? [styles.compact, { backgroundColor: inverse ? "white" : colors.brand }] : styles.wordmark}
    >
      <Text style={compact ? [styles.compactText, { color: inverse ? colors.brand : "white" }] : [styles.text, { color: inverse ? "white" : palette.ink }]}>
        {title}
      </Text>
      {!compact ? <View style={styles.dot} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wordmark: { minHeight: 30, flexDirection: "row", alignItems: "flex-end", gap: 3 },
  text: { fontSize: 23, lineHeight: 27, fontWeight: "900", letterSpacing: 1.8 },
  dot: { width: 6, height: 6, marginBottom: 4, borderRadius: 3, backgroundColor: colors.brand },
  compact: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: radii.md },
  compactText: { fontSize: 20, fontWeight: "900" },
  image: { width: 138, height: 40 },
  compactImage: { width: 44, height: 44, borderRadius: radii.md },
});
