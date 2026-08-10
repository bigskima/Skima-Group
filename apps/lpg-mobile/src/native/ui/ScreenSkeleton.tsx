import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { colors, radii, spacing } from "../theme/tokens";
import { useAppTheme } from "../theme/ThemeProvider";

export function ScreenSkeleton({ cards = 3 }: { cards?: number }) {
  const { scheme, palette } = useAppTheme();
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.85,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  const fill = scheme === "dark" ? "#304238" : "#E4EAE6";
  return (
    <View accessibilityLabel="Loading content" style={styles.stack}>
      <Animated.View
        style={[styles.hero, { backgroundColor: fill, opacity }]}
      />
      {Array.from({ length: cards }, (_, index) => (
        <Animated.View
          key={index}
          style={[
            styles.card,
            {
              borderColor: palette.border,
              backgroundColor: palette.surface,
              opacity,
            },
          ]}
        >
          <View style={[styles.lineShort, { backgroundColor: fill }]} />
          <View style={[styles.line, { backgroundColor: fill }]} />
          <View style={[styles.lineMedium, { backgroundColor: fill }]} />
        </Animated.View>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  hero: { height: 118, borderRadius: radii.lg },
  card: {
    height: 126,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.lg,
    borderWidth: 1,
    borderRadius: radii.lg,
  },
  line: { height: 12, width: "100%", borderRadius: radii.pill },
  lineMedium: { height: 12, width: "68%", borderRadius: radii.pill },
  lineShort: { height: 18, width: "42%", borderRadius: radii.pill },
});
