import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, typography } from "../theme/tokens";

const LABELS: Record<string, string> = {
  open: "Finding providers", matching: "Matching", offers_received: "Offers received",
  booking_pending: "Booking pending", booked: "Booked", awaiting_payment: "Awaiting payment",
  awaiting_offline_confirmation: "Confirm payment", payment_reserved: "Payment protected",
  offline_payment_confirmed: "Payment confirmed", provider_accepted: "Provider accepted",
  in_progress: "In progress", delivered: "Delivered", completed: "Completed",
  completed_offline: "Completed", cancelled: "Cancelled", expired: "Expired",
  disputed: "Under review", settled: "Settled",
};
export function StatusPill({ status }: { status: string }) {
  const { palette } = useAppTheme();
  const normalized = status.toLowerCase();
  const success = ["delivered", "completed", "completed_offline", "settled", "payment_reserved", "offline_payment_confirmed", "provider_accepted"].includes(normalized);
  const warning = ["open", "matching", "offers_received", "booking_pending", "awaiting_payment", "awaiting_offline_confirmation", "in_progress"].includes(normalized);
  const color = success ? palette.success : warning ? palette.warning : palette.muted;
  const background = success ? palette.successSoft : warning ? palette.warningSoft : palette.soft;
  const label = LABELS[normalized] ?? normalized.replace(/[_:-]+/g, " ").replace(/\b\w/g, (part) => part.toUpperCase());
  return <View style={[styles.pill, { backgroundColor: background }]}><View style={[styles.dot, { backgroundColor: color }]} /><Text style={[styles.label, { color }]}>{label}</Text></View>;
}
const styles = StyleSheet.create({
  pill: { minHeight: 27, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 5, alignSelf: "flex-start" },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { ...typography.caption, fontSize: 10, fontWeight: "900" },
});
