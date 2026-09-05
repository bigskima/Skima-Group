import { router } from "expo-router";
import {
  Building2,
  ChevronRight,
  FileCheck2,
  MapPin,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Truck,
  UserRound,
  WalletCards,
} from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { Screen } from "./Screen";

type Workspace = "customer" | "driver" | "station";
type ToolItem = {
  label: string;
  detail: string;
  href: string;
  icon: typeof Building2;
};
type ToolGroup = {
  title: string;
  items: readonly ToolItem[];
};

const toolGroups: Record<Workspace, readonly ToolGroup[]> = {
  customer: [
    {
      title: "Everyday services",
      items: [
        { label: "Delivery locations", detail: "Pickup and return addresses", href: "/(customer)/locations", icon: MapPin },
        { label: "Stations near you", detail: "Approved LPG stations", href: "/(customer)/stations", icon: Building2 },
        { label: "Transactions", detail: "Wallet and payment activity", href: "/(customer)/transactions", icon: WalletCards },
      ],
    },
    {
      title: "Partner with SKIMA",
      items: [
        { label: "Apply to drive", detail: "Become a driver partner", href: "/(customer)/driver-application", icon: Truck },
        { label: "Apply as a station", detail: "Register an LPG station", href: "/(customer)/station-application", icon: Building2 },
        { label: "Fleet owner portal", detail: "Manage vehicles as an owner", href: "/(customer)/fleet", icon: Truck },
      ],
    },
  ],
  driver: [
    {
      title: "Identity & approval",
      items: [
        { label: "SKIMA Driver Pass", detail: "Your public driver identity", href: "/(driver)/id-card", icon: FileCheck2 },
        { label: "Driver profile", detail: "Profile and approval details", href: "/(driver)/profile", icon: UserRound },
        { label: "Application status", detail: "Review approval progress", href: "/(driver)/application", icon: FileCheck2 },
      ],
    },
    {
      title: "Work setup",
      items: [
        { label: "Service areas", detail: "Places where you can receive jobs", href: "/(driver)/service-zone", icon: MapPin },
        { label: "Vehicles", detail: "Vehicle details and approval", href: "/(driver)/vehicles", icon: Truck },
        { label: "Documents", detail: "Submitted driver documents", href: "/(driver)/documents", icon: FileCheck2 },
      ],
    },
  ],
  station: [
    {
      title: "Station operations",
      items: [
        { label: "Verify a driver", detail: "Lookup or scan a SKIMA driver", href: "/driver-verification", icon: ShieldCheck },
        { label: "Branch profile", detail: "Station profile and status", href: "/(station)/profile", icon: Building2 },
        { label: "LPG stock", detail: "Availability and incoming cylinders", href: "/(station)/inventory", icon: Settings2 },
        { label: "Station reports", detail: "Completed orders and earnings", href: "/(station)/reports", icon: ReceiptText },
        { label: "Settings & pricing", detail: "Hours, availability and price", href: "/(station)/settings", icon: Settings2 },
      ],
    },
    {
      title: "Team & access",
      items: [
        { label: "Team members", detail: "Manage station team access", href: "/(station)/staff", icon: Building2 },
        { label: "Roles", detail: "Control team permissions", href: "/(station)/roles", icon: ShieldCheck },
      ],
    },
    {
      title: "Approval & documents",
      items: [
        { label: "Application status", detail: "Review station approval", href: "/(station)/application", icon: FileCheck2 },
        { label: "Documents", detail: "Submitted station documents", href: "/(station)/documents", icon: FileCheck2 },
      ],
    },
  ],
};

export function WorkspaceAccountToolsScreen({ workspace }: { workspace: Workspace }) {
  const { palette } = useAppTheme();
  const label = workspace === "customer" ? "SKIMA services" : `${capitalize(workspace)} tools`;

  return (
    <Screen
      eyebrow="Account"
      title={label}
      subtitle="Everything for this workspace, organised by what you want to do."
      action={<AppButton label="Back" size="sm" variant="ghost" onPress={() => router.back()} />}
    >
      {toolGroups[workspace].map((group) => (
        <View key={group.title} style={styles.group}>
          <View style={styles.heading}>
            <Text style={[styles.groupTitle, { color: palette.ink }]}>{group.title}</Text>
          </View>
          <View style={styles.grid}>
            {group.items.map((item) => (
              <ToolTile key={item.label} item={item} />
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

function ToolTile({ item }: { item: ToolItem }) {
  const { palette } = useAppTheme();
  const Icon = item.icon;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(item.href as never)}
      style={({ pressed }) => [
        styles.tile,
        shadows.soft,
        {
          backgroundColor: palette.surface,
          borderColor: palette.border,
          opacity: pressed ? 0.72 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      <View style={styles.tileTop}>
        <View style={[styles.iconWrap, { backgroundColor: palette.brandSoft }]}>
          <Icon color={palette.brand} size={20} />
        </View>
        <ChevronRight color={palette.muted} size={17} />
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.label, { color: palette.ink }]}>{item.label}</Text>
        <Text numberOfLines={2} style={[styles.detail, { color: palette.muted }]}>{item.detail}</Text>
      </View>
    </Pressable>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  heading: { paddingHorizontal: 2, paddingTop: spacing.xs },
  groupTitle: { ...typography.sectionTitle, fontSize: 15 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    minWidth: 142,
    flexGrow: 1,
    flexBasis: "47%",
    minHeight: 116,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  tileTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconWrap: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  copy: { gap: 3 },
  label: { ...typography.bodyStrong, fontSize: 13 },
  detail: { ...typography.caption, fontSize: 10, lineHeight: 14 },
});
