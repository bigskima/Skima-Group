import { describe, expect, it } from "vitest";
import { invitationIdFromMessage, isStationInvitationMessage, resolveStationInvitation } from "./stationInvitations";

const invitationId = "8efb01f1-3aed-4474-9dd2-eb2057f1a80f";
const message = {
  source: "skima.organization.invitation",
  purpose: "organization.staff.invitation",
  payload: {
    invitationId,
    stationName: "ABC Gas Station",
    roleDisplayName: "Station Attendant",
    invitationStatus: "pending",
    expiresAt: "2026-09-01T10:00:00.000Z",
  },
};

describe("station invitation notifications", () => {
  it("uses backend station and role names for pending invitation copy", () => {
    expect(isStationInvitationMessage(message)).toBe(true);
    expect(invitationIdFromMessage(message)).toBe(invitationId);
    expect(resolveStationInvitation(message, null, new Date("2026-08-28T10:00:00.000Z"))).toMatchObject({
      id: invitationId,
      stationName: "ABC Gas Station",
      roleName: "Station Attendant",
      status: "pending",
      title: "Station invitation",
      body: "ABC Gas Station has invited you to join their team as a Station Attendant.",
    });
  });

  it("prefers the latest invitation state and removes the active wording", () => {
    expect(resolveStationInvitation(message, { id: invitationId, status: "accepted" })).toMatchObject({
      status: "accepted",
      title: "Invitation accepted",
      body: "You joined ABC Gas Station as a Station Attendant.",
    });
  });

  it("does not leave actions active for an expired invitation", () => {
    expect(resolveStationInvitation(message, null, new Date("2026-09-02T10:00:00.000Z"))?.status).toBe("expired");
  });
});
