import { router } from "expo-router";
import {
  ArrowLeft,
  ArrowRight,
  FileCheck2,
  LocateFixed,
  MapPin,
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
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
  useApplicationPayload,
} from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  displayStatus,
  firstNumber,
  firstString,
  nestedRecord,
  recordId,
} from "../api/records";
import { ApplicationProgress } from "../application/ApplicationProgress";
import {
  ApplicationReviewSummary,
} from "../application/ApplicationReviewSummary";
import { ApplicationStatusTimeline } from "../application/ApplicationStatusTimeline";
import { MultiPhotoRequirement } from "../application/MultiPhotoRequirement";
import { PhotoCaptureCard } from "../application/PhotoCaptureCard";
import { RequirementCard } from "../application/RequirementCard";
import { requirementAppliesToPayload } from "../application/requirementApplicability";
import {
  readOperationalLocation,
  type OperationalLocation,
} from "../device/location";
import { useMapsGatewayAdapter } from "../domains/maps/gateway";
import { uploadMedia } from "../media/upload";
import { useSession } from "../session/SessionProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { Card } from "./Card";
import { Screen } from "./Screen";

const STATION_ROLES = [
  { key: "owner", label: "Station Owner" },
  { key: "manager", label: "Station Manager" },
  { key: "employee", label: "Authorized Employee" },
  { key: "representative", label: "Legal Representative" },
];

const DRIVER_DOCUMENT_KEYS = [
  "driver.licence",
  "driver.identity",
  "driver.address-evidence",
] as const;

const STATION_DOCUMENT_KEYS = [
  "station.business-registration",
  "station.business-permit",
  "station.fire-safety-certificate",
  "station.regulatory-certificate",
  "station.settlement-evidence",
  "station.owner-identity",
  "station.authority-evidence",
  "station.representative-identity",
] as const;

const STATION_PHOTO_VIEWS = [
  {
    key: "station.photo.front",
    title: "Front View",
    description: "Clear photo showing the front of the station from the road.",
    isRequired: true,
  },
  {
    key: "station.photo.entrance",
    title: "Main Entrance",
    description: "Main vehicular entry and safety gate area.",
    isRequired: true,
  },
  {
    key: "station.photo.pump",
    title: "LPG Refill & Dispensing Area",
    description: "Dispensing meters, nozzle area, and scale platforms.",
    isRequired: true,
  },
  {
    key: "station.photo.tank",
    title: "Bulk Storage Tanks & Infrastructure",
    description: "LPG storage bullets and safety shut-off infrastructure.",
    isRequired: true,
  },
  {
    key: "station.photo.compound",
    title: "Full Compound Yard View",
    description: "Wide-angle view of the compound and safety perimeter.",
    isRequired: true,
  },
  {
    key: "station.photo.signboard",
    title: "Station Name Signboard",
    description: "Official branded signage with the station name.",
    isRequired: true,
  },
  {
    key: "station.photo.drone",
    title: "Aerial / Drone View (Optional)",
    description: "Optional elevated bird's-eye view of the station layout.",
    isRequired: false,
  },
] as const;

function timestampOf(record: Record<string, unknown>) {
  const value = firstString(record, ["updated_at", "updatedAt", "created_at", "createdAt"]);
  const time = value ? Date.parse(value) : 0;
  return Number.isFinite(time) ? time : 0;
}

