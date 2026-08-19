import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  FileCheck2,
  LocateFixed,
  MapPin,
  ShieldCheck,
  Truck,
  Upload,
  User,
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  domainQueries,
  useApplicationPayload,
  useLpgConfig,
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
import {
  ApplicationProgress,
} from "../application/ApplicationProgress";
import {
  ApplicationReviewSummary,
  SummaryDocument,
  SummarySection,
} from "../application/ApplicationReviewSummary";
import {
  ApplicationStatusTimeline,
} from "../application/ApplicationStatusTimeline";
import {
  MultiPhotoRequirement,
  StationPhotoView,
} from "../application/MultiPhotoRequirement";
import { PhotoCaptureCard } from "../application/PhotoCaptureCard";
import { RequirementCard } from "../application/RequirementCard";
import {
  readOperationalLocation,
  type OperationalLocation,
} from "../device/location";
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

export function ApplicationOverviewScreen({
  workspace,
}: {
  workspace: "driver" | "station";
}) {
  const session = useSession();
  const applications = domainQueries.applications();
  const types = domainQueries.applicationTypes();
  const requirements = domainQueries.documentRequirements();
  const documents = domainQueries.documents();
  const config = useLpgConfig();
  const client = useQueryClient();

  const [currentStep, setCurrentStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);

  // Form Fields
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

  const category = workspace === "station" ? "business" : "driver";
  const type = useMemo(
    () =>
      (types.data ?? []).find(
        (item) =>
          firstString(item, ["application_category", "applicationCategory"]) ===
            category && firstString(item, ["status"]) === "active",
      ),
    [category, types.data],
  );

  const typeId = type ? recordId(type) : null;
  const current = (applications.data ?? []).find(
    (item) =>
      firstString(item, ["application_type_id", "applicationTypeId"]) === typeId &&
      !["withdrawn", "expired"].includes(firstString(item, ["status"]) ?? ""),
  );

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
          firstString(item, ["requirement_set_id", "requirementSetId"]) ===
            requirementSetId && firstString(item, ["status"]) === "active",
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

  // Mutations
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

  // Hydrate from existing application payload
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

    setName(firstString(identity, ["fullName", "full_name"]) ?? firstString(organization, ["displayName", "display_name"]) ?? name);
    setPhone(firstString(contact, ["phone"]) ?? phone);
    setDriverDisplayName(firstString(identity, ["driverDisplayName", "driver_display_name"]) ?? driverDisplayName);
    setAddress(firstString(identity, ["address"]) ?? firstString(station, ["formattedAddress", "formatted_address"]) ?? address);
    setLegalOrLicence(firstString(licence, ["number"]) ?? firstString(organization, ["legalName", "legal_name"]) ?? legalOrLicence);
    setStationRole(firstString(authority, ["role"]) ?? stationRole);
    setStationName(firstString(station, ["displayName", "display_name"]) ?? firstString(organization, ["displayName", "display_name"]) ?? stationName);
    setSlug(firstString(organization, ["slug"]) ?? slug);
    const storedLat = firstNumber(station, ["latitude", "lat"]) ?? firstNumber(storedLocation, ["latitude", "lat"]);
    const storedLng = firstNumber(station, ["longitude", "lng", "lon"]) ?? firstNumber(storedLocation, ["longitude", "lng", "lon"]);
    if (storedLat !== null) setLatitude(storedLat);
    if (storedLng !== null) setLongitude(storedLng);

    hydratedApplication.current = currentId;
  }, [currentId, payloadVersions.data]);

  // Ensure application record exists before uploading
  const ensureApplicationId = async (): Promise<string> => {
    if (currentId) return currentId;
    const typeKey = firstString(type, ["key"]) ?? (workspace === "station" ? "application.lpg.station" : "application.lpg.driver");
    const result = await createDraft.mutateAsync({
      applicationTypeKey: typeKey,
      applicantUserId: session.context?.user.id,
      payload: buildPayload(),
      source: "skima.lpg.mobile",
      idempotencyKey: idempotencyKey("app-draft-init", `${session.context?.user.id}:${workspace}`),
    });
    const resObj = typeof result === "object" && result !== null ? (result as Record<string, unknown>) : null;
    const nestedData = typeof resObj?.data === "object" && resObj.data !== null ? (resObj.data as Record<string, unknown>) : null;
    const resId = firstString(resObj, ["id", "application_id", "applicationId"]) ??
      firstString(nestedData, ["id", "application_id", "applicationId"]);
    await applications.refetch();
    return resId ?? "";
  };

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
        slug: slug.trim() || stationName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
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

  const handleUploadRequirement = async (
    reqKey: string,
    file: { uri: string; name: string; mimeType: string },
  ) => {
    if (!session.context?.user.id) return;
    const appId = await ensureApplicationId();
    const mediaAssetId = await uploadMedia({
      api: session.api,
      uri: file.uri,
      fileName: file.name,
      contentType: file.mimeType,
      ownerUserId: session.context.user.id,
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
  };

  const detectLocation = async () => {
    setDetectingLocation(true);
    setError(null);
    try {
      const loc = await readOperationalLocation();
      setLastLocation(loc);
      setLatitude(loc.latitude);
      setLongitude(loc.longitude);
      if (loc.formattedAddress && !address) {
        setAddress(loc.formattedAddress);
      }
    } catch (cause) {
      setError(friendlyError(cause, "Could not detect GPS location. Please enter your address."));
    } finally {
      setDetectingLocation(false);
    }
  };

  const persistDraft = async () => {
    try {
      const appId = await ensureApplicationId();
      await savePayload.mutateAsync({
        applicationId: appId,
        payload: buildPayload(),
        idempotencyKey: idempotencyKey("app-payload-save", `${appId}:${Date.now()}`),
      });
    } catch (cause) {
      // Background save error
    }
  };

  const handleNextStep = async () => {
    setError(null);
    await persistDraft();
    setCurrentStep((prev) => prev + 1);
  };

  const handlePrevStep = () => {
    setError(null);
    setCurrentStep((prev) => Math.max(1, prev - 1));
  };

  const handleSubmitApplication = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const appId = await ensureApplicationId();
      await persistDraft();
      await submitApp.mutateAsync({
        applicationId: appId,
        idempotencyKey: idempotencyKey("app-submit", appId),
      });
      await applications.refetch();
      await session.refresh();
    } catch (cause) {
      setError(friendlyError(cause, "Application could not be submitted. Please check missing items."));
    } finally {
      setSubmitting(false);
    }
  };

  // Helper to find submission for requirement
  const getSubForReq = (reqKey: string) => {
    return appSubmissions.find((sub) => {
      const subKey = firstString(sub, ["requirement_key", "requirementKey"]);
      const subReqId = firstString(sub, ["requirement_id", "requirementId"]);
      const targetReq = appRequirements.find((r) => firstString(r, ["key"]) === reqKey);
      return subKey === reqKey || (targetReq && subReqId === recordId(targetReq));
    });
  };

  // Step definitions
  const driverTotalSteps = 4;
  const stationTotalSteps = 5;
  const totalSteps = workspace === "driver" ? driverTotalSteps : stationTotalSteps;

  // Review summaries
  const missingRequiredDocs = appRequirements.filter((req) => {
    if (!req.is_required) return false;
    const key = firstString(req, ["key"]) ?? "";
    const sub = getSubForReq(key);
    return !sub || firstString(sub, ["status"]) === "rejected";
  });

  const canSubmit = missingRequiredDocs.length === 0;

  // Post-submission view (Submitted, Under Review, Approved, Changes Requested, Rejected)
  const isPostSubmission = current && ["submitted", "under_review", "approved", "changes_requested", "rejected"].includes(status);

  if (applications.isPending || types.isPending) {
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
          applicantMessage={firstString(current, ["decision_reason", "decisionReason", "applicant_message"])}
          submittedAt={firstString(current, ["submitted_at", "submittedAt", "created_at"])}
          decidedAt={firstString(current, ["decided_at", "decidedAt"])}
          activatedAt={firstString(current, ["activated_at", "activatedAt"])}
          onFixRequestedChanges={() => setCurrentStep(workspace === "driver" ? 3 : 3)}
        />
      </Screen>
    );
  }

  // Multi-Step Onboarding Form
  return (
    <Screen
      eyebrow={`${workspace} onboarding`}
      title={workspace === "driver" ? "Driver Application" : "Station Application"}
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Save & Exit</Text>
        </Pressable>
      }
    >
      <ApplicationProgress
        currentStep={currentStep}
        totalSteps={totalSteps}
        stepTitle={
          workspace === "driver"
            ? currentStep === 1
              ? "Personal Information"
              : currentStep === 2
              ? "Driver Photograph"
              : currentStep === 3
              ? "Driver Verification Documents"
              : "Review & Submit"
            : currentStep === 1
            ? "Representative & Role"
            : currentStep === 2
            ? "Station & Location"
            : currentStep === 3
            ? "Statutory Certificates"
            : currentStep === 4
            ? "Station Premises Photos"
            : "Review & Submit"
        }
      />

      {/* DRIVER STAGES */}
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
                const sub = getSubForReq("driver.profile-photo");
                const mediaUrl = firstString(sub, ["storage_path", "mediaUrl"]);
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
              {["driver.licence", "driver.identity", "driver.address-evidence"].map((reqKey) => {
                const req = appRequirements.find((r) => firstString(r, ["key"]) === reqKey);
                const sub = getSubForReq(reqKey);
                return (
                  <RequirementCard
                    key={reqKey}
                    requirementKey={reqKey}
                    title={firstString(req, ["display_name", "displayName"]) ?? reqKey}
                    description={firstString(req, ["description"]) ?? "Upload valid evidence document."}
                    isRequired={req?.is_required !== false}
                    allowedContentTypes={Array.isArray(req?.allowed_content_types) ? (req.allowed_content_types as string[]) : undefined}
                    uploadedDocument={
                      sub
                        ? {
                            id: recordId(sub) ?? "",
                            status: firstString(sub, ["status"]) ?? "submitted",
                            replacementRequested: Boolean(sub.replacement_requested),
                            replacementReason: firstString(sub, ["replacement_reason", "decision_reason"]),
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
              documents={appRequirements.map((req) => {
                const key = firstString(req, ["key"]) ?? "";
                const sub = getSubForReq(key);
                return {
                  title: firstString(req, ["display_name", "displayName"]) ?? key,
                  isRequired: req.is_required !== false,
                  isUploaded: Boolean(sub && firstString(sub, ["status"]) !== "rejected"),
                  status: firstString(sub, ["status"]) ?? "pending",
                  stepIndex: key === "driver.profile-photo" ? 2 : 3,
                };
              })}
              onGoToStep={(step) => setCurrentStep(step)}
              canSubmit={canSubmit}
              missingItemsCount={missingRequiredDocs.length}
            />
          ) : null}
        </>
      ) : (
        /* STATION STAGES */
        <>
          {currentStep === 1 ? (
            <Card>
              <Text style={styles.sectionHeader}>Station Representative KYC</Text>
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
                  {STATION_ROLES.map((r) => (
                    <Pressable
                      key={r.key}
                      onPress={() => setStationRole(r.key)}
                      style={[styles.roleChip, stationRole === r.key && styles.roleChipActive]}
                    >
                      <Text style={[styles.roleChipText, stationRole === r.key && styles.roleChipTextActive]}>
                        {r.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
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
                const sub = getSubForReq("station.representative-photo");
                const mediaUrl = firstString(sub, ["storage_path", "mediaUrl"]);
                return (
                  <PhotoCaptureCard
                    title="Representative Photograph (Private KYC)"
                    subtitle="Take a clear face photo of the representative applying for this station."
                    photoUrl={mediaUrl}
                    guidanceText="Kept private for compliance and administrative identity verification."
                    onPhotoSelected={(file) => handleUploadRequirement("station.representative-photo", file)}
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
                      {latitude ? "Update Current GPS Coordinates" : "Capture Station GPS Coordinates"}
                    </Text>
                  </>
                )}
              </Pressable>

              {latitude && longitude ? (
                <View style={styles.coordBox}>
                  <MapPin color={colors.success} size={16} />
                  <Text style={styles.coordText}>
                    GPS: {latitude.toFixed(6)}, {longitude.toFixed(6)}
                  </Text>
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
              {["station.business-registration", "station.business-permit", "station.fire-safety-certificate", "station.settlement-evidence", "station.owner-identity"].map((reqKey) => {
                const req = appRequirements.find((r) => firstString(r, ["key"]) === reqKey);
                const sub = getSubForReq(reqKey);
                return (
                  <RequirementCard
                    key={reqKey}
                    requirementKey={reqKey}
                    title={firstString(req, ["display_name", "displayName"]) ?? reqKey}
                    description={firstString(req, ["description"]) ?? "Upload statutory certificate."}
                    isRequired={req?.is_required !== false}
                    allowedContentTypes={Array.isArray(req?.allowed_content_types) ? (req.allowed_content_types as string[]) : undefined}
                    uploadedDocument={
                      sub
                        ? {
                            id: recordId(sub) ?? "",
                            status: firstString(sub, ["status"]) ?? "submitted",
                            replacementRequested: Boolean(sub.replacement_requested),
                            replacementReason: firstString(sub, ["replacement_reason", "decision_reason"]),
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
                views={[
                  {
                    key: "station.photo.front",
                    title: "Front View",
                    description: "Clear photo showing the front of the station from the road.",
                    isRequired: true,
                    uploadedUrl: firstString(getSubForReq("station.photo.front"), ["storage_path", "mediaUrl"]),
                    replacementReason: firstString(getSubForReq("station.photo.front"), ["replacement_reason"]),
                  },
                  {
                    key: "station.photo.entrance",
                    title: "Main Entrance",
                    description: "Main vehicular entry and safety gate area.",
                    isRequired: true,
                    uploadedUrl: firstString(getSubForReq("station.photo.entrance"), ["storage_path", "mediaUrl"]),
                    replacementReason: firstString(getSubForReq("station.photo.entrance"), ["replacement_reason"]),
                  },
                  {
                    key: "station.photo.pump",
                    title: "LPG Refill & Dispensing Area",
                    description: "Dispensing meters, nozzle area, and scale platforms.",
                    isRequired: true,
                    uploadedUrl: firstString(getSubForReq("station.photo.pump"), ["storage_path", "mediaUrl"]),
                    replacementReason: firstString(getSubForReq("station.photo.pump"), ["replacement_reason"]),
                  },
                  {
                    key: "station.photo.tank",
                    title: "Bulk Storage Tanks & Infrastructure",
                    description: "LPG storage bullets and safety shut-off infrastructure.",
                    isRequired: true,
                    uploadedUrl: firstString(getSubForReq("station.photo.tank"), ["storage_path", "mediaUrl"]),
                    replacementReason: firstString(getSubForReq("station.photo.tank"), ["replacement_reason"]),
                  },
                  {
                    key: "station.photo.compound",
                    title: "Full Compound Yard View",
                    description: "Wide-angle view of the compound and safety perimeter.",
                    isRequired: true,
                    uploadedUrl: firstString(getSubForReq("station.photo.compound"), ["storage_path", "mediaUrl"]),
                    replacementReason: firstString(getSubForReq("station.photo.compound"), ["replacement_reason"]),
                  },
                  {
                    key: "station.photo.signboard",
                    title: "Station Name Signboard",
                    description: "Official branded signage with the station name.",
                    isRequired: true,
                    uploadedUrl: firstString(getSubForReq("station.photo.signboard"), ["storage_path", "mediaUrl"]),
                    replacementReason: firstString(getSubForReq("station.photo.signboard"), ["replacement_reason"]),
                  },
                  {
                    key: "station.photo.drone",
                    title: "Aerial / Drone View (Optional)",
                    description: "Optional elevated bird's-eye view of the station layout.",
                    isRequired: false,
                    uploadedUrl: firstString(getSubForReq("station.photo.drone"), ["storage_path", "mediaUrl"]),
                    replacementReason: firstString(getSubForReq("station.photo.drone"), ["replacement_reason"]),
                  },
                ]}
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
                    { label: "Role", value: stationRole },
                    { label: "Phone", value: phone },
                    { label: "Address", value: address },
                    { label: "Capacity", value: `${capacity} kg` },
                  ],
                },
              ]}
              documents={appRequirements.map((req) => {
                const key = firstString(req, ["key"]) ?? "";
                const sub = getSubForReq(key);
                return {
                  title: firstString(req, ["display_name", "displayName"]) ?? key,
                  isRequired: req.is_required !== false,
                  isUploaded: Boolean(sub && firstString(sub, ["status"]) !== "rejected"),
                  status: firstString(sub, ["status"]) ?? "pending",
                  stepIndex: key.startsWith("station.photo.") ? 4 : 3,
                };
              })}
              onGoToStep={(step) => setCurrentStep(step)}
              canSubmit={canSubmit}
              missingItemsCount={missingRequiredDocs.length}
            />
          ) : null}
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Navigation Buttons */}
      <View style={styles.footerRow}>
        {currentStep > 1 ? (
          <Pressable onPress={handlePrevStep} style={styles.prevBtn}>
            <ArrowLeft color={colors.ink} size={16} />
            <Text style={styles.prevBtnText}>Previous</Text>
          </Pressable>
        ) : <View style={{ flex: 1 }} />}

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
  sectionHeader: { fontSize: 16, fontWeight: "900", color: colors.ink, marginBottom: spacing.xs },
  fieldGroup: { gap: 6, marginBottom: spacing.md },
  fieldLabel: { fontSize: 13, fontWeight: "800", color: colors.ink },
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
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F0FDF4",
    padding: spacing.sm,
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  coordText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.success,
  },
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
  btnDisabled: {
    opacity: 0.5,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
