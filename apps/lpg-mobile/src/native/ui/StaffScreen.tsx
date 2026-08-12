import { router } from "expo-router";
import { MailPlus, ShieldCheck, Users } from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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
import { colors, radii, spacing } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";
import { Card } from "./Card";
import { Screen } from "./Screen";
export function StaffScreen() {
  const session = useSession();
  const organizationId =
    session.context?.organizations.find((item) => item.organizationId)
      ?.organizationId ?? null;
  const staff = domainQueries.staff(organizationId);
  const roles = useOrganizationRoles();
  const invitations = useOrganizationInvitations();
  const config = useLpgConfig();
  const allowed = Boolean(
    session.context?.platformAdmin ||
    session.context?.permissions.includes("business.staff.manage") ||
    session.context?.roles.some((role) =>
      role.permissions.includes("business.staff.manage"),
    ),
  );
  const availableRoles = useMemo(
    () =>
      (roles.data ?? []).filter(
        (role) =>
          firstString(role, ["organization_id", "organizationId"]) ===
            organizationId &&
          firstString(role, ["key"]) !== "lpg.station.owner",
      ),
    [organizationId, roles.data],
  );
  const policies = nestedRecord(config.data, "policies");
  const policyContainer = nestedRecord(policies, "lpg.station_staff.phase_one");
  const policy = nestedRecord(policyContainer, "policy") ?? policyContainer;
  const ttlHours = firstNumber(policy, [
    "invitation_ttl_hours",
    "invitationTtlHours",
  ]);
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
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
    if (!organizationId || !roleKey || !email.trim() || ttlHours === null) {
      setMessage("Enter a valid email and choose a staff role.");
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
        idempotencyKey: idempotencyKey(
          "station-staff-invite",
          email.trim().toLowerCase(),
        ),
      });
      setEmail("");
      setRoleKey("");
      setMessage("Staff invitation created securely.");
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Invitation could not be created.",
      );
    }
  };
  const change = async (
    memberId: string,
    userId: string,
    next: "active" | "suspended" | "removed",
  ) => {
    if (!organizationId || userId === session.context?.user.id) return;
    try {
      await status.mutateAsync({
        organizationId,
        userId,
        membershipId: memberId,
        status: next,
        reason: "station.account.staff_status",
        idempotencyKey: idempotencyKey(`station-staff-${next}`, userId),
      });
      setMessage(`Staff access ${next}.`);
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Staff access could not be changed.",
      );
    }
  };
  if (!allowed)
    return (
      <Screen eyebrow="Station access" title="Staff and permissions">
        <Card>
          <ShieldCheck color={colors.brand} />
          <Text style={styles.title}>Access restricted</Text>
          <Text style={styles.body}>
            Your station access does not include staff management.
          </Text>
        </Card>
      </Screen>
    );
  const loading =
    staff.isPending ||
    roles.isPending ||
    invitations.isPending ||
    config.isPending;
  return (
    <Screen
      eyebrow="Station access"
      title="Staff and permissions"
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
      }
    >
      {loading ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <>
          <View style={styles.hero}>
            <Users color="white" size={28} />
            <View>
              <Text style={styles.heroTitle}>
                {staff.data?.length ?? 0} station members
              </Text>
              <Text style={styles.heroBody}>
                Invite teammates and control access to this station.
              </Text>
            </View>
          </View>
          {(staff.data ?? []).map((member, index) => {
            const memberId = recordId(member) ?? String(index);
            const userId = firstString(member, ["userId", "user_id"]) ?? "";
            const memberStatus = displayStatus(member) ?? "active";
            const assignedRoles = nestedRecords(member, "roles");
            return (
              <Card key={memberId}>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>
                      {firstString(member, ["displayName", "display_name"]) ??
                        "Station member"}
                    </Text>
                    <Text style={styles.body}>
                      {firstString(member, ["email"]) ?? "Email unavailable"}
                    </Text>
                    <Text style={styles.status}>
                      {assignedRoles
                        .map((role) =>
                          firstString(role, [
                            "roleName",
                            "displayName",
                            "roleKey",
                          ]),
                        )
                        .filter(Boolean)
                        .join(" · ") || "Configured role"}{" "}
                      · {memberStatus.replace(/[_-]/g, " ")}
                    </Text>
                  </View>
                  {userId !== session.context?.user.id ? (
                    <View style={styles.actions}>
                      <Pressable
                        onPress={() =>
                          void change(
                            memberId,
                            userId,
                            memberStatus === "suspended"
                              ? "active"
                              : "suspended",
                          )
                        }
                      >
                        <Text style={styles.back}>
                          {memberStatus === "suspended"
                            ? "Activate"
                            : "Suspend"}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void change(memberId, userId, "removed")}
                      >
                        <Text style={styles.danger}>Remove</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              </Card>
            );
          })}
          <Card>
            <View style={styles.heading}>
              <MailPlus color={colors.brand} />
              <Text style={styles.title}>Invite station staff</Text>
            </View>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="Work email address"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <View style={styles.options}>
              {availableRoles.map((role) => {
                const key = firstString(role, ["key"]) ?? "";
                return (
                  <Pressable
                    key={key}
                    onPress={() => setRoleKey(key)}
                    style={[styles.option, roleKey === key && styles.selected]}
                  >
                    <Text style={styles.optionText}>
                      {firstString(role, ["display_name", "displayName"]) ??
                        key}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              disabled={invite.isPending || ttlHours === null}
              onPress={() => void submit()}
              style={styles.primary}
            >
              {invite.isPending ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.primaryText}>Send secure invitation</Text>
              )}
            </Pressable>
            {ttlHours !== null ? (
              <Text style={styles.body}>
                Invitation expires after {ttlHours} hours.
              </Text>
            ) : (
              <Text style={styles.danger}>Invitation policy unavailable.</Text>
            )}
          </Card>
          <Text style={styles.section}>Pending invitations</Text>
          {(invitations.data ?? [])
            .filter(
              (item) =>
                firstString(item, ["organization_id", "organizationId"]) ===
                  organizationId && firstString(item, ["status"]) === "pending",
            )
            .map((item, index) => (
              <Card key={recordId(item) ?? String(index)}>
                <Text style={styles.title}>
                  {firstString(item, ["invited_email", "invitedEmail"]) ??
                    "Invited member"}
                </Text>
                <Text style={styles.body}>
                  Expires{" "}
                  {formatDate(firstString(item, ["expires_at", "expiresAt"]))}
                </Text>
              </Card>
            ))}
        </>
      )}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </Screen>
  );
}
function formatDate(value: string | null) {
  if (!value) return "according to policy";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
const styles = StyleSheet.create({
  back: { color: colors.brand, fontWeight: "800" },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.brand,
  },
  heroTitle: { color: "white", fontSize: 22, fontWeight: "900" },
  heroBody: { color: "#FFF1F2", marginTop: 4 },
  title: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  body: { color: colors.muted, lineHeight: 20 },
  status: { color: colors.brandDark, fontWeight: "700", marginTop: 5 },
  row: { flexDirection: "row", gap: spacing.md },
  actions: { alignItems: "flex-end", gap: spacing.sm },
  danger: { color: colors.danger, fontWeight: "800" },
  heading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    color: colors.ink,
  },
  options: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
  },
  selected: { borderColor: colors.brand, backgroundColor: "#FFF0F1" },
  optionText: { color: colors.ink, fontWeight: "700" },
  primary: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontWeight: "900" },
  section: { color: colors.ink, fontSize: 20, fontWeight: "900" },
  message: { color: colors.brandDark, fontWeight: "700" },
});