export function ApplicationOverviewScreen({
  workspace,
}: {
  workspace: "driver" | "station";
}) {
  const session = useSession();
  const maps = useMapsGatewayAdapter();
  const applications = domainQueries.applications();
  const types = domainQueries.applicationTypes();
  const requirements = domainQueries.documentRequirements();
  const documents = domainQueries.documents();

  const [currentStep, setCurrentStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);

  const [name, setName] = useState(session.context?.profile?.display_name ?? "");
  const [driverDisplayName, setDriverDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [legalOrLicence, setLegalOrLicence] = useState("");
  const [stationRole, setStationRole] = useState("owner");
  const [stationName, setStationName] = useState("");
  const [slug, setSlug] = useState("");
  const [capacity, setCapacity] = useState("5000");
  const [opens, setOpens] = useState("08:00");
  const [closes, setCloses] = useState("18:00");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [lastLocation, setLastLocation] = useState<OperationalLocation | null>(null);

  // A fresh application attempt gets a fresh idempotency scope. Once the draft is
  // created, subsequent saves resolve through currentId instead of this value.
  const draftAttemptKey = useRef(`${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  const category = workspace === "station" ? "business" : "driver";
  const type = useMemo(
    () =>
      (types.data ?? []).find(
        (item) =>
          firstString(item, ["application_category", "applicationCategory"]) === category &&
          firstString(item, ["status"]) === "active",
      ),
    [category, types.data],
  );

  const typeId = type ? recordId(type) : null;

  const current = useMemo(() => {
    const matching = (applications.data ?? [])
      .filter((item) => {
        if (firstString(item, ["application_type_id", "applicationTypeId"]) !== typeId) return false;
        const itemStatus = firstString(item, ["status"]) ?? "";

        // A station owner can register another station after a previous station
        // application has reached a terminal state. An approved driver, however,
        // remains one driver identity and should keep seeing that approved record.
        const terminal = workspace === "station"
          ? ["approved", "rejected", "withdrawn", "expired"]
          : ["rejected", "withdrawn", "expired"];
        return !terminal.includes(itemStatus);
      })
      .sort((a, b) => timestampOf(b) - timestampOf(a));

    return matching[0];
  }, [applications.data, typeId, workspace]);

  const status = current ? (displayStatus(current) ?? "draft") : "draft";
  const operationalStatus = firstString(current, ["operational_status", "operationalStatus"]);
  const currentId = current ? recordId(current) : null;
  const payloadVersions = useApplicationPayload(currentId);

  const requirementSetId = firstString(type, [
    "document_requirement_set_id",
    "documentRequirementSetId",
  ]);

  const appRequirements = useMemo(
    () =>
      (requirements.data ?? []).filter(
        (item) =>
          firstString(item, ["requirement_set_id", "requirementSetId"]) === requirementSetId &&
          firstString(item, ["status"]) === "active",
      ),
    [requirements.data, requirementSetId],
  );

  const appSubmissions = useMemo(
    () =>
      (documents.data ?? []).filter(
        (doc) => firstString(doc, ["application_id", "applicationId"]) === currentId,
      ),
    [documents.data, currentId],
  );

  const createDraft = useGatewayMutation({
    path: "/runtime/applications",
    schema: ActionResponseSchema,
    invalidate: [["applications"]],
  });

  const savePayload = useGatewayMutation({
    path: "/runtime/applications/payload",
    schema: ActionResponseSchema,
    invalidate: [["applications"], ["application-payload", currentId ?? ""]],
  });

  const registerDoc = useGatewayMutation({
    path: "/runtime/documents",
    schema: ActionResponseSchema,
    invalidate: [["documents"], ["applications"]],
  });

  const submitApp = useGatewayMutation({
    path: "/runtime/applications/submit",
    schema: ActionResponseSchema,
    invalidate: [["applications"]],
  });

  const hydratedApplication = useRef<string | null>(null);
  useEffect(() => {
    if (!currentId || hydratedApplication.current === currentId) return;
    const version = payloadVersions.data?.[0];
    const payload = nestedRecord(version, "payload") ?? version;
    if (!payload) return;

    const contact = nestedRecord(payload, "contact");
    const identity = nestedRecord(payload, "identity");
    const licence = nestedRecord(payload, "licence");
    const organization = nestedRecord(payload, "organization");
    const authority = nestedRecord(payload, "authority");
    const station = nestedRecord(payload, "station");
    const storedLocation = nestedRecord(payload, "location") ?? nestedRecord(station, "location");

    setName(
      firstString(identity, ["fullName", "full_name"]) ??
        firstString(authority, ["fullName", "full_name"]) ??
        firstString(organization, ["displayName", "display_name"]) ??
        name,
    );
    setPhone(firstString(contact, ["phone"]) ?? phone);
    setDriverDisplayName(
      firstString(identity, ["driverDisplayName", "driver_display_name"]) ?? driverDisplayName,
    );
    setAddress(
      firstString(identity, ["address"]) ??
        firstString(station, ["formattedAddress", "formatted_address"]) ??
        address,
    );
    setLegalOrLicence(
      firstString(licence, ["number"]) ??
        firstString(organization, ["legalName", "legal_name"]) ??
        legalOrLicence,
    );
    setStationRole(firstString(authority, ["role"]) ?? stationRole);
    setStationName(
      firstString(station, ["displayName", "display_name"]) ??
        firstString(organization, ["displayName", "display_name"]) ??
        stationName,
    );
    setSlug(firstString(organization, ["slug"]) ?? slug);

    const storedLat =
      firstNumber(station, ["latitude", "lat"]) ??
      firstNumber(storedLocation, ["latitude", "lat"]);
    const storedLng =
      firstNumber(station, ["longitude", "lng", "lon"]) ??
      firstNumber(storedLocation, ["longitude", "lng", "lon"]);
    if (storedLat !== null) setLatitude(storedLat);
    if (storedLng !== null) setLongitude(storedLng);

    if (storedLocation && storedLat !== null && storedLng !== null) {
      setLastLocation(storedLocation as unknown as OperationalLocation);
    }

    hydratedApplication.current = currentId;
  }, [currentId, payloadVersions.data]);

  const buildPayload = () => {
    if (workspace === "driver") {
      return {
        identity: {
          fullName: name.trim(),
          driverDisplayName: driverDisplayName.trim() || name.trim(),
          address: address.trim(),
        },
        contact: { phone: phone.trim() },
        licence: { number: legalOrLicence.trim() },
      };
    }

    return {
      organization: {
        displayName: stationName.trim() || name.trim(),
        legalName: legalOrLicence.trim() || stationName.trim(),
        slug:
          slug.trim() ||
          stationName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      },
      authority: {
        role: stationRole,
        fullName: name.trim(),
      },
      contact: { phone: phone.trim() },
      station: {
        displayName: stationName.trim(),
        formattedAddress: address.trim(),
        latitude,
        longitude,
        refillCapacityKg: Number(capacity) || 5000,
        operatingHours: { opensAt: opens, closesAt: closes },
      },
      location: lastLocation,
    };
  };

  const ensureApplicationId = async (): Promise<string> => {
    if (currentId) return currentId;

    const typeKey =
      firstString(type, ["key"]) ??
      (workspace === "station" ? "application.lpg.station" : "application.lpg.driver");
    const userId = session.context?.user.id;
    if (!userId) throw new Error("Please sign in again before starting the application.");

    const result = await createDraft.mutateAsync({
      applicationTypeKey: typeKey,
      applicantUserId: userId,
      payload: buildPayload(),
      source: "skima.lpg.mobile",
      idempotencyKey: idempotencyKey(
        "app-draft-init",
        `${userId}:${workspace}:${draftAttemptKey.current}`,
      ),
    });

    const response =
      typeof result === "object" && result !== null
        ? (result as Record<string, unknown>)
        : null;
    const nestedData =
      typeof response?.data === "object" && response.data !== null
        ? (response.data as Record<string, unknown>)
        : null;
    const resultId =
      firstString(response, ["id", "application_id", "applicationId"]) ??
      firstString(nestedData, ["id", "application_id", "applicationId"]);

    await applications.refetch();
    if (!resultId) throw new Error("Application draft was created but its ID was not returned.");
    return resultId;
  };

  const handleUploadRequirement = async (
    reqKey: string,
    file: { uri: string; name: string; mimeType: string },
  ) => {
    const userId = session.context?.user.id;
    if (!userId) return;

    setError(null);
    try {
      const appId = await ensureApplicationId();
      const mediaAssetId = await uploadMedia({
        api: session.api,
        uri: file.uri,
        fileName: file.name,
        contentType: file.mimeType,
        ownerUserId: userId,
        assetTypeKey: `media.${reqKey}`,
      });

      await registerDoc.mutateAsync({
        applicationId: appId,
        requirementKey: reqKey,
        storageBucket: "applications",
        storagePath: `docs/${appId}/${reqKey}/${Date.now()}`,
        contentType: file.mimeType,
        source: "skima.lpg.mobile",
        metadata: { mediaAssetId },
        idempotencyKey: idempotencyKey("doc-upload", `${appId}:${reqKey}:${Date.now()}`),
      });

      await documents.refetch();
    } catch (cause) {
      const message = friendlyError(cause, "Upload could not be saved. Please try again.");
      setError(message);
      throw cause;
    }
  };

  const detectLocation = async () => {
    setDetectingLocation(true);
    setError(null);
    try {
      const loc = await maps.resolveOperationalLocation(await readOperationalLocation());
      setLastLocation(loc);
      setLatitude(loc.latitude);
      setLongitude(loc.longitude);
      if (loc.formattedAddress && (!address || address === "Selected map location")) {
        setAddress(loc.formattedAddress);
      }
    } catch (cause) {
      setError(
        friendlyError(cause, "Could not detect GPS location. Please enter your address."),
      );
    } finally {
      setDetectingLocation(false);
    }
  };

  const persistDraft = async (): Promise<boolean> => {
    setError(null);
    try {
      const appId = await ensureApplicationId();
      await savePayload.mutateAsync({
        applicationId: appId,
        payload: buildPayload(),
        idempotencyKey: idempotencyKey("app-payload-save", `${appId}:${Date.now()}`),
      });
      return true;
    } catch (cause) {
      setError(friendlyError(cause, "Your application draft could not be saved. Please try again."));
      return false;
    }
  };

  const handleNextStep = async () => {
    if (await persistDraft()) {
      setCurrentStep((previous) => Math.min(totalSteps, previous + 1));
    }
  };

  const handlePrevStep = () => {
    setError(null);
    setCurrentStep((previous) => Math.max(1, previous - 1));
  };

  const handleSaveAndExit = async () => {
    if (await persistDraft()) router.back();
  };

  const handleSubmitApplication = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const appId = await ensureApplicationId();
      const saved = await persistDraft();
      if (!saved) return;

      await submitApp.mutateAsync({
        applicationId: appId,
        idempotencyKey: idempotencyKey("app-submit", appId),
      });
      await applications.refetch();
      await session.refresh();
    } catch (cause) {
      setError(
        friendlyError(
          cause,
          "Application could not be submitted. Open any missing requirement and complete it first.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const getSubForReq = (reqKey: string) => {
    return appSubmissions.find((submission) => {
      const submissionKey = firstString(submission, ["requirement_key", "requirementKey"]);
      const submissionRequirementId = firstString(submission, ["requirement_id", "requirementId"]);
      const targetRequirement = appRequirements.find(
        (requirement) => firstString(requirement, ["key"]) === reqKey,
      );
      return (
        submissionKey === reqKey ||
        Boolean(targetRequirement && submissionRequirementId === recordId(targetRequirement))
      );
    });
  };

  const driverTotalSteps = 4;
  const stationTotalSteps = 5;
  const totalSteps = workspace === "driver" ? driverTotalSteps : stationTotalSteps;

  const currentPayload = buildPayload();
  const applicableRequirements = appRequirements.filter((requirement) =>
    requirementAppliesToPayload(requirement, currentPayload),
  );

  const missingRequiredDocs = applicableRequirements.filter((requirement) => {
    if (requirement.is_required === false) return false;
    const key = firstString(requirement, ["key"]) ?? "";
    const submission = getSubForReq(key);
    const submissionStatus = firstString(submission, ["status"]);
    return !submission || submissionStatus === "rejected";
  });

  const requiredApplicableCount = applicableRequirements.filter(
    (requirement) => requirement.is_required !== false,
  ).length;
  const readyRequiredCount = Math.max(0, requiredApplicableCount - missingRequiredDocs.length);
  const readinessPercent = requiredApplicableCount
    ? Math.round((readyRequiredCount / requiredApplicableCount) * 100)
    : 100;
  const canSubmit = missingRequiredDocs.length === 0;

  const isPostSubmission = Boolean(
    current &&
      [
        "submitted",
        "under_review",
        "approved",
        "changes_requested",
        "additional_info_required",
        "rejected",
      ].includes(status),
  );

  if (applications.isPending || types.isPending || requirements.isPending) {
    return (
      <Screen eyebrow={`${workspace} application`} title="Application">
        <ActivityIndicator color={colors.brand} />
      </Screen>
    );
  }

  if (isPostSubmission) {
    return (
      <Screen
        eyebrow={`${workspace} partner`}
        title="Application Status"
        action={
          <Pressable onPress={() => router.back()}>
            <Text style={styles.link}>Back</Text>
          </Pressable>
        }
      >
        <ApplicationStatusTimeline
          applicationStatus={status}
          operationalStatus={operationalStatus}
          applicantMessage={firstString(current, [
            "decision_reason",
            "decisionReason",
            "applicant_message",
          ])}
          submittedAt={firstString(current, ["submitted_at", "submittedAt", "created_at"])}
          decidedAt={firstString(current, ["decided_at", "decidedAt"])}
          activatedAt={firstString(current, ["activated_at", "activatedAt"])}
          onFixRequestedChanges={() => setCurrentStep(3)}
        />
      </Screen>
    );
  }

  const reviewDocuments = applicableRequirements.map((requirement) => {
    const key = firstString(requirement, ["key"]) ?? "";
    const submission = getSubForReq(key);
    return {
      title: firstString(requirement, ["display_name", "displayName"]) ?? key,
      isRequired: requirement.is_required !== false,
      isUploaded: Boolean(submission && firstString(submission, ["status"]) !== "rejected"),
      status: firstString(submission, ["status"]) ?? "pending",
      stepIndex:
        workspace === "driver"
          ? key === "driver.profile-photo"
            ? 2
            : 3
          : key.startsWith("station.photo.")
            ? 4
            : key === "station.representative-photo"
              ? 1
              : 3,
    };
  });

  return (
    <Screen
      eyebrow={`${workspace} onboarding`}
      title={workspace === "driver" ? "Driver Application" : "Station Application"}
      action={
        <Pressable onPress={() => void handleSaveAndExit()}>
          <Text style={styles.link}>Save & Exit</Text>
        </Pressable>
      }
    >
      <ApplicationProgress
        currentStep={currentStep}
        totalSteps={totalSteps}
        completionPercent={currentStep === totalSteps ? readinessPercent : undefined}
        completionLabel={
          currentStep === totalSteps
            ? `${readyRequiredCount}/${requiredApplicableCount} required items ready`
            : undefined
        }
        stepTitle={
          workspace === "driver"
            ? currentStep === 1
              ? "Personal Information"
              : currentStep === 2
                ? "Driver Photograph"
                : currentStep === 3
                  ? "Driver Documents"
                  : "Review & Submit"
            : currentStep === 1
              ? "Representative & Role"
              : currentStep === 2
                ? "Station & Location"
                : currentStep === 3
                  ? "Required Certificates"
                  : currentStep === 4
                    ? "Station Premises Photos"
                    : "Review & Submit"
        }
      />

      {workspace === "driver" ? (
        <>
          {currentStep === 1 ? (
            <Card>
              <Text style={styles.sectionHeader}>Personal Details</Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Full Legal Name *</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Samuel Adeleke"
                  style={styles.input}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Driver Display Name</Text>
                <TextInput
                  value={driverDisplayName}
                  onChangeText={setDriverDisplayName}
                  placeholder="e.g. Sam A."
                  style={styles.input}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Phone Number *</Text>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  placeholder="e.g. 08012345678"
                  style={styles.input}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Residential Address *</Text>
                <TextInput
                  value={address}
                  onChangeText={setAddress}
                  multiline
                  placeholder="e.g. 14 Gas Way, Ikeja, Lagos"
                  style={[styles.input, styles.textArea]}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Driver Licence Number *</Text>
                <TextInput
                  value={legalOrLicence}
                  onChangeText={setLegalOrLicence}
                  placeholder="e.g. ABC123456789"
                  style={styles.input}
                />
              </View>
            </Card>
          ) : null}

          {currentStep === 2 ? (
            <View>
              {(() => {
                const submission = getSubForReq("driver.profile-photo");
                const mediaUrl = firstString(submission, ["storage_path", "mediaUrl"]);
                return (
                  <PhotoCaptureCard
                    title="Driver Photograph"
                    subtitle="Take a clear portrait photo showing your full face."
                    photoUrl={mediaUrl}
                    guidanceText="Ensure your face is well-lit, looking directly at the camera with no sunglasses or face coverings."
                    onPhotoSelected={(file) => handleUploadRequirement("driver.profile-photo", file)}
                  />
                );
              })()}
            </View>
          ) : null}

          {currentStep === 3 ? (
            <View>
              {DRIVER_DOCUMENT_KEYS.map((reqKey) => {
                const requirement = appRequirements.find(
                  (item) => firstString(item, ["key"]) === reqKey,
                );
                const submission = getSubForReq(reqKey);
                return (
                  <RequirementCard
                    key={reqKey}
                    requirementKey={reqKey}
                    title={firstString(requirement, ["display_name", "displayName"]) ?? reqKey}
                    description={
                      firstString(requirement, ["description"]) ?? "Upload a clear, valid document."
                    }
                    isRequired={requirement?.is_required !== false}
                    allowedContentTypes={
                      Array.isArray(requirement?.allowed_content_types)
                        ? (requirement.allowed_content_types as string[])
                        : undefined
                    }
                    uploadedDocument={
                      submission
                        ? {
                            id: recordId(submission) ?? "",
                            status: firstString(submission, ["status"]) ?? "submitted",
                            replacementRequested: Boolean(submission.replacement_requested),
                            replacementReason: firstString(submission, [
                              "replacement_reason",
                              "decision_reason",
                            ]),
                          }
                        : null
                    }
                    onUploadFile={(file) => handleUploadRequirement(reqKey, file)}
                  />
                );
              })}
            </View>
          ) : null}

          {currentStep === 4 ? (
            <ApplicationReviewSummary
              sections={[
                {
                  title: "Personal Information",
                  stepIndex: 1,
                  items: [
                    { label: "Full Name", value: name },
                    { label: "Phone", value: phone },
                    { label: "Licence Number", value: legalOrLicence },
                    { label: "Address", value: address },
                  ],
                },
              ]}
              documents={reviewDocuments}
              onGoToStep={setCurrentStep}
              canSubmit={canSubmit}
              missingItemsCount={missingRequiredDocs.length}
            />
          ) : null}
        </>
      ) : (
        <>
          {currentStep === 1 ? (
            <Card>
              <Text style={styles.sectionHeader}>Representative Details</Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Representative Full Name *</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. Chief Ibrahim Danladi"
                  style={styles.input}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Representative Role in Business *</Text>
                <View style={styles.roleChips}>
                  {STATION_ROLES.map((role) => (
                    <Pressable
                      key={role.key}
                      onPress={() => setStationRole(role.key)}
                      style={[
                        styles.roleChip,
                        stationRole === role.key && styles.roleChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.roleChipText,
                          stationRole === role.key && styles.roleChipTextActive,
                        ]}
                      >
                        {role.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {stationRole !== "owner" ? (
                  <Text style={styles.helperText}>
                    Because you are applying on behalf of the owner, proof of authority and your government ID will be required in the certificates step.
                  </Text>
                ) : null}
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Phone Number *</Text>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  placeholder="e.g. 08033334444"
                  style={styles.input}
                />
              </View>

              {(() => {
                const submission = getSubForReq("station.representative-photo");
                const mediaUrl = firstString(submission, ["storage_path", "mediaUrl"]);
                return (
                  <PhotoCaptureCard
                    title="Representative Photo (Private)"
                    subtitle="Take a clear face photo of the representative applying for this station."
                    photoUrl={mediaUrl}
                    guidanceText="Kept private and used only to verify your identity."
                    onPhotoSelected={(file) =>
                      handleUploadRequirement("station.representative-photo", file)
                    }
                  />
                );
              })()}
            </Card>
          ) : null}

          {currentStep === 2 ? (
            <Card>
              <Text style={styles.sectionHeader}>Station Facility Details</Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>LPG Station Name *</Text>
                <TextInput
                  value={stationName}
                  onChangeText={setStationName}
                  placeholder="e.g. TotalEnergies LPG Plant Victoria Island"
                  style={styles.input}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Physical Address *</Text>
                <TextInput
                  value={address}
                  onChangeText={setAddress}
                  multiline
                  placeholder="e.g. Plot 104, Ozumba Mbadiwe Ave, Victoria Island, Lagos"
                  style={[styles.input, styles.textArea]}
                />
              </View>

              <Pressable
                disabled={detectingLocation}
                onPress={() => void detectLocation()}
                style={styles.locationBtn}
              >
                {detectingLocation ? (
                  <ActivityIndicator color={colors.brand} />
                ) : (
                  <>
                    <LocateFixed color={colors.brand} size={18} />
                    <Text style={styles.locationBtnText}>
                      {latitude !== null
                        ? "Update Current GPS Location"
                        : "Capture Station GPS Location"}
                    </Text>
                  </>
                )}
              </Pressable>

              {latitude !== null && longitude !== null ? (
                <View style={styles.coordBox}>
                  <MapPin color={colors.success} size={16} />
                  <View style={styles.coordCopy}>
                    <Text style={styles.coordTitle}>
                      {address || lastLocation?.formattedAddress || "Station location captured"}
                    </Text>
                    <Text style={styles.coordText}>
                      {latitude.toFixed(6)}, {longitude.toFixed(6)}
                    </Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Station Refill Storage Capacity (kg)</Text>
                <TextInput
                  value={capacity}
                  onChangeText={setCapacity}
                  keyboardType="numeric"
                  placeholder="e.g. 5000"
                  style={styles.input}
                />
              </View>
            </Card>
          ) : null}

          {currentStep === 3 ? (
            <View>
              {STATION_DOCUMENT_KEYS.filter((reqKey) =>
                applicableRequirements.some(
                  (requirement) => firstString(requirement, ["key"]) === reqKey,
                ),
              ).map((reqKey) => {
                const requirement = appRequirements.find(
                  (item) => firstString(item, ["key"]) === reqKey,
                );
                const submission = getSubForReq(reqKey);
                return (
                  <RequirementCard
                    key={reqKey}
                    requirementKey={reqKey}
                    title={firstString(requirement, ["display_name", "displayName"]) ?? reqKey}
                    description={
                      firstString(requirement, ["description"]) ?? "Upload the required official document."
                    }
                    isRequired={requirement?.is_required !== false}
                    allowedContentTypes={
                      Array.isArray(requirement?.allowed_content_types)
                        ? (requirement.allowed_content_types as string[])
                        : undefined
                    }
                    uploadedDocument={
                      submission
                        ? {
                            id: recordId(submission) ?? "",
                            status: firstString(submission, ["status"]) ?? "submitted",
                            replacementRequested: Boolean(submission.replacement_requested),
                            replacementReason: firstString(submission, [
                              "replacement_reason",
                              "decision_reason",
                            ]),
                          }
                        : null
                    }
                    onUploadFile={(file) => handleUploadRequirement(reqKey, file)}
                  />
                );
              })}
            </View>
          ) : null}

          {currentStep === 4 ? (
            <View>
              <MultiPhotoRequirement
                views={STATION_PHOTO_VIEWS.map((view) => ({
                  ...view,
                  uploadedUrl: firstString(getSubForReq(view.key), ["storage_path", "mediaUrl"]),
                  replacementReason: firstString(getSubForReq(view.key), ["replacement_reason"]),
                }))}
                onUploadView={(viewKey, file) => handleUploadRequirement(viewKey, file)}
              />
            </View>
          ) : null}

          {currentStep === 5 ? (
            <ApplicationReviewSummary
              sections={[
                {
                  title: "Station & Representative",
                  stepIndex: 1,
                  items: [
                    { label: "Station Name", value: stationName },
                    { label: "Representative", value: name },
                    {
                      label: "Role",
                      value: STATION_ROLES.find((role) => role.key === stationRole)?.label ?? stationRole,
                    },
                    { label: "Phone", value: phone },
                    { label: "Address", value: address },
                    { label: "Capacity", value: `${capacity} kg` },
                  ],
                },
              ]}
              documents={reviewDocuments}
              onGoToStep={setCurrentStep}
              canSubmit={canSubmit}
              missingItemsCount={missingRequiredDocs.length}
            />
          ) : null}
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footerRow}>
        {currentStep > 1 ? (
          <Pressable onPress={handlePrevStep} style={styles.prevBtn}>
            <ArrowLeft color={colors.ink} size={16} />
            <Text style={styles.prevBtnText}>Previous</Text>
          </Pressable>
        ) : (
          <View style={{ flex: 1 }} />
        )}

        {currentStep < totalSteps ? (
          <Pressable onPress={() => void handleNextStep()} style={styles.nextBtn}>
            <Text style={styles.nextBtnText}>Save & Continue</Text>
            <ArrowRight color="white" size={16} />
          </Pressable>
        ) : (
          <Pressable
            disabled={!canSubmit || submitting}
            onPress={() => void handleSubmitApplication()}
            style={[styles.submitBtn, (!canSubmit || submitting) && styles.btnDisabled]}
          >
            {submitting ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <>
                <FileCheck2 color="white" size={18} />
                <Text style={styles.submitBtnText}>Submit Application</Text>
              </>
            )}
          </Pressable>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: { color: colors.brand, fontWeight: "800", fontSize: 13 },
  sectionHeader: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  fieldGroup: { gap: 6, marginBottom: spacing.md },
  fieldLabel: { fontSize: 13, fontWeight: "800", color: colors.ink },
  helperText: { fontSize: 12, lineHeight: 17, color: colors.muted, fontWeight: "600" },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    backgroundColor: colors.surface,
    color: colors.ink,
  },
  textArea: {
    minHeight: 80,
    paddingVertical: spacing.sm,
    textAlignVertical: "top",
  },
  roleChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  roleChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  roleChipActive: {
    borderColor: colors.brand,
    backgroundColor: "#FFF0F1",
  },
  roleChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.muted,
  },
  roleChipTextActive: {
    color: colors.brand,
    fontWeight: "800",
  },
  locationBtn: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radii.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#FFF0F1",
    marginBottom: spacing.md,
  },
  locationBtnText: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: "800",
  },
  coordBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#F0FDF4",
    padding: spacing.sm,
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  coordCopy: { flex: 1, gap: 2 },
  coordTitle: { fontSize: 12, fontWeight: "800", color: colors.ink },
  coordText: { fontSize: 11, fontWeight: "700", color: colors.success },
  footerRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  prevBtn: {
    flex: 1,
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.surface,
  },
  prevBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.ink,
  },
  nextBtn: {
    flex: 2,
    minHeight: 52,
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  nextBtnText: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
  },
  submitBtn: {
    flex: 2,
    minHeight: 52,
    backgroundColor: colors.success,
    borderRadius: radii.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  submitBtnText: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
  },
  btnDisabled: { opacity: 0.5 },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
