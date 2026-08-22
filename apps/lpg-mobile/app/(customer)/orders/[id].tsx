import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, View } from "react-native";

import { useJobDetails } from "../../../src/native/api/domains";
import { displayStatus, nestedRecord } from "../../../src/native/api/records";
import { spacing } from "../../../src/native/theme/tokens";
import { AppButton } from "../../../src/native/ui/AppButton";
import { CustomerOrderDetailScreen } from "../../../src/native/ui/CustomerOrdersScreen";

const FINAL_ORDER_STATES = new Set(["delivered", "completed"]);

export default function CustomerOrderDetailRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const orderId = typeof id === "string" ? id : null;
  const detail = useJobDetails(orderId);
  const root = detail.data;
  const order = nestedRecord(root, "order") ?? root;
  const status = order ? normalizeStatus(displayStatus(order) ?? "") : "";
  const canLeaveFeedback = Boolean(orderId && FINAL_ORDER_STATES.has(status));

  return (
    <View style={styles.container}>
      <CustomerOrderDetailScreen />
      {canLeaveFeedback ? (
        <View style={styles.feedbackAction} pointerEvents="box-none">
          <AppButton
            label="Rate service / Report a problem"
            fullWidth
            onPress={() => router.push(`/(customer)/orders/${orderId}/feedback` as never)}
          />
        </View>
      ) : null}
    </View>
  );
}

function normalizeStatus(value: string) {
  return value.toLowerCase().replace(/[-\s]+/g, "_");
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  feedbackAction: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.lg,
  },
});
