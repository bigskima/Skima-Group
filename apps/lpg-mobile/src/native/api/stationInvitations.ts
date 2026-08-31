import { firstString, nestedRecord, recordId, type PlatformRecord } from "./records";

export type StationInvitationStatus = "pending" | "accepted" | "declined" | "expired" | "revoked";

export type StationInvitationView = {
  id: string;
  stationName: string;
  roleName: string;
  status: StationInvitationStatus;
  title: string;
  body: string;
  expiresAt: string | null;
};

export function isStationInvitationMessage(message: PlatformRecord) {
  return firstString(message, ["source"]) === "skima.organization.invitation"
    || firstString(message, ["purpose"]) === "organization.staff.invitation";
}

export function invitationIdFromMessage(message: PlatformRecord) {
  const payload = nestedRecord(message, "payload");
  const metadata = nestedRecord(message, "metadata");
  return firstString(payload, ["invitationId", "invitation_id"])
    ?? firstString(metadata, ["invitationId", "invitation_id"]);
}

export function resolveStationInvitation(
  message: PlatformRecord,
  invitation?: PlatformRecord | null,
  now = new Date(),
): StationInvitationView | null {
  const payload = nestedRecord(message, "payload");
  const id = invitationIdFromMessage(message) ?? (invitation ? recordId(invitation) : null);
  if (!id) return null;

  const stationName = firstString(payload, ["stationName", "station_name", "organizationName", "organization_name"])
    ?? "Your station";
  const roleName = firstString(payload, ["roleDisplayName", "role_display_name", "roleName", "role_name"])
    ?? "Team member";
  const expiresAt = firstString(invitation, ["expires_at", "expiresAt"])
    ?? firstString(payload, ["expiresAt", "expires_at"]);
  let status = normalizeInvitationStatus(
    firstString(invitation, ["status"])
      ?? firstString(payload, ["invitationStatus", "invitation_status", "status"]),
  );
  if (status === "pending" && expiresAt) {
    const expiry = new Date(expiresAt);
    if (!Number.isNaN(expiry.getTime()) && expiry <= now) status = "expired";
  }

  const copy = invitationCopy(status, stationName, roleName);
  return { id, stationName, roleName, status, expiresAt, ...copy };
}

function normalizeInvitationStatus(value: string | null): StationInvitationStatus {
  if (value === "accepted" || value === "declined" || value === "expired" || value === "revoked") return value;
  return "pending";
}

function invitationCopy(status: StationInvitationStatus, stationName: string, roleName: string) {
  if (status === "accepted") {
    return { title: "Invitation accepted", body: `You joined ${stationName} as a ${roleName}.` };
  }
  if (status === "declined") {
    return { title: "Invitation declined", body: `You declined the invitation from ${stationName}.` };
  }
  if (status === "expired") {
    return { title: "Invitation expired", body: `The invitation from ${stationName} has expired.` };
  }
  if (status === "revoked") {
    return { title: "Invitation no longer available", body: `The invitation from ${stationName} is no longer available.` };
  }
  return {
    title: "Station invitation",
    body: `${stationName} has invited you to join their team as a ${roleName}.`,
  };
}
