import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { DriverTabs } from "../../src/navigation/DriverTabs";
import { useSession } from "../../src/session/SessionProvider";
import { useAppTheme } from "../../src/theme/ThemeProvider";

export default function DriverLayout() {
  const { status } = useSession();
  const { palette } = useAppTheme();
  if (status === "loading") return <View style={[styles.loading, { backgroundColor: palette.canvas }]}><ActivityIndicator color={palette.brand} size="large" /></View>;
  if (status !== "authenticated") return <Redirect href="/(auth)/sign-in" />;
  return <DriverTabs />;
}
const styles = StyleSheet.create({ loading: { flex: 1, alignItems: "center", justifyContent: "center" } });
