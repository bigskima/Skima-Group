import { createClientIdempotencyKey } from "@skima/frontend-core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MailPlus, ShieldCheck, UserCheck, UserRound, UserX, Users } from "lucide-react-native";
import { useMemo, useState } from "react";
import { RefreshControl, StyleSheet, Text, View } from "react-native";
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

const ROLE_PRESETS = [
  {
    key: "logistics.company.operations_manager",
    name: "Operations manager",
    description: "Manage company jobs, coordinate operations and respond to offers.",
    permissions: [
      "business.logistics.company.read",
      "business.logistics.jobs.read",
      "business.logistics.jobs.manage",
      "business.logistics.offers.manage",
    ],
  },
  {
    key: "logistics.company.dispatcher",
    name: "Dispatcher",
    description: "View company work and manage operational job progress.",
    permissions: [
      "business.logistics.company.read",
      "business.logistics.jobs.read",
      "business.logistics.jobs.manage",
    ],
  },
  {
    key: "logistics.company.quotes",
    name: "Quotes & customer service",
    description: "Review matched requests and prepare or negotiate company offers.",
    permissions: [
      "business.logistics.company.read",
      "business.logistics.jobs.read",
      "business.logistics.offers.manage",
    ],
  },
  {
    key: "logistics.company.finance_viewer",
    name: "Finance viewer",
    description: "Read company Logistics fee and financial information only.",
    permissions: [
      "business.logistics.company.read",
      "business.logistics.finance.read",
    ],
  },
  {
    key: "logistics.company.viewer",
    name: "Read-only staff",
    description: "View the company profile and job information without changing it.",
    permissions: [
      "business.logistics.company.read",
      "business.logistics.jobs.read",
    ],
  },
] as const;

type StaffMember = Record<string, unknown> & {
  userId?: string;
  displayName?: string | null;
  email?: string | null;
  membershipType?: string;
  status?: string;
  roles?: Array<Record<string, unknown>>;
};

function dateLabel(value: unknown) {
  if (typeof value !== "string") return "Date unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" }).format(parsed);
}

