import { Redirect } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useAppTheme } from "../../src/theme/ThemeProvider";
import { CustomerTabs } from "../../src/navigation/CustomerTabs";
import { useSession } from "../../src/session/SessionProvider";
import { ScreenSkeleton } from "../../src/ui/ScreenSkeleton";
export default function CustomerLayout() {
  const { status } = useSession();
  const { palette } = useAppTheme();
  if (status === "loading") {
    return <View style={[styles.loading, { backgroundColor: palette.canvas }]}><ScreenSkeleton variant="dashboard" cards={2} /></View>;
  }
  if (status !== "authenticated") return <Redirect href="/(auth)/sign-in" />;
  return <CustomerTabs />;
}

const styles = StyleSheet.create({ loading: { flex: 1, alignItems: "center", justifyContent: "center" } });
