import { createClientIdempotencyKey } from "@skima/frontend-core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, CheckCircle2, PauseCircle, PlayCircle, ShieldCheck, Tags, XCircle } from "lucide-react-native";
import { useMemo, useState, type ReactNode } from "react";
import { Alert, RefreshControl, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { asString, useLogisticsQuery } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { AppField } from "../ui/AppField";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { SectionHeader } from "../ui/SectionHeader";
import { StatePanel } from "../ui/StatePanel";
import { StatusPill } from "../ui/StatusPill";

type Row = Record<string, unknown>;

function nested(record: Row | null | undefined, key: string): Row | null {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function dateLabel(value: unknown): string {
  if (typeof value !== "string") return "Date unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" }).format(parsed);
}

export function LogisticsAdminScreen() {
  const { palette } = useAppTheme();
  const { api, context } = useSession();
  const client = useQueryClient();
  const canManage = context?.permissions.some((permission) => String(permission) === "logistics.marketplace.manage") === true;

  const providers = useLogisticsQuery(["admin-providers"], "/runtime/logistics/company", canManage, 30_000);
  const categories = useLogisticsQuery(["admin-categories"], "/runtime/logistics/categories", canManage, 30_000);

  const [reason, setReason] = useState("");
  const [categoryKey, setCategoryKey] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [categoryDescription, setCategoryDescription] = useState("");
  const [parentKey, setParentKey] = useState("");
  const [sortOrder, setSortOrder] = useState("100");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const providerRows = useMemo(() => providers.data ?? [], [providers.data]);
  const categoryRows = useMemo(() => categories.data ?? [], [categories.data]);
  const pendingProviders = providerRows.filter((item) => asString(item, "verification_status") === "pending");
  const verifiedProviders = providerRows.filter((item) => asString(item, "verification_status") === "verified");
  const refresh = () => Promise.all([providers.refetch(), categories.refetch()]);

  const verifyProvider = useMutation({
    mutationFn: async (input: { organizationId: string; decision: "verified" | "rejected" | "suspended" }) => {
      if (reason.trim().length < 5) throw new Error("Enter a review reason of at least five characters.");
      return api.post("/runtime/logistics/admin/providers/verification", {
        organizationId: input.organizationId,
        decision: input.decision,
        reason: reason.trim(),
        idempotencyKey: createClientIdempotencyKey(
          "logistics.admin.provider.verification",
          input.organizationId + ":" + input.decision + ":" + reason.trim(),
        ),
      }, z.string().uuid());
    },
    onSuccess: async (_result, input) => {
      setReason("");
      setError(null);
      setNotice(input.decision === "verified" ? "Provider verified and activated for matching." : "Provider review decision saved.");
      await client.invalidateQueries({ queryKey: ["skima-logistics", "admin-providers"] });
      await providers.refetch();
    },
    onError: (cause) => {
      setNotice(null);
      setError(cause instanceof Error ? cause.message : "Provider review could not be saved.");
    },
  });

  const setProviderStatus = useMutation({
    mutationFn: async (input: { organizationId: string; status: "active" | "paused" | "closed" }) => {
      if (reason.trim().length < 3) throw new Error("Enter a reason of at least three characters.");
      return api.post("/runtime/logistics/company/status", {
        organizationId: input.organizationId,
        status: input.status,
        reason: reason.trim(),
        idempotencyKey: createClientIdempotencyKey(
          "logistics.admin.provider.operational-status",
          input.organizationId + ":" + input.status + ":" + reason.trim(),
        ),
      }, z.string().uuid());
    },
    onSuccess: async (_result, input) => {
      setError(null);
      setNotice("Provider operating status changed to " + input.status + ".");
      await client.invalidateQueries({ queryKey: ["skima-logistics", "admin-providers"] });
      await providers.refetch();
    },
    onError: (cause) => {
      setNotice(null);
      setError(cause instanceof Error ? cause.message : "Provider operating status could not be changed.");
    },
  });

  const saveCategory = useMutation({
    mutationFn: async (input: { key: string; name: string; description: string | null; parent: string | null; sort: number; status: string }) =>
      api.post("/runtime/logistics/admin/categories", {
        key: input.key,
        displayName: input.name,
        description: input.description,
        parentKey: input.parent,
        status: input.status,
        sortOrder: input.sort,
        metadata: { source: "skima.logistics.admin" },
      }, z.string().uuid()),
    onSuccess: async () => {
      setCategoryKey("");
      setCategoryName("");
      setCategoryDescription("");
      setParentKey("");
      setSortOrder("100");
      setError(null);
      setNotice("Service category saved.");
      await client.invalidateQueries({ queryKey: ["skima-logistics", "admin-categories"] });
      await categories.refetch();
    },
    onError: (cause) => {
      setNotice(null);
      setError(cause instanceof Error ? cause.message : "The service category could not be saved.");
    },
  });

  const isWorking = verifyProvider.isPending || setProviderStatus.isPending || saveCategory.isPending;
  const isLoading = canManage && (providers.isPending || categories.isPending);

  return (
    <Screen
      eyebrow="LOGISTICS GOVERNANCE"
      title="SKIMA Logistics Admin"
      subtitle="Review provider companies, control operational eligibility and maintain the Logistics service catalogue."
      refreshControl={<RefreshControl refreshing={providers.isRefetching || categories.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}
    >
      {!canManage ? (
        <Card variant="warning" padding="lg">
          <View style={styles.headingRow}>
            <ShieldCheck color={palette.warning} size={20} />
            <Text style={[styles.cardTitle, { color: palette.ink }]}>Marketplace administrator access required</Text>
          </View>
          <Text style={[styles.body, { color: palette.muted }]}>This workspace is restricted to accounts with the Logistics marketplace management permission.</Text>
        </Card>
      ) : isLoading ? (
        <ScreenSkeleton cards={4} />
      ) : providers.error || categories.error ? (
        <StatePanel title="Admin records unavailable" description="The provider register or service catalogue could not be loaded." retry={() => void refresh()} />
      ) : (
        <View style={styles.content}>
          <View style={styles.stats}>
            <Stat value={String(providerRows.length)} label="Providers" icon={<Building2 color={palette.brand} size={16} />} />
            <Stat value={String(pendingProviders.length)} label="Awaiting review" icon={<ShieldCheck color={palette.warning} size={16} />} />
            <Stat value={String(categoryRows.length)} label="Categories" icon={<Tags color={palette.success} size={16} />} />
          </View>

          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
          {notice ? <Text style={[styles.notice, { color: palette.success }]}>{notice}</Text> : null}

          <View style={styles.section}>
            <SectionHeader title="Provider review queue" description={String(pendingProviders.length) + " companies awaiting verification."} />
            <AppField
              label="Review reason"
              value={reason}
              onChangeText={setReason}
              placeholder="Explain the verification or operating decision…"
              optional
              multiline
            />
            {pendingProviders.length === 0 ? (
              <Card variant="subtle" padding="md">
                <Text style={[styles.body, { color: palette.muted }]}>No pending provider applications.</Text>
              </Card>
            ) : pendingProviders.map((provider) => {
              const organizationId = asString(provider, "organization_id") ?? "";
              const organization = nested(provider, "organization");
              const name = asString(provider, "public_name") ?? asString(organization, "display_name") ?? "Logistics provider";
              return (
                <Card key={organizationId} padding="lg">
                  <View style={styles.providerHead}>
                    <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}><Building2 color={palette.brand} size={19} /></View>
                    <View style={styles.copy}>
                      <Text style={[styles.cardTitle, { color: palette.ink }]}>{name}</Text>
                      <Text style={[styles.body, { color: palette.muted }]}>{asString(organization, "legal_name") ?? "Legal name not supplied"}</Text>
                      <Text style={[styles.meta, { color: palette.muted }]}>Applied {dateLabel(provider.created_at)}</Text>
                    </View>
                    <StatusPill status={asString(provider, "verification_status") ?? "pending"} />
                  </View>
                  {asString(provider, "about") ? <Text style={[styles.body, { color: palette.muted }]}>{asString(provider, "about")}</Text> : null}
                  <View style={styles.actions}>
                    <View style={styles.actionCell}>
                      <AppButton
                        label="Reject"
                        size="sm"
                        fullWidth
                        variant="secondary"
                        disabled={isWorking || reason.trim().length < 5}
                        icon={<XCircle color={palette.danger} size={14} />}
                        onPress={() => Alert.alert("Reject provider?", "This company will not receive live Logistics opportunities.", [
                          { text: "Cancel", style: "cancel" },
                          { text: "Reject", style: "destructive", onPress: () => verifyProvider.mutate({ organizationId, decision: "rejected" }) },
                        ])}
                      />
                    </View>
                    <View style={styles.actionCell}>
                      <AppButton
                        label="Verify provider"
                        size="sm"
                        fullWidth
                        disabled={isWorking || reason.trim().length < 5}
                        icon={<CheckCircle2 color="#FFFFFF" size={14} />}
                        onPress={() => Alert.alert("Verify provider?", "This activates the company for eligible Logistics matching.", [
                          { text: "Cancel", style: "cancel" },
                          { text: "Verify", onPress: () => verifyProvider.mutate({ organizationId, decision: "verified" }) },
                        ])}
                      />
                    </View>
                  </View>
                </Card>
              );
            })}
          </View>

          <View style={styles.section}>
            <SectionHeader title="Verified providers" description={String(verifiedProviders.length) + " verified companies."} />
            {verifiedProviders.length === 0 ? (
              <Card variant="subtle" padding="md"><Text style={[styles.body, { color: palette.muted }]}>Verified providers will appear here.</Text></Card>
            ) : verifiedProviders.map((provider) => {
              const organizationId = asString(provider, "organization_id") ?? "";
              const organization = nested(provider, "organization");
              const name = asString(provider, "public_name") ?? asString(organization, "display_name") ?? "Logistics provider";
              const status = asString(provider, "operational_status") ?? "onboarding";
              return (
                <Card key={organizationId} padding="md">
                  <View style={styles.providerHead}>
                    <View style={[styles.icon, { backgroundColor: palette.successSoft }]}><Building2 color={palette.success} size={18} /></View>
                    <View style={styles.copy}>
                      <Text style={[styles.cardTitle, { color: palette.ink }]}>{name}</Text>
                      <Text style={[styles.meta, { color: palette.muted }]}>{asString(organization, "display_name") ?? ""}</Text>
                    </View>
                    <StatusPill status={status} />
                  </View>
                  {status === "active" ? (
                    <AppButton
                      label="Pause provider"
                      size="sm"
                      fullWidth
                      variant="secondary"
                      disabled={isWorking || reason.trim().length < 3}
                      icon={<PauseCircle color={palette.warning} size={14} />}
                      onPress={() => setProviderStatus.mutate({ organizationId, status: "paused" })}
                    />
                  ) : status === "paused" ? (
                    <AppButton
                      label="Reactivate provider"
                      size="sm"
                      fullWidth
                      disabled={isWorking || reason.trim().length < 3}
                      icon={<PlayCircle color="#FFFFFF" size={14} />}
                      onPress={() => setProviderStatus.mutate({ organizationId, status: "active" })}
                    />
                  ) : null}
                  {asString(provider, "verification_reason") ? (
                    <Text style={[styles.meta, { color: palette.muted }]}>Last review: {asString(provider, "verification_reason")}</Text>
                  ) : null}
                </Card>
              );
            })}
          </View>

          <View style={styles.section}>
            <SectionHeader title="Service category catalogue" description="Active categories appear to customers and provider companies." />
            <Card padding="lg">
              <AppField
                label="Category key"
                value={categoryKey}
                onChangeText={(value) => setCategoryKey(value.toLowerCase().replace(/\s+/g, ".").replace(/[^a-z0-9_.:-]/g, ""))}
                placeholder="e.g. courier.parcel"
                autoCapitalize="none"
              />
              <AppField label="Category name" value={categoryName} onChangeText={setCategoryName} placeholder="e.g. Courier & parcels" />
              <AppField label="Description" value={categoryDescription} onChangeText={setCategoryDescription} placeholder="Describe the services covered by this category" multiline optional />
              <AppField label="Parent category key" value={parentKey} onChangeText={setParentKey} placeholder="Optional parent key" autoCapitalize="none" optional />
              <AppField label="Sort order" value={sortOrder} onChangeText={setSortOrder} placeholder="100" keyboardType="numeric" />
              <AppButton
                label="Add service category"
                fullWidth
                loading={saveCategory.isPending}
                disabled={isWorking || categoryKey.trim().length < 3 || categoryName.trim().length < 2}
                icon={<Tags color="#FFFFFF" size={15} />}
                onPress={() => {
                  const sort = Number(sortOrder);
                  if (!Number.isInteger(sort) || sort < 0 || sort > 100000) {
                    setError("Sort order must be a whole number from 0 to 100000.");
                    return;
                  }
                  setError(null);
                  saveCategory.mutate({
                    key: categoryKey.trim(),
                    name: categoryName.trim(),
                    description: categoryDescription.trim() || null,
                    parent: parentKey.trim() || null,
                    sort,
                    status: "active",
                  });
                }}
              />
            </Card>
            {categoryRows.map((category) => {
              const key = asString(category, "key") ?? "";
              const status = asString(category, "status") ?? "draft";
              const nextStatus = status === "active" ? "suspended" : "active";
              return (
                <View key={key} style={[styles.categoryRow, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                  <View style={[styles.iconSmall, { backgroundColor: palette.brandSoft }]}><Tags color={palette.brand} size={16} /></View>
                  <View style={styles.copy}>
                    <Text style={[styles.categoryName, { color: palette.ink }]}>{asString(category, "display_name") ?? key}</Text>
                    <Text style={[styles.meta, { color: palette.muted }]}>{key} · {asString(category, "description") ?? "No description"}</Text>
                  </View>
                  <StatusPill status={status} />
                  {status !== "retired" ? (
                    <AppButton
                      size="sm"
                      variant="secondary"
                      label={nextStatus === "active" ? "Activate" : "Pause"}
                      disabled={isWorking}
                      onPress={() => {
                        const existingStatus = status;
                        api.post("/runtime/logistics/admin/categories", {
                          key,
                          displayName: asString(category, "display_name") ?? key,
                          parentKey: asString(category, "parent_key"),
                          description: asString(category, "description"),
                          status: nextStatus,
                          sortOrder: Number(category.sort_order ?? 100),
                          metadata: { source: "skima.logistics.admin" },
                        }, z.string().uuid()).then(async () => {
                          setNotice("Category " + key + " changed from " + existingStatus + " to " + nextStatus + ".");
                          await client.invalidateQueries({ queryKey: ["skima-logistics", "admin-categories"] });
                          await categories.refetch();
                        }).catch((cause) => setError(cause instanceof Error ? cause.message : "Category status could not be changed."));
                      }}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      )}
    </Screen>
  );
}

function Stat({ value, label, icon }: { value: string; label: string; icon: ReactNode }) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.stat, { borderColor: palette.border, backgroundColor: palette.surface }]}>
      <View style={[styles.statIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
      <Text style={[styles.statValue, { color: palette.ink }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: palette.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  section: { gap: 9 },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  stats: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, minWidth: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 11, gap: 2 },
  statIcon: { width: 31, height: 31, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statValue: { ...typography.heading, fontSize: 20 },
  statLabel: { ...typography.caption, fontSize: 8 },
  cardTitle: { ...typography.bodyStrong, fontSize: 13 },
  body: { ...typography.caption, fontSize: 10, lineHeight: 17 },
  meta: { ...typography.caption, fontSize: 9, lineHeight: 15 },
  error: { ...typography.caption, fontSize: 10, lineHeight: 17 },
  notice: { ...typography.caption, fontSize: 10, lineHeight: 17 },
  providerHead: { flexDirection: "row", alignItems: "center", gap: 9 },
  icon: { width: 39, height: 39, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  actions: { flexDirection: "row", gap: 8 },
  actionCell: { flex: 1 },
  categoryRow: { minHeight: 66, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  iconSmall: { width: 33, height: 33, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  categoryName: { ...typography.bodyStrong, fontSize: 11 },
});
