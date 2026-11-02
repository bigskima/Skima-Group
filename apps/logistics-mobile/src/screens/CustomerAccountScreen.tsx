import { router } from "expo-router";
import { ChevronRight, CircleHelp, LogOut, MailCheck, Moon, ShieldCheck, Sun, UserRound } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";
import { createClientIdempotencyKey } from "@skima/frontend-core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { asString, useLogisticsQuery } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { BrandMark } from "../ui/BrandMark";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";

export function CustomerAccountScreen({ workspace = "customer" }: { workspace?: "customer" | "provider" }) {
  const { palette, scheme, toggle } = useAppTheme();
  const { api, context, session, signOut } = useSession();
  const client = useQueryClient();
  const [invitationNotice, setInvitationNotice] = useState<string | null>(null);
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const invitations = useLogisticsQuery(["my-logistics-invitations"], "/runtime/organization-invitations", true, 60_000);
  const pendingInvitations = useMemo(() => {
    const emailAddress = session?.user.email?.trim().toLowerCase();
    const currentUserId = session?.user.id;
    const now = Date.now();
    return (invitations.data ?? []).filter((item) => {
      const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
        ? item.metadata as Record<string, unknown>
        : {};
      const invitedEmail = asString(item, "invited_email")?.toLowerCase();
      const invitedUserId = asString(item, "invited_user_id");
      const expiry = Date.parse(asString(item, "expires_at") ?? "");
      return metadata.module === "logistics_network" &&
        asString(item, "status") === "pending" &&
        Boolean((emailAddress && invitedEmail === emailAddress) || (currentUserId && invitedUserId === currentUserId)) &&
        (!Number.isFinite(expiry) || expiry > now);
    });
  }, [invitations.data, session?.user.email, session?.user.id]);
  const respondToInvitation = useMutation({
    mutationFn: async (input: { invitationId: string; action: "accept" | "decline" }) =>
      api.post("/runtime/organization-invitations/" + input.action, {
        invitationId: input.invitationId,
        idempotencyKey: createClientIdempotencyKey(
          "logistics.invitation." + input.action,
          input.invitationId,
        ),
        metadata: { module: "logistics_network", client: "skima-logistics-mobile" },
      }, z.string().uuid()),
    onSuccess: async (_result, input) => {
      setInvitationError(null);
      setInvitationNotice(input.action === "accept"
        ? "Company invitation accepted. You can now open the company workspace."
        : "Company invitation declined.");
      await client.invalidateQueries({ queryKey: ["skima-logistics", "my-logistics-invitations"] });
      await invitations.refetch();
    },
    onError: (cause) => setInvitationError(cause instanceof Error ? cause.message : "The invitation response could not be completed."),
  });
  const name = context?.profile?.display_name ?? (typeof session?.user.user_metadata?.display_name === "string" ? session.user.user_metadata.display_name : "SKIMA customer");
  const email = session?.user.email ?? "Signed-in account";
  return (
    <Screen eyebrow="YOUR ACCOUNT" title="Account & preferences" subtitle="Manage your SKIMA Logistics experience.">
      <View style={styles.brandRow}><BrandMark /></View>
      <Card padding="lg">
        <View style={styles.profileRow}>
          <View style={[styles.avatar, { backgroundColor: palette.brandSoft }]}><UserRound color={palette.brand} size={25} /></View>
          <View style={styles.profileCopy}>
            <Text style={[styles.profileName, { color: palette.ink }]}>{name}</Text>
            <Text style={[styles.profileEmail, { color: palette.muted }]}>{email}</Text>
            <View style={[styles.secure, { backgroundColor: palette.successSoft }]}><ShieldCheck color={palette.success} size={12} /><Text style={[styles.secureText, { color: palette.success }]}>Secure account</Text></View>
          </View>
        </View>
      </Card>

      {pendingInvitations.length > 0 || invitations.error || invitationNotice ? (
        <View style={styles.section}>
          <View style={styles.invitationHeading}>
            <MailCheck color={palette.brand} size={19} />
            <Text style={[styles.sectionTitle, { color: palette.ink }]}>Company invitations</Text>
          </View>
          {invitations.error ? (
            <Card variant="warning" padding="md">
              <Text style={[styles.error, { color: palette.ink }]}>Your invitations could not be loaded.</Text>
              <AppButton size="sm" variant="secondary" label="Retry" onPress={() => void invitations.refetch()} />
            </Card>
          ) : null}
          {pendingInvitations.map((invitation) => {
            const invitationId = asString(invitation, "id") ?? "";
            const organizationId = asString(invitation, "organization_id") ?? "";
            const organization = context?.organizations.find((item) => item.organizationId === organizationId);
            const busy = respondToInvitation.isPending && respondToInvitation.variables?.invitationId === invitationId;
            return (
              <Card key={invitationId} padding="lg">
                <Text style={[styles.profileName, { color: palette.ink }]}>You’re invited to join a SKIMA Logistics company</Text>
                <Text style={[styles.securityCopy, { color: palette.muted }]}>
                  Invitation for {email}. Accepting adds your account to the company workspace with the role selected by its owner.
                </Text>
                <Text style={[styles.preferenceSubtitle, { color: palette.muted }]}>
                  {organization?.displayName ?? ("Company reference " + organizationId.slice(0, 8).toUpperCase())}
                  {" · "}Expires {dateLabel(asString(invitation, "expires_at"))}
                </Text>
                <View style={styles.invitationActions}>
                  <View style={styles.invitationButton}>
                    <AppButton size="sm" fullWidth label="Decline" variant="secondary" disabled={respondToInvitation.isPending}
                      loading={busy && respondToInvitation.variables?.action === "decline"}
                      onPress={() => Alert.alert("Decline invitation?", "You will not be added to this company workspace.", [
                        { text: "Keep invitation", style: "cancel" },
                        { text: "Decline", style: "destructive", onPress: () => respondToInvitation.mutate({ invitationId, action: "decline" }) },
                      ])} />
                  </View>
                  <View style={styles.invitationButton}>
                    <AppButton size="sm" fullWidth label="Accept invitation" disabled={respondToInvitation.isPending}
                      loading={busy && respondToInvitation.variables?.action === "accept"}
                      onPress={() => respondToInvitation.mutate({ invitationId, action: "accept" })} />
                  </View>
                </View>
              </Card>
            );
          })}
          {invitationError ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{invitationError}</Text> : null}
          {invitationNotice ? (
            <Card variant="success" padding="md">
              <Text style={[styles.notice, { color: palette.success }]}>{invitationNotice}</Text>
              {invitationNotice.startsWith("Company invitation accepted") ? (
                <AppButton size="sm" fullWidth label="Open company workspace" onPress={() => router.replace("/(provider)" as never)} />
              ) : null}
            </Card>
          ) : null}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: palette.ink }]}>Workspaces</Text>
        <AppButton
          label={workspace === "customer" ? "Open company workspace" : "Return to customer app"}
          fullWidth
          variant="secondary"
          onPress={() => router.replace((workspace === "customer" ? "/(provider)" : "/(customer)") as never)}
        />
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: palette.ink }]}>Preferences</Text>
        <PressableRow icon={scheme === "dark" ? <Moon color={palette.brand} size={19} /> : <Sun color={palette.brand} size={19} />}
          title="Appearance" subtitle={scheme === "dark" ? "Dark mode" : "Light mode"} action={scheme === "dark" ? "Switch to light" : "Switch to dark"} onPress={() => void toggle()} />
        <PressableRow icon={<CircleHelp color={palette.brand} size={19} />} title="Help & support" subtitle="Get assistance with a request or booking" action="Coming soon" disabled />
      </View>

      <Card variant="subtle" padding="lg">
        <View style={styles.securityRow}><ShieldCheck color={palette.success} size={18} /><Text style={[styles.securityTitle, { color: palette.ink }]}>Your information is protected</Text></View>
        <Text style={[styles.securityCopy, { color: palette.muted }]}>Your account is secured through SKIMA authentication. Job and payment details are shared only with the participants authorised to see them.</Text>
      </Card>

      <AppButton label="Sign out" variant="secondary" fullWidth icon={<LogOut color={palette.ink} size={16} />} onPress={() => Alert.alert("Sign out?", "You can sign back in at any time.", [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out", style: "destructive", onPress: () => { void signOut().then(() => router.replace("/(auth)/sign-in" as never)); } },
      ])} />
      <Text style={[styles.version, { color: palette.muted }]}>SKIMA Logistics · {workspace === "customer" ? "Customer app" : "Company workspace"}</Text>
    </Screen>
  );
}

