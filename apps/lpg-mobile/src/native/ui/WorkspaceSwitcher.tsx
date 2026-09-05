import { router } from "expo-router";
import { Building2, Truck, UserRound } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { domainQueries } from "../api/domains";
import { firstString, nestedRecords } from "../api/records";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";

type Workspace = "customer" | "driver" | "station";

export function WorkspaceSwitcher({ current }: { current: Workspace }) {
  const session = useSession();
  const { palette } = useAppTheme();
  const access = domainQueries.workspaceAccess(session.status === "authenticated");
  const workspaces = nestedRecords(access.data, "workspaces")
    .filter((item) => firstString(item, ["status"]) === "active")
    .map((item) => firstString(item, ["key"]));

  const options = [
    { key: "customer" as const, label: "Customer", icon: UserRound },
    ...(workspaces.includes("driver") ? [{ key: "driver" as const, label: "Driver", icon: Truck }] : []),
    ...(workspaces.includes("station") ? [{ key: "station" as const, label: "Station", icon: Building2 }] : []),
  ];

  if (options.length < 2) return null;

  return (
    <View
      accessibilityLabel="Switch workspace"
      style={[styles.wrap, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}
    >
      {options.map(({ key, label, icon: Icon }) => {
        const active = key === current;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => router.replace(`/${`(${key})`}` as never)}
            style={({ pressed }) => [
              styles.option,
              {
                backgroundColor: active ? palette.brand : pressed ? palette.brandSofter : "transparent",
                opacity: pressed ? 0.84 : 1,
                transform: [{ scale: pressed ? 0.985 : 1 }],
              },
            ]}
          >
            <Icon color={active ? "#FFFFFF" : palette.mutedStrong} size={15} />
            <Text style={[styles.label, { color: active ? "#FFFFFF" : palette.ink }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    flexDirection: "row",
    gap: 3,
    padding: 4,
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  option: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    paddingHorizontal: 12,
    borderRadius: radii.lg,
  },
  label: { ...typography.caption, fontSize: 10, fontWeight: "900" },
});
