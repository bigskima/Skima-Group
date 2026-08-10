import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii, spacing } from "../theme/tokens";

export function GlobalQueryFailure() {
  const client = useQueryClient();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  useEffect(
    () =>
      client.getQueryCache().subscribe(() => {
        const failed = client
          .getQueryCache()
          .getAll()
          .find((query) => query.state.status === "error");
        const error = failed?.state.error;
        setMessage(
          error instanceof Error
            ? error.message
            : error
              ? "Live backend data could not be loaded."
              : null,
        );
      }),
    [client],
  );
  if (!message) return null;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, { top: Math.max(insets.top, spacing.sm) }]}
    >
      <Text numberOfLines={2} style={styles.text}>
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          void client.refetchQueries({
            predicate: (query) => query.state.status === "error",
          })
        }
      >
        <Text style={styles.retry}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    position: "absolute",
    zIndex: 1000,
    left: spacing.md,
    right: spacing.md,
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: "#E9A8AE",
    borderRadius: radii.md,
    backgroundColor: "#FFF7F8",
  },
  text: { flex: 1, color: colors.danger, fontWeight: "700" },
  retry: { color: colors.brand, fontWeight: "900" },
});