function dateLabel(value: string | null) {
  if (!value) return "the stated expiry date";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "the stated expiry date" :
    new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" }).format(parsed);
}

function PressableRow({ icon, title, subtitle, action, disabled, onPress }: {
  icon: ReactNode; title: string; subtitle: string; action: string; disabled?: boolean; onPress?: () => void;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.preferenceRow, { backgroundColor: palette.surface, borderColor: palette.border, opacity: disabled ? 0.55 : pressed ? 0.78 : 1 }]}>
      <View style={[styles.preferenceIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
      <View style={styles.preferenceCopy}><Text style={[styles.preferenceTitle, { color: palette.ink }]}>{title}</Text><Text style={[styles.preferenceSubtitle, { color: palette.muted }]}>{subtitle}</Text></View>
      {disabled ? <Text style={[styles.coming, { color: palette.muted }]}>{action}</Text> : <Text style={[styles.action, { color: palette.brand }]}>{action}</Text>}
      {!disabled ? <ChevronRight color={palette.muted} size={16} /> : null}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  brandRow: { marginTop: -7, marginBottom: 0 },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: { width: 58, height: 58, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  profileCopy: { flex: 1, gap: 4 },
  profileName: { ...typography.heading, fontSize: 17 },
  profileEmail: { ...typography.caption, fontSize: 11 },
  secure: { alignSelf: "flex-start", flexDirection: "row", gap: 5, alignItems: "center", paddingVertical: 4, paddingHorizontal: 8, borderRadius: radii.pill, marginTop: 3 },
  secureText: { ...typography.caption, fontSize: 9, fontWeight: "900" },
  section: { gap: 9 },
  sectionTitle: { ...typography.sectionTitle, paddingHorizontal: 2 },
  invitationHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  invitationActions: { flexDirection: "row", gap: 8 },
  invitationButton: { flex: 1 },
  error: { ...typography.caption, fontSize: 10, lineHeight: 16 },
  notice: { ...typography.caption, fontSize: 10, lineHeight: 16 },
  preferenceRow: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  preferenceIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  preferenceCopy: { flex: 1, gap: 2 },
  preferenceTitle: { ...typography.bodyStrong, fontSize: 12 },
  preferenceSubtitle: { ...typography.caption, fontSize: 9 },
  action: { ...typography.caption, fontSize: 9, fontWeight: "900" },
  coming: { ...typography.caption, fontSize: 9 },
  securityRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  securityTitle: { ...typography.bodyStrong, fontSize: 13 },
  securityCopy: { ...typography.caption, lineHeight: 18, fontSize: 10 },
  version: { ...typography.caption, fontSize: 9, textAlign: "center" },
});