export function ProviderTeamScreen() {
  const { palette } = useAppTheme();
  const { api, context, session } = useSession();
  const client = useQueryClient();
  const companies = useLogisticsQuery(["team-company"], "/runtime/logistics/company", true, 45_000);
  const company = companies.data?.find((item) => asString(item, "owner_user_id") === session?.user.id)
    ?? companies.data?.[0]
    ?? null;
  const organizationId = asString(company, "organization_id");

  const directory = useLogisticsQuery(
    ["team-directory", organizationId ?? "none"],
    "/runtime/organization-staff/directory?organizationId=" + encodeURIComponent(organizationId ?? ""),
    Boolean(organizationId),
    30_000,
  );
  const roles = useLogisticsQuery(
    ["team-roles", organizationId ?? "none"],
    "/runtime/organization-roles",
    Boolean(organizationId),
  );
  const invitations = useLogisticsQuery(
    ["team-invitations", organizationId ?? "none"],
    "/runtime/organization-invitations",
    Boolean(organizationId),
    30_000,
  );

  const [email, setEmail] = useState("");
  const [selectedRoleKey, setSelectedRoleKey] = useState<string>(ROLE_PRESETS[1].key);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canManage = Boolean(
    organizationId &&
    (
      asString(company, "owner_user_id") === session?.user.id ||
      context?.permissions.some((permission) =>
        String(permission) === "business.staff.manage" ||
        String(permission) === "platform.organizations.manage"
      )
    )
  );

  const members = (directory.data ?? []) as StaffMember[];
  const pendingInvitations = useMemo(
    () => (invitations.data ?? []).filter((item) =>
      asString(item, "organization_id") === organizationId &&
      asString(item, "status") === "pending"
    ),
    [invitations.data, organizationId],
  );
  const selectedRole = ROLE_PRESETS.find((role) => role.key === selectedRoleKey) ?? ROLE_PRESETS[1];

  const refresh = () => Promise.all([companies.refetch(), directory.refetch(), invitations.refetch(), roles.refetch()]);

  const invite = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error("Register your Logistics company first.");
      const invitedEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitedEmail)) {
        throw new Error("Enter a valid work email address.");
      }
      const idempotencyKey = createClientIdempotencyKey(
        "logistics.staff.invite",
        organizationId + ":" + invitedEmail + ":" + String(Date.now()),
      );
      const roleExists = (roles.data ?? []).some((role) =>
        asString(role, "organization_id") === organizationId &&
        asString(role, "key") === selectedRole.key &&
        asString(role, "status") === "active"
      );
      if (!roleExists) {
        await api.post("/runtime/organization-roles", {
          organizationId,
          roleKey: selectedRole.key,
          displayName: selectedRole.name,
          description: selectedRole.description,
          permissionKeys: [...selectedRole.permissions],
          branchId: null,
          source: "skima.logistics.mobile",
          idempotencyKey: createClientIdempotencyKey("logistics.staff.role", organizationId + ":" + selectedRole.key),
          metadata: { module: "logistics_network", preset: selectedRole.key },
        }, z.string().uuid());
      }

      return api.post("/runtime/organization-invitations", {
        organizationId,
        invitedEmail,
        roleKey: selectedRole.key,
        branchKey: null,
        membershipType: "member",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        source: "skima.logistics.mobile",
        idempotencyKey,
        metadata: { module: "logistics_network", roleKey: selectedRole.key },
      }, z.string().uuid());
    },
    onSuccess: async () => {
      setEmail("");
      setError(null);
      setNotice("The company invitation has been created and is awaiting acceptance.");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["skima-logistics", "team-directory"] }),
        client.invalidateQueries({ queryKey: ["skima-logistics", "team-invitations"] }),
      ]);
      await Promise.all([directory.refetch(), invitations.refetch(), roles.refetch()]);
    },
    onError: (cause) => {
      setNotice(null);
      setError(cause instanceof Error ? cause.message : "The invitation could not be created.");
    },
  });

  const changeAccess = useMutation({
    mutationFn: async (input: { userId: string; status: "active" | "suspended" }) => {
      if (!organizationId) throw new Error("Company workspace is unavailable.");
      return api.post("/runtime/organization-staff/status", {
        organizationId,
        userId: input.userId,
        status: input.status,
        reason: input.status === "suspended" ? "Company access paused by an authorised company owner." : "Company access restored by an authorised company owner.",
        idempotencyKey: createClientIdempotencyKey(
          "logistics.staff.status",
          organizationId + ":" + input.userId + ":" + input.status + ":" + String(Date.now()),
        ),
        metadata: { module: "logistics_network" },
      }, z.string().uuid());
    },
    onSuccess: async () => {
      setError(null);
      await client.invalidateQueries({ queryKey: ["skima-logistics", "team-directory"] });
      await directory.refetch();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Staff access could not be updated."),
  });

  return (
    <Screen
      eyebrow="COMPANY ADMINISTRATION"
      title="Your team"
      subtitle="Invite trusted people into your Logistics company and give each person only the access their work requires."
      refreshControl={<RefreshControl refreshing={companies.isRefetching || directory.isRefetching || invitations.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}
    >
      {companies.isPending ? <ScreenSkeleton cards={2} /> : companies.error ? (
        <StatePanel title="Company workspace unavailable" description="We could not load your Logistics company." retry={() => void refresh()} />
      ) : !company ? (
        <StatePanel title="Register your company first" description="Your team workspace becomes available after you create a Logistics company." />
      ) : !canManage ? (
        <Card padding="lg">
          <View style={[styles.icon, { backgroundColor: palette.warningSoft }]}><ShieldCheck color={palette.warning} size={22} /></View>
          <Text style={[styles.cardTitle, { color: palette.ink }]}>Owner access required</Text>
          <Text style={[styles.body, { color: palette.muted }]}>Only the company owner or an authorised organisation staff administrator can invite people or change company access.</Text>
        </Card>
      ) : directory.isPending || invitations.isPending || roles.isPending ? (
        <ScreenSkeleton cards={3} />
      ) : directory.error || invitations.error || roles.error ? (
        <StatePanel title="Team records could not load" description="The company directory or invitation list is unavailable." retry={() => void refresh()} />
      ) : (
        <View style={styles.content}>
          <Card variant="brandSoft" padding="lg">
            <View style={styles.cardHeading}>
              <View style={[styles.icon, { backgroundColor: palette.surface }]}><Users color={palette.brand} size={21} /></View>
              <View style={styles.copy}>
                <Text style={[styles.eyebrow, { color: palette.brand }]}>COMPANY TEAM</Text>
                <Text style={[styles.cardTitle, { color: palette.ink }]}>{members.length} {members.length === 1 ? "member" : "members"}</Text>
                <Text style={[styles.body, { color: palette.muted }]}>{pendingInvitations.length} pending {pendingInvitations.length === 1 ? "invitation" : "invitations"}</Text>
              </View>
              <ShieldCheck color={palette.success} size={21} />
            </View>
          </Card>

          <Card padding="lg">
            <SectionHeader title="Invite a teammate" description="Invitations expire after seven days. Access is restricted to the selected company role." />
            <AppField
              label="Work email address"
              value={email}
              onChangeText={setEmail}
              placeholder="name@company.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Text style={[styles.fieldLabel, { color: palette.ink }]}>Choose access level</Text>
            <View style={styles.roleList}>
              {ROLE_PRESETS.map((role) => {
                const chosen = selectedRoleKey === role.key;
                return (
                  <View key={role.key} style={[styles.roleChoice, { borderColor: chosen ? palette.brand : palette.border, backgroundColor: chosen ? palette.brandSoft : palette.surface }]}>
                    <Text style={[styles.roleName, { color: palette.ink }]}>{role.name}</Text>
                    <Text style={[styles.roleDescription, { color: palette.muted }]}>{role.description}</Text>
                    <AppButton
                      size="sm"
                      variant={chosen ? "primary" : "secondary"}
                      label={chosen ? "Selected" : "Choose"}
                      onPress={() => setSelectedRoleKey(role.key)}
                    />
                  </View>
                );
              })}
            </View>
            <View style={[styles.permissionNote, { backgroundColor: palette.surfaceSubtle }]}>
              <ShieldCheck color={palette.success} size={16} />
              <Text style={[styles.permissionText, { color: palette.muted }]}>
                Staff roles cannot grant platform administration. Finance viewers can read company Logistics financial information but cannot move funds or change fee policies.
              </Text>
            </View>
            {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
            {notice ? <Text style={[styles.notice, { color: palette.success }]}>{notice}</Text> : null}
            <AppButton
              label="Create company invitation"
              fullWidth
              loading={invite.isPending}
              disabled={email.trim().length < 5}
              onPress={() => { setError(null); setNotice(null); invite.mutate(); }}
              icon={<MailPlus color="#FFFFFF" size={16} />}
            />
          </Card>

          <View style={styles.section}>
            <SectionHeader title="Company members" description="Only people attached to this Logistics organisation appear here." />
            {members.length === 0 ? (
              <Card variant="subtle" padding="lg">
                <Text style={[styles.body, { color: palette.muted }]}>No team members are registered yet.</Text>
              </Card>
            ) : members.map((member) => {
              const userId = typeof member.userId === "string" ? member.userId : "";
              const roles = Array.isArray(member.roles) ? member.roles : [];
              const roleNames = roles.map((role) => asString(role, "roleName")).filter((value): value is string => Boolean(value));
              const membershipType = String(member.membershipType ?? "member");
              const status = String(member.status ?? "unknown");
              const isSelf = userId === session?.user.id;
              const isOwner = membershipType === "owner";
              const canChange = userId.length > 0 && !isSelf && !isOwner && status !== "removed";
              return (
                <Card key={userId || String(member.membershipId)} padding="md">
                  <View style={styles.memberRow}>
                    <View style={[styles.memberAvatar, { backgroundColor: palette.brandSoft }]}><UserRound color={palette.brand} size={19} /></View>
                    <View style={styles.copy}>
                      <Text style={[styles.memberName, { color: palette.ink }]} numberOfLines={1}>{typeof member.displayName === "string" && member.displayName.trim() ? member.displayName : member.email ?? "Company member"}</Text>
                      <Text style={[styles.memberEmail, { color: palette.muted }]} numberOfLines={1}>{typeof member.email === "string" ? member.email : "Email unavailable"}</Text>
                      <Text style={[styles.roleDescription, { color: palette.muted }]}>{isOwner ? "Company owner" : roleNames.join(", ") || "No assigned role"}</Text>
                    </View>
                    <StatusPill status={status} />
                  </View>
                  {canChange ? (
                    <AppButton
                      size="sm"
                      fullWidth
                      variant="secondary"
                      loading={changeAccess.isPending && changeAccess.variables?.userId === userId}
                      disabled={changeAccess.isPending}
                      label={status === "suspended" ? "Restore company access" : "Pause company access"}
                      icon={status === "suspended" ? <UserCheck color={palette.success} size={15} /> : <UserX color={palette.danger} size={15} />}
                      onPress={() => changeAccess.mutate({ userId, status: status === "suspended" ? "active" : "suspended" })}
                    />
                  ) : null}
                </Card>
              );
            })}
          </View>

          <View style={styles.section}>
            <SectionHeader title="Pending invitations" description="People who have not yet accepted their company access." />
            {pendingInvitations.length === 0 ? (
              <Card variant="subtle" padding="lg"><Text style={[styles.body, { color: palette.muted }]}>There are no pending invitations.</Text></Card>
            ) : pendingInvitations.map((invitation) => (
              <View key={String(invitation.id)} style={[styles.invitation, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={[styles.invitationIcon, { backgroundColor: palette.brandSoft }]}><MailPlus color={palette.brand} size={16} /></View>
                <View style={styles.copy}>
                  <Text style={[styles.memberName, { color: palette.ink }]}>{asString(invitation, "invited_email") ?? "Invited teammate"}</Text>
                  <Text style={[styles.memberEmail, { color: palette.muted }]}>Expires {dateLabel(invitation.expires_at)}</Text>
                </View>
                <StatusPill status="pending" />
              </View>
            ))}
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  section: { gap: spacing.sm },
  cardHeading: { flexDirection: "row", alignItems: "center", gap: 11 },
  icon: { width: 43, height: 43, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  eyebrow: { ...typography.eyebrow, fontSize: 8 },
  cardTitle: { ...typography.bodyStrong, fontSize: 14 },
  body: { ...typography.caption, fontSize: 10, lineHeight: 17 },
  fieldLabel: { ...typography.caption, fontSize: 11, fontWeight: "900" },
  roleList: { gap: 8 },
  roleChoice: { borderWidth: 1, borderRadius: radii.lg, padding: 11, gap: 6 },
  roleName: { ...typography.bodyStrong, fontSize: 12 },
  roleDescription: { ...typography.caption, fontSize: 9, lineHeight: 15 },
  permissionNote: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: radii.md },
  permissionText: { ...typography.caption, fontSize: 9, lineHeight: 15, flex: 1 },
  error: { ...typography.caption, fontSize: 10, lineHeight: 17 },
  notice: { ...typography.caption, fontSize: 10, lineHeight: 17 },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 9 },
  memberAvatar: { width: 39, height: 39, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  memberName: { ...typography.bodyStrong, fontSize: 11 },
  memberEmail: { ...typography.caption, fontSize: 9 },
  invitation: { minHeight: 62, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  invitationIcon: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
