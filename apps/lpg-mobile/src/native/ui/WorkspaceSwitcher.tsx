import { router } from "expo-router";
import { Building2, Truck, UserRound } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii } from "../theme/tokens";

type Workspace = "customer" | "driver" | "station";

export function WorkspaceSwitcher({ current }: { current: Workspace }) {
  const session = useSession();
  const { palette } = useAppTheme();
  const keys = session.context?.roles.map((role) => role.key?.toLowerCase() ?? "") ?? [];
  const options = [
    { key: "customer" as const, label: "Customer", icon: UserRound },
    ...(keys.some((key) => key.includes("driver")) ? [{ key: "driver" as const, label: "Driver", icon: Truck }] : []),
    ...(keys.some((key) => key.includes("station") || key.includes("partner")) ? [{ key: "station" as const, label: "Station", icon: Building2 }] : []),
  ];
  if (options.length < 2) return null;
  return (
    <View accessibilityLabel="Switch workspace" style={[styles.wrap, { backgroundColor: palette.surface }]}> 
      {options.map(({ key, label, icon: Icon }) => {
        const active = key === current;
        return (
          <Pressable key={key} onPress={() => router.replace(`/${`(${key})`}` as never)} style={[styles.option, active && styles.active]}>
            <Icon color={active ? "white" : palette.muted} size={15} />
            <Text style={[styles.label, { color: active ? "white" : palette.ink }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "flex-start", flexDirection: "row", gap: 3, padding: 4, borderRadius: 17, shadowColor: "#000", shadowOpacity: .12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  option: { minHeight: 34, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, borderRadius: 13 },
  active: { backgroundColor: colors.brand },
  label: { fontSize: 11, fontWeight: "900" },
});
