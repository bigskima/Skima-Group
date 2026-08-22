import { Building2, ShieldCheck, Truck, UsersRound } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { firstString, type PlatformRecord } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { AppField } from "./AppField";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";

const kinds = [
  { key: "individual_owner", label: "Individual owner" },
  { key: "company", label: "Company" },
  { key: "fleet_operator", label: "Fleet operator" },
] as const;

export function FleetPartnerPortalScreen() {
  const { palette } = useAppTheme();
  const fleet = domainQueries.myFleet();
  const [kind, setKind] = useState<(typeof kinds)[number]["key"]>("individual_owner");
  const [name, setName] = useState("");
  const [registration, setRegistration] = useState("");
  const [notice, setNotice] = useState("");
  const submit = useGatewayMutation({
    path: "/runtime/fleet-applications",
    schema: z.string().uuid(),
    invalidate: [["my-fleet"]],
  });
  const applications = arrayRecords(fleet.data?.applications);
  const partners = arrayRecords(fleet.data?.partners);
  const vehicles = arrayRecords(fleet.data?.vehicles);
  const assignments = arrayRecords(fleet.data?.assignments);
  const staff = arrayRecords(fleet.data?.staff);
  const hasOpenApplication = applications.some((record) =>
    ["submitted", "correction_required", "resubmitted", "approved"].includes(firstString(record, ["status"]) ?? "")
  );

  const send = async () => {
    setNotice("");
    try {
      await submit.mutateAsync({
        partnerKind: kind,
        legalName: name.trim(),
        registrationIdentifier: registration.trim() || null,
        applicationPayload: { portal: "lpg_mobile", requestedCapabilities: [] },
        source: "skima.fleet.portal",
        idempotencyKey: idempotencyKey("fleet-application", `${kind}:${registration || name}`),
      });
      setNotice("Fleet application submitted for governed review.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Fleet application could not be submitted.");
    }
  };

  if (fleet.isPending) return <ScreenSkeleton cards={4} />;

  return (
    <Screen eyebrow="Fleet owner portal" title="Your fleet" subtitle="Register and govern vehicles independently from driver identity.">
      <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
        <Building2 color="#fff" size={28} />
        <View style={styles.copy}>
          <Text style={styles.title}>Fleet ownership stays separate from drivers</Text>
          <Text style={styles.body}>Legal owners, operators, leases, rentals and authorised users retain governed history.</Text>
        </View>
      </View>

      {partners.length || applications.length ? (
        <>
          <View style={styles.metrics}>
            <Metric icon={<Building2 color={palette.brand} size={20} />} label="Partners" value={partners.length} />
            <Metric icon={<Truck color={palette.brand} size={20} />} label="Vehicles" value={vehicles.length} />
            <Metric icon={<UsersRound color={palette.brand} size={20} />} label="Staff" value={staff.length} />
          </View>
          <SectionHeader title="Approval status" description="Applications and correction requests from the governed review workflow." />
          {applications.map((application) => (
            <View key={firstString(application, ["id"]) ?? JSON.stringify(application)} style={[styles.statusCard, { borderColor: palette.border, backgroundColor: palette.surface }]}>
              <View style={styles.copy}>
                <Text style={[styles.cardTitle, { color: palette.ink }]}>{firstString(application, ["legal_name"]) ?? "Fleet application"}</Text>
                <Text style={[styles.cardBody, { color: palette.muted }]}>Revision {String(application.revision ?? 1)}</Text>
              </View>
              <StatusPill label={(firstString(application, ["status"]) ?? "pending").replaceAll("_", " ")} tone={firstString(application, ["status"]) === "approved" ? "success" : "warning"} />
            </View>
          ))}
          <SectionHeader title="Assigned drivers" description="Current and historical vehicle assignments visible to authorised fleet staff." />
          {assignments.length ? assignments.map((assignment) => (
            <View key={firstString(assignment, ["id"]) ?? JSON.stringify(assignment)} style={[styles.statusCard, { borderColor: palette.border, backgroundColor: palette.surface }]}>
              <Truck color={palette.brand} size={20} />
              <View style={styles.copy}>
                <Text style={[styles.cardTitle, { color: palette.ink }]}>Vehicle assignment</Text>
                <Text style={[styles.cardBody, { color: palette.muted }]}>{firstString(assignment, ["relationship_type"])?.replaceAll("_", " ") ?? "Relationship pending"}</Text>
              </View>
              <StatusPill label={firstString(assignment, ["status"]) ?? "pending"} tone={firstString(assignment, ["status"]) === "active" ? "success" : "neutral"} />
            </View>
          )) : <EmptyState icon={<Truck color={palette.brand} size={26} />} title="No driver assignments" description="Approved vehicles and assignments will appear here without exposing another fleet's records." />}
        </>
      ) : null}

      {!hasOpenApplication ? (
        <>
          <SectionHeader title="Register a fleet partner" description="Choose the legal or operating capacity in which you are applying." />
          <View style={styles.options}>{kinds.map((item) => (
            <Pressable key={item.key} onPress={() => setKind(item.key)} style={[styles.option, { backgroundColor: kind === item.key ? palette.brand : palette.surface, borderColor: kind === item.key ? palette.brand : palette.border }]}>
              <Text style={{ color: kind === item.key ? "#fff" : palette.ink, fontWeight: "800" }}>{item.label}</Text>
            </Pressable>
          ))}</View>
          <View style={[styles.card, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <AppField label={kind === "individual_owner" ? "Legal name" : "Registered name"} value={name} onChangeText={setName} placeholder="Name on registration documents" />
            <AppField label="Registration identifier" value={registration} onChangeText={setRegistration} placeholder="Company or owner registration reference" hint="Used for duplicate detection." />
            <View style={[styles.note, { backgroundColor: palette.surfaceSubtle }]}>
              <ShieldCheck color={palette.brand} size={18} />
              <Text style={[styles.noteText, { color: palette.muted }]}>Submission never self-approves. Configured documents must be approved before an authorised reviewer can approve the fleet.</Text>
            </View>
            <AppButton fullWidth size="lg" label="Submit fleet application" loading={submit.isPending} disabled={name.trim().length < 2} onPress={() => void send()} />
            {notice ? <Text accessibilityRole="alert" style={[styles.notice, { color: submit.isError ? palette.danger : palette.success }]}>{notice}</Text> : null}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

function arrayRecords(value: unknown): PlatformRecord[] {
  return Array.isArray(value) ? value.filter((item): item is PlatformRecord => Boolean(item) && typeof item === "object") : [];
}
function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  const { palette } = useAppTheme();
  return <View style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border }]}>{icon}<Text style={[styles.metricValue, { color: palette.ink }]}>{value}</Text><Text style={[styles.metricLabel, { color: palette.muted }]}>{label}</Text></View>;
}
const styles = StyleSheet.create({
  hero: { borderRadius: radii.xl, padding: spacing.lg, flexDirection: "row", gap: spacing.md },
  copy: { flex: 1, gap: 5 }, title: { ...typography.heading, color: "#fff" }, body: { ...typography.body, color: "rgba(255,255,255,.84)" },
  metrics: { flexDirection: "row", gap: spacing.sm }, metric: { flex: 1, borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, gap: 4 }, metricValue: { ...typography.heading }, metricLabel: { ...typography.caption },
  options: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, option: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 10 },
  card: { borderWidth: 1, borderRadius: radii.xl, padding: spacing.lg, gap: spacing.md }, note: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md }, noteText: { ...typography.caption, flex: 1 }, notice: { ...typography.caption, fontWeight: "700" },
  statusCard: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md }, cardTitle: { ...typography.bodyStrong }, cardBody: { ...typography.caption },
});
