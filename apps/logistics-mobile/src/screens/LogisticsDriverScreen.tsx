import { createClientIdempotencyKey } from "@skima/frontend-core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useRef, useState } from "react";
import { z } from "zod";
import { CheckCircle2, Clock3, MapPin, Package, Phone, ShieldCheck, Truck, UserRound } from "lucide-react-native";
import { asNumber, asString, useLogisticsQuery, useLogisticsRecordQuery } from "../api/logistics";
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
import { LogisticsDriverLocationShare } from "./LogisticsDriverLocationShare";

type DriverAction = "accept" | "reject" | "release" | "start" | "recover_start" | "pickup" | "transit" | "deliver";
type DriverJob = Record<string, unknown>;

function nested(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function place(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Location details";
  return asString(value as Record<string, unknown>, "display_name", "canonical_name", "formatted_address", "address") ?? "Location details";
}

function money(value: number | null, currency: string) {
  if (value === null) return currency;
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(value);
  } catch {
    return currency + " " + value.toLocaleString("en-NG");
  }
}

export function LogisticsDriverScreen() {
  const { palette } = useAppTheme();
  const { api } = useSession();
  const client = useQueryClient();
  const profile = useLogisticsRecordQuery(["driver-workspace-profile"], "/runtime/logistics/driver/profile", true);
  const jobs = useLogisticsQuery(["driver-workspace-bookings"], "/runtime/logistics/driver/bookings", true, 15_000);
  const incidentsQuery = useLogisticsQuery(["driver-booking-incidents"], "/runtime/logistics/bookings/incidents", true, 15_000);
  const [recipientNames, setRecipientNames] = useState<Record<string, string>>({});
  const [deliveryNotes, setDeliveryNotes] = useState<Record<string, string>>({});
  const [releaseReasons, setReleaseReasons] = useState<Record<string, string>>({});
  const [incidentTypes, setIncidentTypes] = useState<Record<string, string>>({});
  const [incidentSeverities, setIncidentSeverities] = useState<Record<string, string>>({});
  const [incidentDescriptions, setIncidentDescriptions] = useState<Record<string, string>>({});
  const actionKeys = useRef(new Map<string, string>());

  const runAction = useMutation({
    mutationFn: async (input: {
      kind: DriverAction;
      bookingId: string;
      assignmentId: string;
      recipientName?: string;
      deliveryNote?: string;
      reason?: string;
    }) => {
      if (input.kind === "deliver" && (input.recipientName?.trim().length ?? 0) < 2) {
        throw new Error("Enter the name of the person receiving the cargo.");
      }
      const evidence = input.kind === "deliver"
        ? ":" + input.recipientName?.trim() + ":" + (input.deliveryNote?.trim() ?? "")
        : input.kind === "release" ? ":" + (input.reason?.trim() ?? "") : "";
      const fingerprint = input.kind + ":" + input.bookingId + ":" + input.assignmentId + evidence;
      let idempotencyKey = actionKeys.current.get(fingerprint);
      if (!idempotencyKey) {
        idempotencyKey = createClientIdempotencyKey("logistics.driver." + input.kind, fingerprint);
        actionKeys.current.set(fingerprint, idempotencyKey);
      }

      if (input.kind === "accept" || input.kind === "reject") {
        return api.post("/runtime/logistics/driver/assignment/respond", {
          assignmentId: input.assignmentId,
          decision: input.kind,
          reason: input.kind === "reject" ? "Driver declined this assignment." : null,
          idempotencyKey,
        }, z.string().uuid());
      }
      if (input.kind === "release") {
        return api.post("/runtime/logistics/driver/assignment/release", {
          assignmentId: input.assignmentId,
          reason: input.reason?.trim() ?? "",
          idempotencyKey,
        }, z.string().uuid());
      }
      if (input.kind === "start") {
        return api.post("/runtime/logistics/bookings/start", {
          bookingId: input.bookingId,
          idempotencyKey,
        }, z.string().uuid());
      }
      if (input.kind === "recover_start") {
        return api.post("/runtime/logistics/bookings/recovery/start", {
          bookingId: input.bookingId,
          idempotencyKey,
        }, z.string().uuid());
      }
      if (input.kind === "pickup" || input.kind === "transit") {
        return api.post("/runtime/logistics/driver/milestone", {
          bookingId: input.bookingId,
          milestone: input.kind === "pickup" ? "picked_up" : "in_transit",
          idempotencyKey,
          metadata: { captured_from: "skima-logistics.driver-workspace" },
        }, z.string().uuid());
      }
      return api.post("/runtime/logistics/bookings/delivery/submit", {
        bookingId: input.bookingId,
        idempotencyKey,
        deliverySubmission: {
          recipientName: input.recipientName?.trim(),
          deliveryNote: input.deliveryNote?.trim() || null,
        },
      }, z.string().uuid());
    },
    onSuccess: async (_result, input) => {
      if (input.kind === "deliver") {
        Alert.alert("Delivery submitted", "The customer can now confirm receipt. Online escrow remains protected until confirmation.");
      } else if (input.kind === "reject") {
        Alert.alert("Assignment declined", "Your company can now choose another eligible driver.");
      } else if (input.kind === "release") {
        Alert.alert("Assignment returned to dispatch", "Your company can now assign another eligible driver. The customer booking and payment remain unchanged.");
      } else if (input.kind === "recover_start") {
        Alert.alert("Cargo recovery started", "Confirm the physical cargo hand-off before marking it in transit. The original incident and delivery history remain attached to this booking.");
      }
      await client.invalidateQueries({ queryKey: ["skima-logistics", "driver-workspace-bookings"] });
      await jobs.refetch();
    },
  });

  const reportIncident = useMutation({
    mutationFn: async (input: {
      bookingId: string;
      incidentType: string;
      severity: string;
      description: string;
      cargoCustodyStatus: string;
    }) => api.post("/runtime/logistics/bookings/incidents/report", {
      ...input,
      locationSnapshot: { captured_from: "skima-logistics.driver-workspace" },
      idempotencyKey: createClientIdempotencyKey(
        "logistics.driver.incident",
        input.bookingId + ":" + input.incidentType + ":" + input.description,
      ),
    }, z.string().uuid()),
    onSuccess: async (_result, input) => {
      setIncidentDescriptions((current) => ({ ...current, [input.bookingId]: "" }));
      await client.invalidateQueries({ queryKey: ["skima-logistics", "driver-workspace-bookings"] });
      await Promise.all([jobs.refetch(), incidentsQuery.refetch()]);
      Alert.alert("Incident reported", "Your company has been notified. Keep the cargo secure and follow dispatch instructions. Customer funds remain protected.");
    },
  });

  const refresh = () => Promise.all([profile.refetch(), jobs.refetch(), incidentsQuery.refetch()]);
  const driverId = asString(profile.data, "driver_profile_id");
  const isVerified = asString(profile.data, "verification_status") === "approved";
  const rows = (jobs.data ?? []) as DriverJob[];

  return (
    <Screen
      eyebrow="DRIVER WORKSPACE"
      title="My delivery jobs"
      subtitle="Accept assigned work, follow the pickup and transit steps, and complete the customer hand-off."
      refreshControl={<RefreshControl refreshing={profile.isRefetching || jobs.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}
    >
      {profile.isPending || jobs.isPending ? (
        <ScreenSkeleton cards={3} />
      ) : profile.error || jobs.error ? (
        <StatePanel
          title="Driver workspace unavailable"
          description="Your Logistics driver profile or assigned jobs could not be loaded."
          retry={() => void refresh()}
        />
      ) : !driverId ? (
        <Card padding="lg">
          <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={22} /></View>
          <Text style={[styles.sectionTitle, { color: palette.ink }]}>No driver profile found</Text>
          <Text style={[styles.meta, { color: palette.muted }]}>Your company administrator must complete your existing SKIMA driver onboarding and approval before assigning Logistics jobs to you.</Text>
        </Card>
      ) : !isVerified ? (
        <Card variant="warning" padding="lg">
          <View style={styles.header}>
            <ShieldCheck color={palette.warning} size={20} />
            <Text style={[styles.sectionTitle, { color: palette.ink }]}>Driver approval is pending</Text>
          </View>
          <Text style={[styles.meta, { color: palette.muted }]}>Your driver profile is registered, but SKIMA must approve it before your company can dispatch live Logistics work to you.</Text>
          <StatusPill status={asString(profile.data, "verification_status") ?? "pending"} />
        </Card>
      ) : (
        <View style={styles.content}>
          <Card variant="brandSoft" padding="lg">
            <View style={styles.profileRow}>
              <View style={[styles.icon, { backgroundColor: palette.surface }]}><UserRound color={palette.brand} size={21} /></View>
              <View style={styles.profileCopy}>
                <Text style={[styles.eyebrow, { color: palette.brand }]}>APPROVED DRIVER</Text>
                <Text style={[styles.profileName, { color: palette.ink }]}>{asString(profile.data, "driver_display_name") ?? "SKIMA Logistics driver"}</Text>
                <Text style={[styles.meta, { color: palette.muted }]}>{asString(profile.data, "public_driver_id") ?? "Verified driver profile"}</Text>
              </View>
              <StatusPill status={asString(profile.data, "operational_status") ?? "available"} />
            </View>
          </Card>

          <SectionHeader
            title="Assigned to you"
            description={rows.length + " " + (rows.length === 1 ? "assignment" : "assignments") + " · Only jobs assigned to your driver profile are shown"}
          />

          {rows.length === 0 ? (
            <Card variant="subtle" padding="lg">
              <View style={styles.empty}>
                <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}><Package color={palette.brand} size={22} /></View>
                <Text style={[styles.sectionTitle, { color: palette.ink }]}>No active assignments</Text>
                <Text style={[styles.meta, { color: palette.muted }]}>When your company assigns a delivery, it will appear here. You must accept the assignment before starting pickup.</Text>
              </View>
            </Card>
          ) : rows.map((job) => {
            const bookingId = asString(job, "booking_id") ?? "";
            const assignment = nested(job, "assignment");
            const vehicle = nested(assignment, "vehicle");
            const assignmentId = asString(assignment, "id") ?? "";
            const status = asString(assignment, "status") ?? "offered";
            const bookingStatus = asString(job, "booking_status") ?? "";
            const assignmentKind = asString(assignment, "assignment_kind") ?? "delivery";
            const bookingOnHold = ["delivery_exception", "failed_delivery", "disputed"].includes(bookingStatus);
            const latestIncident = (incidentsQuery.data ?? [])
              .filter((item) => asString(item, "booking_id") === bookingId)
              .slice(-1)[0] ?? null;
            const isBusy = runAction.isPending && runAction.variables?.bookingId === bookingId;
            const recipientName = recipientNames[bookingId] ?? "";
            const deliveryNote = deliveryNotes[bookingId] ?? "";
            const releaseReason = releaseReasons[bookingId] ?? "";

            return (
              <Card key={bookingId} padding="lg">
                <View style={styles.jobHeader}>
                  <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}><Package color={palette.brand} size={19} /></View>
                  <View style={styles.jobCopy}>
                    <Text style={[styles.jobTitle, { color: palette.ink }]}>{asString(job, "title") ?? "Logistics delivery"}</Text>
                    <Text style={[styles.meta, { color: palette.muted }]}>{bookingId.slice(0, 8).toUpperCase()} · {money(asNumber(job, "delivery_amount"), asString(job, "currency_code") ?? "NGN")}</Text>
                  </View>
                  <StatusPill status={status} />
                </View>

                <View style={[styles.route, { backgroundColor: palette.surfaceSubtle }]}>
                  <View style={styles.routeLine}>
                    <MapPin color={palette.brand} size={14} />
                    <Text style={[styles.routeText, { color: palette.ink }]}>{place(job.pickup_location)}</Text>
                  </View>
                  <View style={styles.routeLine}>
                    <MapPin color={palette.success} size={14} />
                    <Text style={[styles.routeText, { color: palette.ink }]}>{place(job.destination_location)}</Text>
                  </View>
                </View>

                <View style={styles.metaRow}>
                  <Truck color={palette.muted} size={14} />
                  <Text style={[styles.meta, { color: palette.muted }]}>
                    {[asString(vehicle, "vehicle_type"), asString(vehicle, "manufacturer"), asString(vehicle, "model"), asString(vehicle, "registration_number")].filter(Boolean).join(" · ") || "Approved assigned vehicle"}
                  </Text>
                </View>

                {asString(job, "description") ? <Text style={[styles.meta, { color: palette.muted }]}>{asString(job, "description")}</Text> : null}
                {asString(job, "instructions") ? (
                  <View style={[styles.instructions, { backgroundColor: palette.warningSoft }]}>
                    <Text style={[styles.instructionTitle, { color: palette.ink }]}>Customer instructions</Text>
                    <Text style={[styles.meta, { color: palette.ink }]}>{asString(job, "instructions")}</Text>
                  </View>
                ) : null}

                {["in_progress", "picked_up", "in_transit"].includes(status) && !["delivery_exception", "failed_delivery", "disputed"].includes(bookingStatus) ? (
                  <Card variant="warning" padding="md">
                    <Text style={[styles.instructionTitle, { color: palette.ink }]}>Report a delivery incident</Text>
                    <Text style={[styles.meta, { color: palette.muted }]}>
                      Report a breakdown, accident, route problem or cargo issue immediately. Do not abandon cargo or hand it to an unverified person.
                    </Text>
                    <View style={styles.actions}>
                      <View style={styles.incidentChoices}>
                        {[
                          ["vehicle_breakdown", "Vehicle breakdown"],
                          ["accident", "Accident"],
                          ["route_blocked", "Route blocked"],
                          ["security_risk", "Security risk"],
                          ["cargo_damaged", "Cargo damaged"],
                          ["cargo_missing", "Cargo missing"],
                          ["customer_unavailable", "Customer unavailable"],
                          ["other", "Other"],
                        ].map(([value, label]) => {
                          const selected = (incidentTypes[bookingId] ?? "other") === value;
                          return (
                            <Pressable
                              key={value}
                              onPress={() => setIncidentTypes((current) => ({ ...current, [bookingId]: value }))}
                              style={[
                                styles.incidentChoice,
                                {
                                  borderColor: selected ? palette.brand : palette.border,
                                  backgroundColor: selected ? palette.brandSoft : palette.surface,
                                },
                              ]}
                            >
                              <Text style={[styles.meta, { color: selected ? palette.brand : palette.ink }]}>{label}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <View style={styles.incidentChoices}>
                        {["medium", "high", "critical"].map((value) => {
                          const selected = (incidentSeverities[bookingId] ?? "medium") === value;
                          return (
                            <Pressable
                              key={value}
                              onPress={() => setIncidentSeverities((current) => ({ ...current, [bookingId]: value }))}
                              style={[
                                styles.incidentChoice,
                                {
                                  borderColor: selected ? palette.brand : palette.border,
                                  backgroundColor: selected ? palette.brandSoft : palette.surface,
                                },
                              ]}
                            >
                              <Text style={[styles.meta, { color: selected ? palette.brand : palette.ink }]}>{value.toUpperCase()}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <AppField
                        label="What happened?"
                        value={incidentDescriptions[bookingId] ?? ""}
                        onChangeText={(value) => setIncidentDescriptions((current) => ({ ...current, [bookingId]: value }))}
                        placeholder="Explain what happened and where the cargo is now."
                        multiline
                      />
                      <AppButton
                        label="Report incident to dispatch"
                        fullWidth
                        loading={reportIncident.isPending && reportIncident.variables?.bookingId === bookingId}
                        disabled={reportIncident.isPending || (incidentDescriptions[bookingId] ?? "").trim().length < 5}
                        onPress={() => Alert.alert(
                          "Send incident report?",
                          "This will place the delivery on an exception hold. Dispatch will be notified and online escrow will remain protected.",
                          [
                            { text: "Continue delivery", style: "cancel" },
                            {
                              text: "Report incident",
                              style: "destructive",
                              onPress: () => reportIncident.mutate({
                                bookingId,
                                incidentType: incidentTypes[bookingId] ?? "other",
                                severity: incidentSeverities[bookingId] ?? "medium",
                                description: incidentDescriptions[bookingId] ?? "",
                                cargoCustodyStatus: status === "in_progress" ? "not_collected" : "driver_custody",
                              }),
                            },
                          ],
                        )}
                      />
                    </View>
                  </Card>
                ) : null}
                {assignmentKind === "recovery" ? (
                  <View style={[styles.notice, { backgroundColor: palette.brandSoft }]}>
                    <ShieldCheck color={palette.brand} size={17} />
                    <View style={styles.noticeCopy}>
                      <Text style={[styles.instructionTitle, { color: palette.ink }]}>Recovery task</Text>
                      <Text style={[styles.meta, { color: palette.muted }]}>Cargo custody state: {asString(job, "cargo_custody_status")?.replace(/_/g, " ") ?? "recovery pending"}. After the physical recovery hand-off, confirm pickup before marking transit.</Text>
                    </View>
                  </View>
                ) : null}
                {["delivery_exception", "failed_delivery", "disputed"].includes(bookingStatus) ? (
                  <View style={[styles.notice, { backgroundColor: palette.warningSoft }]}>
                    <ShieldCheck color={palette.warning} size={17} />
                    <View style={styles.noticeCopy}>
                      <Text style={[styles.instructionTitle, { color: palette.ink }]}>Delivery exception under review</Text>
                      <Text style={[styles.meta, { color: palette.muted }]}>
                        {(asString(latestIncident, "incident_type") ?? asString(job, "booking_status") ?? "Incident").replace(/_/g, " ")} · {asString(latestIncident, "status") ?? "dispatch review"}
                      </Text>
                      <Text style={[styles.meta, { color: palette.muted }]}>
                        Cargo custody: {asString(latestIncident, "cargo_custody_status")?.replace(/_/g, " ") ?? "awaiting confirmation"}. Keep the cargo secure and remain available to your company.
                      </Text>
                    </View>
                  </View>
                ) : null}
                {status === "incident_hold" ? (
                  <View style={[styles.notice, { backgroundColor: palette.warningSoft }]}>
                    <ShieldCheck color={palette.warning} size={17} />
                    <View style={styles.noticeCopy}>
                      <Text style={[styles.instructionTitle, { color: palette.ink }]}>Dispatch is reviewing an incident</Text>
                      <Text style={[styles.meta, { color: palette.muted }]}>Keep the cargo secure, remain contactable and follow the company recovery instructions. Do not transfer custody without an authorized hand-off.</Text>
                    </View>
                  </View>
                ) : null}
                {["in_progress", "picked_up", "in_transit"].includes(status) && !bookingOnHold ? (
                  <LogisticsDriverLocationShare bookingId={bookingId} />
                ) : null}
                {asString(job, "customer_name") || asString(job, "customer_phone") ? (
                  <View style={styles.customer}>
                    <Text style={[styles.instructionTitle, { color: palette.ink }]}>Customer contact</Text>
                    <Text style={[styles.meta, { color: palette.muted }]}>{asString(job, "customer_name") ?? "Customer"}</Text>
                    {asString(job, "customer_phone") ? (
                      <Pressable style={styles.phoneAction} onPress={() => void Linking.openURL("tel:" + asString(job, "customer_phone"))}>
                        <Phone color={palette.brand} size={14} />
                        <Text style={[styles.phoneText, { color: palette.brand }]}>{asString(job, "customer_phone")}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                {status === "offered" ? (
                  <View style={styles.actions}>
                    <Text style={[styles.meta, { color: palette.muted }]}>
                      {assignmentKind === "recovery"
                        ? "This is a cargo recovery task after a failed delivery. Accept only if you can reach the recorded cargo custody point and safely transfer it."
                        : "Review the cargo, route and vehicle. Accept only if you can fulfil the booking."}
                    </Text>
                    <AppButton label="Accept assignment" fullWidth loading={isBusy} onPress={() => { runAction.mutate({ kind: "accept", bookingId, assignmentId }); }} />
                    <AppButton label="Decline assignment" fullWidth variant="secondary" disabled={runAction.isPending} onPress={() => Alert.alert("Decline this assignment?", "Your company will be able to assign this booking to another eligible driver.", [
                      { text: "Keep assignment", style: "cancel" },
                      { text: "Decline", style: "destructive", onPress: () => runAction.mutate({ kind: "reject", bookingId, assignmentId }) },
                    ])} />
                  </View>
                ) : status === "accepted" && assignmentKind === "recovery" && bookingStatus === "failed_delivery" ? (
                  <View style={styles.actions}>
                    <View style={[styles.notice, { backgroundColor: palette.warningSoft }]}>
                      <ShieldCheck color={palette.warning} size={17} />
                      <View style={styles.noticeCopy}>
                        <Text style={[styles.instructionTitle, { color: palette.ink }]}>Cargo recovery assignment</Text>
                        <Text style={[styles.meta, { color: palette.muted }]}>You are assigned to recover cargo from a failed delivery, not to begin a new customer pickup. Contact dispatch, verify the cargo and hand-off point, then start recovery.</Text>
                      </View>
                    </View>
                    <AppButton label="Start cargo recovery" fullWidth loading={isBusy} onPress={() => runAction.mutate({ kind: "recover_start", bookingId, assignmentId })} />
                  </View>
                ) : status === "accepted" && !bookingOnHold ? (
                  <View style={styles.actions}>
                    <Text style={[styles.meta, { color: palette.muted }]}>Start the job when you are ready to travel to the pickup point. If you cannot start, return it to company dispatch before taking custody of the cargo.</Text>
                    <AppButton label="Start job" fullWidth loading={isBusy} onPress={() => runAction.mutate({ kind: "start", bookingId, assignmentId })} />
                    <AppField
                      label="Reason you cannot start"
                      value={releaseReason}
                      onChangeText={(value) => setReleaseReasons((current) => ({ ...current, [bookingId]: value }))}
                      placeholder="e.g. Vehicle issue or unexpected schedule conflict"
                      multiline
                    />
                    <AppButton
                      label="I can't start this job"
                      fullWidth
                      variant="secondary"
                      disabled={runAction.isPending || releaseReason.trim().length < 5}
                      onPress={() => Alert.alert(
                        "Return this job to dispatch?",
                        "Your reason will be recorded for the company. The booking and customer payment will remain unchanged.",
                        [
                          { text: "Keep assignment", style: "cancel" },
                          { text: "Return to dispatch", style: "destructive", onPress: () => runAction.mutate({ kind: "release", bookingId, assignmentId, reason: releaseReason }) },
                        ],
                      )}
                    />
                  </View>
                ) : status === "in_progress" && !bookingOnHold ? (
                  <View style={styles.actions}>
                    <Text style={[styles.meta, { color: palette.muted }]}>Confirm pickup only after the cargo has been handed over to you.</Text>
                    <AppButton label="Confirm pickup" fullWidth loading={isBusy} onPress={() => runAction.mutate({ kind: "pickup", bookingId, assignmentId })} />
                  </View>
                ) : status === "picked_up" && !bookingOnHold ? (
                  <View style={styles.actions}>
                    <Text style={[styles.meta, { color: palette.muted }]}>Mark the cargo in transit when you leave for the destination.</Text>
                    <AppButton label="Mark in transit" fullWidth loading={isBusy} onPress={() => runAction.mutate({ kind: "transit", bookingId, assignmentId })} />
                  </View>
                ) : status === "in_transit" && !bookingOnHold ? (
                  <View style={styles.actions}>
                    <Text style={[styles.meta, { color: palette.muted }]}>Enter the recipient's name at the destination. The customer will confirm receipt before online escrow is released.</Text>
                    <AppField
                      label="Received by"
                      value={recipientName}
                      onChangeText={(value) => setRecipientNames((current) => ({ ...current, [bookingId]: value }))}
                      placeholder="Name of recipient"
                    />
                    <AppField
                      label="Delivery note"
                      value={deliveryNote}
                      onChangeText={(value) => setDeliveryNotes((current) => ({ ...current, [bookingId]: value }))}
                      placeholder="Condition or hand-off notes"
                      optional
                      multiline
                    />
                    <AppButton
                      label="Submit delivery"
                      fullWidth
                      loading={isBusy}
                      disabled={recipientName.trim().length < 2 || runAction.isPending}
                      onPress={() => runAction.mutate({ kind: "deliver", bookingId, assignmentId, recipientName, deliveryNote })}
                    />
                  </View>
                ) : status === "delivery_submitted" ? (
                  <View style={[styles.notice, { backgroundColor: palette.warningSoft }]}>
                    <Clock3 color={palette.warning} size={17} />
                    <View style={styles.noticeCopy}>
                      <Text style={[styles.instructionTitle, { color: palette.ink }]}>Awaiting customer confirmation</Text>
                      <Text style={[styles.meta, { color: palette.muted }]}>Your hand-off details have been submitted. The booking remains open until the customer confirms receipt.</Text>
                    </View>
                  </View>
                ) : status === "completed" ? (
                  <View style={[styles.notice, { backgroundColor: palette.successSoft }]}>
                    <CheckCircle2 color={palette.success} size={17} />
                    <View style={styles.noticeCopy}>
                      <Text style={[styles.instructionTitle, { color: palette.ink }]}>Job completed</Text>
                      <Text style={[styles.meta, { color: palette.muted }]}>Customer confirmation and settlement are recorded.</Text>
                    </View>
                  </View>
                ) : null}
              </Card>
            );
          })}

          {reportIncident.error ? (
            <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}>
              <Text style={[styles.errorText, { color: palette.danger }]}>
                {reportIncident.error instanceof Error ? reportIncident.error.message : "The incident could not be reported."}
              </Text>
            </View>
          ) : null}
          {runAction.error ? (
            <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}>
              <Text style={[styles.errorText, { color: palette.danger }]}>
                {runAction.error instanceof Error ? runAction.error.message : "The job action could not be completed."}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { ...typography.bodyStrong, fontSize: 13 },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  profileCopy: { flex: 1, minWidth: 0, gap: 2 },
  eyebrow: { ...typography.eyebrow, fontSize: 8 },
  profileName: { ...typography.bodyStrong, fontSize: 13 },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "flex-start", gap: 9 },
  jobHeader: { flexDirection: "row", alignItems: "center", gap: 9 },
  jobCopy: { flex: 1, minWidth: 0, gap: 2 },
  jobTitle: { ...typography.bodyStrong, fontSize: 13 },
  meta: { ...typography.caption, fontSize: 10, lineHeight: 17 },
  route: { borderRadius: radii.lg, padding: 11, gap: 7 },
  routeLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeText: { ...typography.caption, fontSize: 10, flex: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  instructions: { borderRadius: radii.md, padding: 11, gap: 5 },
  customer: { gap: 5 },
  instructionTitle: { ...typography.bodyStrong, fontSize: 11 },
  phoneAction: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 28 },
  phoneText: { ...typography.caption, fontWeight: "900", fontSize: 10 },
  actions: { gap: 9 },
  incidentChoices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  incidentChoice: { borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 9, paddingVertical: 7 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 11, borderRadius: radii.md },
  noticeCopy: { flex: 1, gap: 3 },
  error: { borderRadius: radii.md, padding: 11 },
  errorText: { ...typography.caption, fontSize: 10, lineHeight: 17 },
});
