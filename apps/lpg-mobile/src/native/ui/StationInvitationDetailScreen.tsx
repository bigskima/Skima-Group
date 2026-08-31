import { router, useLocalSearchParams } from "expo-router";
import { RefreshControl, Text } from "react-native";
import { domainQueries, useOrganizationInvitations } from "../api/domains";
import { invitationIdFromMessage, isStationInvitationMessage } from "../api/stationInvitations";
import { recordId } from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StationInvitationNotification } from "./StationInvitationNotification";

export function StationInvitationDetailScreen() {
  const { palette } = useAppTheme();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const invitationId = Array.isArray(params.id) ? params.id[0] : params.id;
  const messages = domainQueries.notifications();
  const invitations = useOrganizationInvitations();
  const message = (messages.data ?? []).find((item) =>
    isStationInvitationMessage(item) && invitationIdFromMessage(item) === invitationId,
  );
  const invitation = (invitations.data ?? []).find((item) => recordId(item) === invitationId);
  const refreshing = messages.isRefetching || invitations.isRefetching;

  return (
    <Screen
      eyebrow="Notifications"
      title="Station invitation"
      subtitle="Review the station and role before responding."
      action={<AppButton label="Back" variant="secondary" size="sm" onPress={() => router.back()} />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void Promise.all([messages.refetch(), invitations.refetch()])} tintColor={palette.brand} />}
    >
      {message ? (
        <StationInvitationNotification message={message} invitation={invitation} showDetails />
      ) : messages.isPending || invitations.isPending ? (
        <Text style={{ ...typography.body, color: palette.muted }}>Loading invitation…</Text>
      ) : (
        <EmptyState
          title="Invitation not found"
          description="This invitation may no longer be available, or it may belong to another account."
        />
      )}
    </Screen>
  );
}
