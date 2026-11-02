import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAppTheme } from "../../src/theme/ThemeProvider";
import { CustomerTabs } from "../../src/navigation/CustomerTabs";
import { useSession } from "../../src/session/SessionProvider";
export default function CustomerLayout() {
  const { status } = useSession();
  const { palette } = useAppTheme();
  if (status === "loading") {
    return <View style={[styles.loading, { backgroundColor: palette.canvas }]}><ActivityIndicator color={palette.brand} size="large" /></View>;
  }
  if (status !== "authenticated") return <Redirect href="/(auth)/sign-in" />;
  return <CustomerTabs />;
}

const styles = StyleSheet.create({ loading: { flex: 1, alignItems: "center", justifyContent: "center" } });
