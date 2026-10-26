import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { CheckCircle2, Clock3, Mail, MapPin, ShieldCheck, Truck } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";

type StationInvitation = {
  enabled?: boolean;
  invitationId?: string;
  stationBranchId?: string;
  stationName?: string | null;
  stationAddress?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  email?: string | null;
  expiresAt?: string | null;
  invitedAt?: string | null;
  reason?: string | null;
};

export function StationDriverInvitationScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const queryClient = useQueryClient();
  const invitation = useQuery<StationInvitation>({
    queryKey: ["station-driver-invitation", session.context?.user.id ?? session.session?.user.id],
    enabled: session.status === "authenticated",
    retry: false,
    queryFn: async () => {
      const result = await session.supabase.rpc("read_lpg_station_managed_driver_invitation_access");
      if (result.error) throw result.error;
      return (result.data ?? { enabled: false }) as StationInvitation;
    },
  });
  const accept = useMutation({
    mutationFn: async () => {
      const result = await session.supabase.rpc("accept_lpg_station_managed_driver_invite");
      if (result.error) throw result.error;
      if (typeof result.data !== "string" || !result.data) {
        throw new Error("SKIMA could not confirm this invitation. Refresh the invitation and try again.");
      }
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["station-driver-invitation"] });
      await queryClient.invalidateQueries({ queryKey: ["lpg-expo", "workspace-access"] });
      router.replace("/(station-driver)" as never);
    },
  });
  const decline = useMutation({
    mutationFn: async () => {
      const result = await session.supabase.rpc("decline_lpg_station_managed_driver_invite");
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["station-driver-invitation"] });
      router.replace("/(customer)/account" as never);
    },
  });

  const data = invitation.data;
  const error = invitation.error ?? accept.error ?? decline.error;
  const busy = accept.isPending || decline.isPending;

  return (
    <Screen
      eyebrow="STATION INVITATION"
      title="Join a station delivery team"
      subtitle="Review the station and the invited account before deciding. The invitation is accepted here in SKIMA, not by opening the email."
      action={<AppButton label="Back" size="sm" variant="ghost" onPress={() => router.back()} />}
    >
      {invitation.isPending ? (
        <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.body, { color: palette.muted }]}>Checking for an invitation sent to your verified email…</Text>
        </View>
      ) : invitation.error ? (
        <EmptyState
          icon={<Mail color={palette.brand} size={26} />}
          title="Invitation could not be loaded"
          description={friendlyError(invitation.error, "Check your connection and refresh the invitation.")}
          action={<AppButton label="Retry" variant="secondary" onPress={() => void invitation.refetch()} />}
        />
      ) : !data?.enabled ? (
        <EmptyState
          icon={<Mail color={palette.brand} size={26} />}
          title="No pending station invitation"
          description={data?.reason === "confirmed_email_required"
            ? "Sign in with the verified email address that the station invited. You can review and accept the invitation here once the address is verified."
            : "There is no active station invitation for this verified email. Ask the station to resend an invitation if you expected one."}
          action={<AppButton label="Back to Account" onPress={() => router.replace("/(customer)/account" as never)} />}
        />
      ) : (
        <>
          <View style={[styles.hero, { backgroundColor: palette.brand }]}>
            <View style={styles.heroIcon}><Truck color={palette.brand} size={25} /></View>
            <Text style={styles.heroTitle}>{data.stationName || "Station delivery team"}</Text>
            <Text style={styles.heroBody}>Station Managed LPG driver</Text>
            <View style={styles.heroStatus}>
              <Clock3 color="#FFFFFF" size={14} />
              <Text style={styles.heroStatusText}>Awaiting your decision</Text>
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Text style={[styles.sectionTitle, { color: palette.ink }]}>Invitation details</Text>
            <Detail icon={<ShieldCheck color={palette.brand} size={17} />} label="Invited driver" value={data.driverName || "Your SKIMA account"} />
            <Detail icon={<Mail color={palette.brand} size={17} />} label="Verified email" value={data.email || session.context?.user.email || "Not available"} />
            {data.stationAddress ? <Detail icon={<MapPin color={palette.brand} size={17} />} label="Station address" value={data.stationAddress} /> : null}
            {data.expiresAt ? <Detail icon={<Clock3 color={palette.brand} size={17} />} label="Expires" value={formatDate(data.expiresAt)} /> : null}
            <View style={[styles.notice, { backgroundColor: palette.surfaceSubtle }]}>
              <Text style={[styles.noticeText, { color: palette.ink }]}>
                Accepting links this account to the inviting station for Station Managed deliveries. Eligible jobs and approved vehicles will continue to be assigned by SKIMA's existing dispatch system. This does not create an independent-driver profile or enable SKIMA driver payouts.
              </Text>
            </View>
            <AppButton
              label="Accept invitation"
              fullWidth
              size="lg"
              loading={accept.isPending}
              disabled={busy}
              icon={<CheckCircle2 color="#FFFFFF" size={18} />}
              onPress={() => accept.mutate()}
            />
            <AppButton
              label="Decline invitation"
              fullWidth
              variant="secondary"
              loading={decline.isPending}
              disabled={busy}
              onPress={() => decline.mutate()}
            />
            {error ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{friendlyError(error, "The invitation could not be updated. Please refresh and try again.")}</Text> : null}
          </View>
        </>
      )}
    </Screen>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.detail}>
      {icon}
      <View style={styles.detailCopy}>
        <Text style={[styles.detailLabel, { color: palette.muted }]}>{label}</Text>
        <Text style={[styles.detailValue, { color: palette.ink }]}>{value}</Text>
      </View>
    </View>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const styles = StyleSheet.create({
  hero: { borderRadius: radii.xl, padding: spacing.lg, gap: spacing.sm, alignItems: "flex-start" },
  heroIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  heroTitle: { color: "#FFFFFF", ...typography.heading, fontSize: 22, lineHeight: 28 },
  heroBody: { color: "rgba(255,255,255,.82)", ...typography.body },
  heroStatus: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.xs },
  heroStatusText: { color: "#FFFFFF", ...typography.caption, fontWeight: "800" },
  card: { borderWidth: 1, borderRadius: radii.xl, padding: spacing.md, gap: spacing.md },
  sectionTitle: { ...typography.heading, fontSize: 17 },
  body: { ...typography.body },
  detail: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  detailCopy: { flex: 1, minWidth: 0, gap: 3 },
  detailLabel: { ...typography.caption, fontSize: 11 },
  detailValue: { ...typography.bodyStrong, fontSize: 14 },
  notice: { padding: spacing.md, borderRadius: radii.md },
  noticeText: { ...typography.caption, lineHeight: 19 },
  error: { ...typography.caption, fontWeight: "700" },
});
