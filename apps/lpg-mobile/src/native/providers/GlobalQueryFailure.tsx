import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii, spacing } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";

export function GlobalQueryFailure() {
  const client = useQueryClient();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const update = () => {
      const failed = client
        .getQueryCache()
        .getAll()
        .find(
          (query) =>
            query.getObserversCount() > 0 &&
            query.state.status === "error" &&
            query.state.fetchStatus !== "fetching",
        );
      setMessage(
        failed
          ? friendlyError(
              failed.state.error,
              "Some information couldn’t be refreshed. Please try again.",
            )
          : null,
      );
    };
    update();
    return client.getQueryCache().subscribe(update);
  }, [client]);

  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={[styles.notice, { top: Math.max(insets.top, spacing.sm) }]}>
      <Text numberOfLines={2} style={styles.text}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          void client.refetchQueries({
            predicate: (query) => query.getObserversCount() > 0 && query.state.status === "error",
          })
        }
      >
        <Text style={styles.retry}>Try again</Text>
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
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E9A8AE",
    borderRadius: radii.md,
    backgroundColor: "#FFF7F8",
  },
  text: { flex: 1, color: colors.danger, fontSize: 12, fontWeight: "700" },
  retry: { color: colors.brand, fontSize: 12, fontWeight: "900" },
});
