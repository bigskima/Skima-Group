import { router } from "expo-router";
import { MailPlus, ShieldCheck, UserMinus, Users } from "lucide-react-native";
import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import {
  domainQueries,
  useLpgConfig,
  useOrganizationInvitations,
  useOrganizationRoles,
} from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  displayStatus,
  firstNumber,
  firstString,
  nestedRecord,
  nestedRecords,
  recordId,
} from "../api/records";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";

export function StaffScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const organizationId = session.context?.organizations.find((item) => item.organizationId)?.organizationId ?? null;
  const staff = domainQueries.staff(organizationId);
  const roles = useOrganizationRoles();
  const invitations = useOrganizationInvitations();
  const config = useLpgConfig();
  const allowed = Boolean(
    session.context?.platformAdmin ||
      session.context?.permissions.includes("business.staff.manage") ||
      session.context?.roles.some((role) => role.permissions.includes("business.staff.manage")),
  );

  const availableRoles = useMemo(
    () =>
      (roles.data ?? []).filter(
        (role) =>
          firstString(role, ["organization_id", "organizationId"]) === organizationId &&
          firstString(role, ["key"]) !== "lpg.station.owner",
      ),
    [organizationId, roles.data],
  );
  const policies = nestedRecord(config.data, "policies");
  const policyContainer = nestedRecord(policies, "lpg.station_staff.phase_one");
  const policy = nestedRecord(policyContainer, "policy") ?? policyContainer;
  const ttlHours = firstNumber(policy, ["invitation_ttl_hours", "invitationTtlHours"]);
  const pendingInvitations = (invitations.data ?? []).filter(
    (item) =>
      firstString(item, ["organization_id", "organizationId"]) === organizationId &&
      firstString(item, ["status"]) === "pending",
  );

  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageSuccess, setMessageSuccess] = useState(false);

  const invite = useGatewayMutation({
    path: "/runtime/organization-invitations",
    schema: ActionResponseSchema,
    invalidate: [["organization-invitations"], ["staff", organizationId]],
  });
  const status = useGatewayMutation({
    path: "/runtime/organization-staff/status",
    schema: ActionResponseSchema,
    invalidate: [["staff", organizationId]],
  });

  const submit = async () => {
    setMessage(null);
    if (!organizationId || !roleKey || !email.trim() || ttlHours === null) {
      setMessageSuccess(false);
      setMessage("Enter a valid work email, choose a staff role and make sure the invitation policy is available.");
      return;
    }
    try {
      await invite.mutateAsync({
        organizationId,
        invitedEmail: email.trim().toLowerCase(),
        roleKey,
        membershipType: "member",
        expiresAt: new Date(Date.now() + ttlHours * 3600000).toISOString(),
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("station-staff-invite", email.trim().toLowerCase()),
      });
      setEmail("");
      setRoleKey("");
      setMessageSuccess(true);
      setMessage("Staff invitation created successfully.");
    } catch (cause) {
      setMessageSuccess(false);
      setMessage(friendlyError(cause, "The staff invitation could not be created."));
    }
  };

  const change = async (
    memberId: string,
    userId: string,
    next: "active" | "suspended" | "removed",
  ) => {
    if (!organizationId || userId === session.context?.user.id) return;
    setMessage(null);
    try {
      await status.mutateAsync({
        organizationId,
        userId,
        membershipId: memberId,
        status: next,
        reason: "station.account.staff_status",
        idempotencyKey: idempotencyKey(`station-staff-${next}`, userId),
      });
      setMessageSuccess(true);
      setMessage(next === "active" ? "Staff access restored." : next === "suspended" ? "Staff access suspended." : "Staff member removed from this station.");
    } catch (cause) {
      setMessageSuccess(false);
      setMessage(friendlyError(cause, "Staff access could not be changed."));
    }
  };

  if (!allowed) {
    return (
      <Screen
        eyebrow="Station access"
        title="Staff & permissions"
        subtitle="Staff management is available only to authorised station roles."
      >
        <EmptyState
          icon={<ShieldCheck color={palette.brand} size={28} />}
          title="Staff management restricted"
          description="Your current station role does not include the staff-management permission."
          action={<AppButton label="Back" variant="secondary" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  const loading = staff.isPending || roles.isPending || invitations.isPending || config.isPending;
  const failed = staff.error || roles.error || invitations.error || config.error;

  return (
    <Screen
      eyebrow="Station access"
      title="Staff & permissions"
      subtitle="Invite station teammates and manage existing membership access without sharing owner credentials."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      {loading ? (
        <ScreenSkeleton cards={4} />
      ) : failed ? (
        <EmptyState
          icon={<Users color={palette.brand} size={28} />}
          title="Staff workspace could not be loaded"
          description="Check your connection and refresh this station workspace."
          action={<AppButton label="Retry" onPress={() => void Promise.all([staff.refetch(), roles.refetch(), invitations.refetch(), config.refetch()])} />}
        />
      ) : (
        <>
          <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroIcon}><Users color="#FFFFFF" size={27} /></View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>STATION TEAM</Text>
              <Text style={styles.heroTitle}>{staff.data?.length ?? 0} active membership records</Text>
              <Text style={styles.heroBody}>{pendingInvitations.length} pending {pendingInvitations.length === 1 ? "invitation" : "invitations"} · role-based access controlled by SKIMA permissions.</Text>
            </View>
          </View>

          <SectionHeader title="Station members" description="Review who currently has membership access and the roles attached to each person." />
          <View style={styles.memberList}>
            {(staff.data ?? []).length ? (
              (staff.data ?? []).map((member, index) => {
                const memberId = recordId(member) ?? String(index);
                const userId = firstString(member, ["userId", "user_id"]) ?? "";
                const memberStatus = displayStatus(member) ?? "active";
                const assignedRoles = nestedRecords(member, "roles");
                const roleLabel =
                  assignedRoles
                    .map((role) => firstString(role, ["roleName", "displayName", "roleKey"]))
                    .filter(Boolean)
                    .join(" · ") || "Configured role";
                const isSelf = userId === session.context?.user.id;

                return (
                  <View
                    key={memberId}
                    style={[styles.memberCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}
                  >
                    <View style={[styles.memberAvatar, { backgroundColor: palette.brandSoft }]}>
                      <Text style={[styles.memberInitial, { color: palette.brand }]}>{initial(firstString(member, ["displayName", "display_name", "email"]) ?? "S")}</Text>
                    </View>
                    <View style={styles.memberCopy}>
                      <View style={styles.memberTitleRow}>
                        <Text numberOfLines={1} style={[styles.memberName, { color: palette.ink }]}>
                          {firstString(member, ["displayName", "display_name"]) ?? "Station member"}
                        </Text>
                        {isSelf ? <StatusPill label="You" tone="brand" /> : null}
                      </View>
                      <Text numberOfLines={1} style={[styles.memberEmail, { color: palette.muted }]}>{firstString(member, ["email"]) ?? "Email unavailable"}</Text>
                      <Text numberOfLines={2} style={[styles.memberRole, { color: palette.mutedStrong }]}>{roleLabel}</Text>
                    </View>
                    <View style={styles.memberActions}>
                      <StatusPill label={friendly(memberStatus)} tone={memberStatus === "active" ? "success" : memberStatus === "suspended" ? "warning" : "neutral"} />
                      {!isSelf ? (
                        <View style={styles.actionRow}>
                          <AppButton
                            label={memberStatus === "suspended" ? "Restore" : "Suspend"}
                            variant="ghost"
                            size="sm"
                            disabled={status.isPending}
                            onPress={() => void change(memberId, userId, memberStatus === "suspended" ? "active" : "suspended")}
                          />
                          <AppButton
                            label="Remove"
                            variant="danger"
                            size="sm"
                            disabled={status.isPending}
                            icon={<UserMinus color="#FFFFFF" size={14} />}
                            onPress={() => void change(memberId, userId, "removed")}
                          />
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })
            ) : (
              <EmptyState
                icon={<Users color={palette.brand} size={27} />}
                title="No staff members listed"
                description="Station membership records will appear here after staff are invited and added."
              />
            )}
          </View>

          <SectionHeader title="Invite station staff" description="Send an expiring invitation and assign a predefined station role." />
          <View style={[styles.inviteCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.inviteHead}>
              <View style={[styles.inviteIcon, { backgroundColor: palette.brandSoft }]}><MailPlus color={palette.brand} size={22} /></View>
              <View style={styles.inviteCopy}>
                <Text style={[styles.inviteTitle, { color: palette.ink }]}>New staff invitation</Text>
                <Text style={[styles.inviteBody, { color: palette.muted }]}>The recipient receives the role you choose; station-owner access is intentionally excluded from this invitation list.</Text>
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>Work email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                placeholder="name@example.com"
                placeholderTextColor={palette.muted}
                style={[styles.input, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink }]}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.fieldLabel, { color: palette.ink }]}>Staff role</Text>
              <View style={styles.roleOptions}>
                {availableRoles.map((role) => {
                  const key = firstString(role, ["key"]) ?? "";
                  return (
                    <AppButton
                      key={key}
                      label={firstString(role, ["display_name", "displayName"]) ?? key}
                      size="sm"
                      variant={roleKey === key ? "primary" : "secondary"}
                      onPress={() => setRoleKey(key)}
                    />
                  );
                })}
              </View>
            </View>

            <AppButton
              label="Send invitation"
              fullWidth
              loading={invite.isPending}
              disabled={ttlHours === null || !email.trim() || !roleKey}
              icon={<MailPlus color="#FFFFFF" size={17} />}
              onPress={() => void submit()}
            />

            {ttlHours !== null ? (
              <Text style={[styles.expiry, { color: palette.muted }]}>Invitation expires automatically after {ttlHours} hours.</Text>
            ) : (
              <Text style={[styles.expiry, { color: palette.danger }]}>Invitation policy is currently unavailable.</Text>
            )}
          </View>

          <SectionHeader title="Pending invitations" description="Invitations that have not yet been accepted or expired." />
          <View style={styles.invitationList}>
            {pendingInvitations.length ? (
              pendingInvitations.map((item, index) => (
                <View key={recordId(item) ?? String(index)} style={[styles.invitationCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                  <View style={[styles.invitationIcon, { backgroundColor: palette.brandSoft }]}><MailPlus color={palette.brand} size={19} /></View>
                  <View style={styles.invitationCopy}>
                    <Text numberOfLines={1} style={[styles.invitationEmail, { color: palette.ink }]}>{firstString(item, ["invited_email", "invitedEmail"]) ?? "Invited member"}</Text>
                    <Text style={[styles.invitationMeta, { color: palette.muted }]}>Expires {formatDate(firstString(item, ["expires_at", "expiresAt"]))}</Text>
                  </View>
                  <StatusPill label="Pending" tone="warning" />
                </View>
              ))
            ) : (
              <EmptyState
                icon={<MailPlus color={palette.brand} size={26} />}
                title="No pending invitations"
                description="New staff invitations will appear here until they are accepted or expire."
              />
            )}
          </View>
        </>
      )}

      {message ? (
        <View style={[styles.message, { backgroundColor: messageSuccess ? palette.successSoft : palette.dangerSoft }]}>
          <Text accessibilityRole="alert" style={[styles.messageText, { color: messageSuccess ? palette.success : palette.danger }]}>{message}</Text>
        </View>
      ) : null}
    </Screen>
  );
}

function formatDate(value: string | null) {
  if (!value) return "according to policy";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function friendly(value: string) {
  return value.replace(/[_-]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function initial(value: string) {
  return value.trim().charAt(0).toUpperCase() || "S";
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, gap: 3 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 },
  heroTitle: { color: "#FFFFFF", ...typography.heading, fontSize: 21 },
  heroBody: { color: "rgba(255,255,255,.84)", ...typography.caption, lineHeight: 18 },
  memberList: { gap: spacing.sm },
  memberCard: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  memberAvatar: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  memberInitial: { ...typography.heading, fontSize: 18 },
  memberCopy: { flex: 1, minWidth: 0, gap: 2 },
  memberTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  memberName: { flexShrink: 1, ...typography.bodyStrong, fontSize: 14 },
  memberEmail: { ...typography.caption, fontSize: 11 },
  memberRole: { ...typography.caption, lineHeight: 17, marginTop: 2 },
  memberActions: { alignItems: "flex-end", gap: spacing.sm },
  actionRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: spacing.xs },
  inviteCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  inviteHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  inviteIcon: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  inviteCopy: { flex: 1, gap: 3 },
  inviteTitle: { ...typography.subheading, fontSize: 15 },
  inviteBody: { ...typography.caption, lineHeight: 18 },
  fieldGroup: { gap: spacing.sm },
  fieldLabel: { ...typography.caption, fontSize: 13, fontWeight: "900" },
  input: { minHeight: 54, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, fontSize: 15 },
  roleOptions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  expiry: { ...typography.caption, textAlign: "center" },
  invitationList: { gap: spacing.sm },
  invitationCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  invitationIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  invitationCopy: { flex: 1, minWidth: 0, gap: 2 },
  invitationEmail: { ...typography.bodyStrong, fontSize: 14 },
  invitationMeta: { ...typography.caption, fontSize: 11 },
  message: { borderRadius: radii.md, padding: spacing.md },
  messageText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
});