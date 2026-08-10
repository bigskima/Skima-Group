import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useSession } from "../src/native/session/SessionProvider";
import { colors } from "../src/native/theme/tokens";

export default function Index() {
  const session = useSession();
  if (session.status === "loading")
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  if (session.status !== "authenticated")
    return <Redirect href="/(auth)/welcome" />;
  const keys =
    session.context?.roles.map((role) => role.key?.toLowerCase() ?? "") ?? [];
  if (keys.some((key) => key.includes("driver")))
    return <Redirect href="/(driver)" />;
  if (keys.some((key) => key.includes("station") || key.includes("partner")))
    return <Redirect href="/(station)" />;
  return <Redirect href="/(customer)" />;
}
const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.canvas,
  },
});
