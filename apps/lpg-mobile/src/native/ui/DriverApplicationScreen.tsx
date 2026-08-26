import { router } from "expo-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
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

import { domainQueries, useApplicationPayload } from "../api/domains";
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
import { ApplicationReviewSummary } from "../application/ApplicationReviewSummary";
import { ApplicationStatusTimeline } from "../application/ApplicationStatusTimeline";
import { PhotoCaptureCard } from "../application/PhotoCaptureCard";
import { RequirementCard } from "../application/RequirementCard";
import { requirementAppliesToPayload } from "../application/requirementApplicability";
import { readOperationalLocation, type OperationalLocation } from "../device/location";
import { uploadMedia } from "../media/upload";
import { useSession } from "../session/SessionProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { Card } from "./Card";
import { Screen } from "./Screen";

const DRIVER_DOCUMENT_KEYS = [
  "driver.licence",
  "driver.identity",
  "driver.address-evidence",
] as const;

interface ServiceAreaOption {
  readonly areaId: string;
  readonly displayName: string;
  readonly areaType: string;
  readonly parentAreaId: string | null;
  readonly countryCode: string | null;
  readonly countryName: string | null;
  readonly stateName: string | null;
  readonly lgaName: string | null;
  readonly cityName: string | null;
  readonly townName: string | null;
  readonly localityName: string | null;
  readonly radiusMeters: number | null;
}

function timestampOf(record: Record<string, unknown>) {
  const value = firstString(record, ["updated_at", "updatedAt", "created_at", "createdAt"]);
  const time = value ? Date.parse(value) : 0;
  return Number.isFinite(time) ? time : 0;
}

export function DriverApplicationScreen() {
  const session = useSession();
  const applications = domainQueries.applications();
  const types = domainQueries.applicationTypes();
  const requirements = domainQueries.documentRequirements();
  const documents = domainQueries.documents();

  const [currentStep, setCurrentStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [loadingServiceAreas, setLoadingServiceAreas] = useState(true);
  const [serviceAreas, setServiceAreas] = useState<readonly ServiceAreaOption[]>([]);

  const [name, setName] = useState(session.context?.profile?.display_name ?? "");
  const [driverDisplayName, setDriverDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [licenceNumber, setLicenceNumber] = useState("");
  const [operatingLocation, setOperatingLocation] = useState<OperationalLocation | null>(null);
  const [selectedServiceAreaIds, setSelectedServiceAreaIds] = useState<readonly string[]>([]);

  const draftAttemptKey = useRef(`${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  const type = useMemo(
    () =>
      (types.data ?? []).find(
        (item) =>
          firstString(item, ["application_category", "applicationCategory"]) === "driver" &&
          firstString(item, ["status"]) === "active",
      ),
    [types.data],
  );
  const typeId = type ? recordId(type) : null;

  const current = useMemo(() => {
    const matching = (applications.data ?? [])
      .filter((item) => {
        if (firstString(item, ["application_type_id", "applicationTypeId"]) !== typeId) return false;
        const itemStatus = firstString(item, ["status"]) ?? "";
        return !["rejected", "withdrawn", "expired"].includes(itemStatus);
      })
      .sort((a, b) => timestampOf(b) - timestampOf(a));
    return matching[0];
  }, [applications.data, typeId]);

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

  useEffect(() => {
    let active = true;
    setLoadingServiceAreas(true);
    void session.supabase
      .rpc("read_selectable_operational_geographies")
      .then(({ data, error: serviceAreaError }) => {
        if (!active) return;
        if (serviceAreaError) {
          setError(
            friendlyError(
              serviceAreaError,
              "Service areas could not be loaded. Please try again.",
            ),
          );
          setServiceAreas([]);
          return;
        }
        setServiceAreas(readServiceAreaOptions(data));
      })
      .then(() => {
        if (active) setLoadingServiceAreas(false);
      });
    return () => {
      active = false;
    };
  }, [session.supabase]);

  const hydratedApplication = useRef<string | null>(null);
  useEffect(() => {
    if (!currentId || hydratedApplication.current === currentId) return;
    const version = payloadVersions.data?.[0];
    const payload = nestedRecord(version, "payload") ?? version;
    if (!payload) return;

    const contact = nestedRecord(payload, "contact");
    const identity = nestedRecord(payload, "identity");
    const licence = nestedRecord(payload, "licence");
    const storedLocation = nestedRecord(payload, "location");
    const service = nestedRecord(payload, "service");

    setName(firstString(identity, ["fullName", "full_name"]) ?? name);
    setDriverDisplayName(
      firstString(identity, ["driverDisplayName", "driver_display_name"]) ?? driverDisplayName,
    );
    setPhone(firstString(contact, ["phone"]) ?? phone);
    setAddress(firstString(identity, ["address"]) ?? address);
    setLicenceNumber(firstString(licence, ["number"]) ?? licenceNumber);

    const storedLat = firstNumber(storedLocation, ["latitude", "lat"]);
    const storedLng = firstNumber(storedLocation, ["longitude", "lng", "lon"]);
    if (storedLocation && storedLat !== null && storedLng !== null) {
      setOperatingLocation(storedLocation as unknown as OperationalLocation);
    }

    const storedIds = readCoverageGeographyIds(service);
    if (storedIds.length > 0) setSelectedServiceAreaIds(storedIds);

    hydratedApplication.current = currentId;
  }, [currentId, payloadVersions.data]);

  const buildPayload = () => ({
    identity: {
      fullName: name.trim(),
      driverDisplayName: driverDisplayName.trim() || name.trim(),
      address: address.trim(),
    },
    contact: { phone: phone.trim() },
    licence: { number: licenceNumber.trim() },
    location: operatingLocation,
    service: {
      coverageRequests: selectedServiceAreaIds.map((geographyId) => ({ type: "ADMIN_GEOGRAPHY", geographyId })),
    },
  });

  const ensureApplicationId = async (): Promise<string> => {
    if (currentId) return currentId;
    const typeKey = firstString(type, ["key"]) ?? "application.lpg.driver";
    const userId = session.context?.user.id;
    if (!userId) throw new Error("Please sign in again before starting the application.");

    const result = await createDraft.mutateAsync({
      applicationTypeKey: typeKey,
      applicantUserId: userId,
      payload: buildPayload(),
      source: "skima.lpg.mobile",
      idempotencyKey: idempotencyKey(
        "driver-app-draft-init",
        `${userId}:${draftAttemptKey.current}`,
      ),
    });
    const response = typeof result === "object" && result !== null
      ? (result as Record<string, unknown>)
      : null;
    const nestedData = typeof response?.data === "object" && response.data !== null
      ? (response.data as Record<string, unknown>)
      : null;
    const resultId =
      firstString(response, ["id", "application_id", "applicationId"]) ??
      firstString(nestedData, ["id", "application_id", "applicationId"]);
    await applications.refetch();
    if (!resultId) throw new Error("Application draft was created but its ID was not returned.");
    return resultId;
  };

  const persistDraft = async (): Promise<boolean> => {
    setError(null);
    try {
      const appId = await ensureApplicationId();
      await savePayload.mutateAsync({
        applicationId: appId,
        payload: buildPayload(),
        idempotencyKey: idempotencyKey("driver-app-payload-save", `${appId}:${Date.now()}`),
      });
      return true;
    } catch (cause) {
      setError(friendlyError(cause, "Your application draft could not be saved. Please try again."));
      return false;
    }
  };

  const detectOperatingLocation = async () => {
    setDetectingLocation(true);
    setError(null);
    try {
      const location = await readOperationalLocation();
      setOperatingLocation(location);
    } catch (cause) {
      setError(
        friendlyError(
          cause,
          "We could not detect your operating location. Check location access and try again.",
        ),
      );
    } finally {
      setDetectingLocation(false);
    }
  };

  const toggleServiceArea = (areaId: string) => {
    setSelectedServiceAreaIds((currentIds) => {
      if (currentIds.includes(areaId)) {
        const next = currentIds.filter((id) => id !== areaId);
        return next;
      }
      const next = [...currentIds, areaId];
      return next;
    });
  };

  const validateStep = (step: number): boolean => {
    if (step === 1) {
      if (!name.trim() || !phone.trim() || !address.trim() || !licenceNumber.trim()) {
        setError("Complete your name, phone number, residential address and driver licence number before continuing.");
        return false;
      }
    }
    if (step === 2) {
      if (!operatingLocation) {
        setError("Capture the location you normally operate from before continuing.");
        return false;
      }
      if (selectedServiceAreaIds.length === 0) {
        setError("Choose at least one requested operating area.");
        return false;
      }
    }
    return true;
  };

  const handleNextStep = async () => {
    setError(null);
    if (!validateStep(currentStep)) return;
    if (await persistDraft()) setCurrentStep((previous) => Math.min(5, previous + 1));
  };

  const handlePrevStep = () => {
    setError(null);
    setCurrentStep((previous) => Math.max(1, previous - 1));
  };

  const handleSaveAndExit = async () => {
    if (await persistDraft()) router.back();
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
        idempotencyKey: idempotencyKey("driver-doc-upload", `${appId}:${reqKey}:${Date.now()}`),
      });
      await documents.refetch();
    } catch (cause) {
      setError(friendlyError(cause, "Upload could not be saved. Please try again."));
      throw cause;
    }
  };

  const getSubForReq = (reqKey: string) =>
    appSubmissions.find((submission) => {
      const submissionKey = firstString(submission, ["requirement_key", "requirementKey"]);
      const submissionRequirementId = firstString(submission, ["requirement_id", "requirementId"]);
      const targetRequirement = appRequirements.find(
        (requirement) => firstString(requirement, ["key"]) === reqKey,
      );
      return submissionKey === reqKey || Boolean(
        targetRequirement && submissionRequirementId === recordId(targetRequirement),
      );
    });

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
  const applicationFieldsReady = Boolean(
    name.trim() &&
    phone.trim() &&
    address.trim() &&
    licenceNumber.trim() &&
    operatingLocation &&
    selectedServiceAreaIds.length > 0,
  );
  const canSubmit = missingRequiredDocs.length === 0 && applicationFieldsReady;

  const isPostSubmission = Boolean(
    current && [
      "submitted",
      "under_review",
      "approved",
      "changes_requested",
      "additional_info_required",
      "rejected",
    ].includes(status),
  );

  const reviewDocuments = applicableRequirements.map((requirement) => {
    const key = firstString(requirement, ["key"]) ?? "";
    const submission = getSubForReq(key);
    return {
      title: firstString(requirement, ["display_name", "displayName"]) ?? key,
      isRequired: requirement.is_required !== false,
      isUploaded: Boolean(submission && firstString(submission, ["status"]) !== "rejected"),
      status: firstString(submission, ["status"]) ?? "pending",
      stepIndex: key === "driver.profile-photo" ? 3 : 4,
    };
  });

  const selectedAreaNames = selectedServiceAreaIds
    .map((id) => serviceAreas.find((area) => area.areaId === id)?.displayName)
    .filter((value): value is string => Boolean(value));

  const handleSubmitApplication = async () => {
    setError(null);
    if (!applicationFieldsReady) {
      setError("Complete your operating location and service areas before submitting your application.");
      setCurrentStep(2);
      return;
    }
    setSubmitting(true);
    try {
      const appId = await ensureApplicationId();
      const saved = await persistDraft();
      if (!saved) return;
      await submitApp.mutateAsync({
        applicationId: appId,
        idempotencyKey: idempotencyKey("driver-app-submit", appId),
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

  if (applications.isPending || types.isPending || requirements.isPending) {
    return (
      <Screen eyebrow="driver application" title="Application">
        <ActivityIndicator color={colors.brand} />
      </Screen>
    );
  }

  if (isPostSubmission) {
    return (
      <Screen
        eyebrow="driver partner"
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
          onFixRequestedChanges={() => setCurrentStep(2)}
        />
      </Screen>
    );
  }

  return (
    <Screen
      eyebrow="driver onboarding"
      title="Driver Application"
      action={
        <Pressable onPress={() => void handleSaveAndExit()}>
          <Text style={styles.link}>Save & Exit</Text>
        </Pressable>
      }
    >
      <ApplicationProgress
        currentStep={currentStep}
        totalSteps={5}
        completionPercent={currentStep === 5 ? readinessPercent : undefined}
        completionLabel={currentStep === 5
          ? `${readyRequiredCount}/${requiredApplicableCount} required documents ready`
          : undefined}
        stepTitle={
          currentStep === 1
            ? "Personal Information"
            : currentStep === 2
              ? "Operating Location & Service Areas"
              : currentStep === 3
                ? "Driver Photograph"
                : currentStep === 4
                  ? "Driver Verification Documents"
                  : "Review & Submit"
        }
      />

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
              placeholder="Enter your residential address"
              style={[styles.input, styles.textArea]}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Driver Licence Number *</Text>
            <TextInput
              value={licenceNumber}
              onChangeText={setLicenceNumber}
              placeholder="Enter your driver licence number"
              style={styles.input}
            />
          </View>
        </Card>
      ) : null}

      {currentStep === 2 ? (
        <>
          <Card>
            <Text style={styles.sectionHeader}>Where You Operate From</Text>
            <Text style={styles.helperText}>
              Choose where you normally start work. SKIMA uses this to review the areas you request, and it is never shown as your live public location.
            </Text>
            <Pressable
              disabled={detectingLocation}
              onPress={() => void detectOperatingLocation()}
              style={styles.locationBtn}
            >
              {detectingLocation ? (
                <ActivityIndicator color={colors.brand} />
              ) : (
                <>
                  <LocateFixed color={colors.brand} size={18} />
                  <Text style={styles.locationBtnText}>
                    {operatingLocation ? "Update Operating Location" : "Capture Operating Location"}
                  </Text>
                </>
              )}
            </Pressable>
            {operatingLocation ? (
              <View style={styles.coordBox}>
                <MapPin color={colors.success} size={16} />
                <View style={styles.coordCopy}>
                  <Text style={styles.coordTitle}>
                    {operatingLocation.formattedAddress || "Operating location captured"}
                  </Text>
                  <Text style={styles.coordText}>
                    Location captured{typeof operatingLocation.accuracyMeters === "number"
                      ? ` • about ${Math.round(operatingLocation.accuracyMeters)} m accuracy`
                      : ""}
                  </Text>
                </View>
              </View>
            ) : null}
          </Card>

          <Card>
            <Text style={styles.sectionHeader}>Service Areas</Text>
            <Text style={styles.helperText}>
              Choose every area you can reliably serve. SKIMA will review your request before you can receive jobs there.
            </Text>
            {loadingServiceAreas ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.brand} size="small" />
                <Text style={styles.helperText}>Loading available service areas…</Text>
              </View>
            ) : serviceAreas.length === 0 ? (
              <View style={styles.emptyAreaBox}>
                <Text style={styles.emptyAreaTitle}>No service areas are available yet</Text>
                <Text style={styles.helperText}>
                  You can save your application and return when driver applications open in your area.
                </Text>
              </View>
            ) : (
              <View style={styles.areaList}>
                {serviceAreas.map((area) => {
                  const selected = selectedServiceAreaIds.includes(area.areaId);
                  return (
                    <View key={area.areaId} style={[styles.areaCard, selected && styles.areaCardSelected]}>
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected }}
                        onPress={() => toggleServiceArea(area.areaId)}
                        style={styles.areaSelectRow}
                      >
                        <View style={[styles.checkBox, selected && styles.checkBoxSelected]}>
                          {selected ? <Check color="white" size={14} /> : null}
                        </View>
                        <View style={styles.areaCopy}>
                          <Text style={styles.areaTitle}>{area.displayName}</Text>
                          <Text style={styles.areaMeta}>{serviceAreaSummary(area)}</Text>
                        </View>
                      </Pressable>

                    </View>
                  );
                })}
              </View>
            )}
          </Card>
        </>
      ) : null}

      {currentStep === 3 ? (
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

      {currentStep === 4 ? (
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
                description={firstString(requirement, ["description"]) ?? "Upload a clear, valid document."}
                isRequired={requirement?.is_required !== false}
                allowedContentTypes={
                  Array.isArray(requirement?.allowed_content_types)
                    ? (requirement.allowed_content_types as string[])
                    : undefined
                }
                uploadedDocument={submission
                  ? {
                      id: recordId(submission) ?? "",
                      status: firstString(submission, ["status"]) ?? "submitted",
                      replacementRequested: Boolean(submission.replacement_requested),
                      replacementReason: firstString(submission, [
                        "replacement_reason",
                        "decision_reason",
                      ]),
                    }
                  : null}
                onUploadFile={(file) => handleUploadRequirement(reqKey, file)}
              />
            );
          })}
        </View>
      ) : null}

      {currentStep === 5 ? (
        <ApplicationReviewSummary
          sections={[
            {
              title: "Personal Information",
              stepIndex: 1,
              items: [
                { label: "Full Name", value: name },
                { label: "Phone", value: phone },
                { label: "Licence Number", value: licenceNumber },
                { label: "Residential Address", value: address },
              ],
            },
            {
              title: "Requested service areas",
              stepIndex: 2,
              items: [
                {
                  label: "Operating Location",
                  value: operatingLocation?.formattedAddress || (operatingLocation ? "Location captured" : "Not captured"),
                },
                { label: "Requested Operating Areas", value: selectedAreaNames.join(", ") || "Not selected" },
                {
                  label: "Service Areas",
                  value: selectedAreaNames.length > 0 ? selectedAreaNames.join(", ") : "None selected",
                },
              ],
            },
          ]}
          documents={reviewDocuments}
          onGoToStep={setCurrentStep}
          canSubmit={canSubmit}
          missingItemsCount={missingRequiredDocs.length + (applicationFieldsReady ? 0 : 1)}
        />
      ) : null}

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
        {currentStep < 5 ? (
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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function readServiceAreaOptions(value: unknown): ServiceAreaOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const areaId = readNullableString(record.area_id);
    const displayName = readNullableString(record.display_name);
    const areaType = readNullableString(record.area_type);
    if (!areaId || !displayName || !areaType) return [];
    return [{
      areaId,
      displayName,
      areaType,
      parentAreaId: readNullableString(record.parent_area_id),
      countryCode: readNullableString(record.country_code),
      countryName: readNullableString(record.country_name),
      stateName: readNullableString(record.state_name),
      lgaName: readNullableString(record.lga_name),
      cityName: readNullableString(record.city_name),
      townName: readNullableString(record.town_name),
      localityName: readNullableString(record.locality_name),
      radiusMeters: typeof record.radius_meters === "number" ? record.radius_meters : null,
    }];
  });
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function serviceAreaSummary(area: ServiceAreaOption): string {
  if (area.areaType === "radius" && area.radiusMeters) {
    const distance = area.radiusMeters >= 1000
      ? `${(area.radiusMeters / 1000).toFixed(area.radiusMeters % 1000 === 0 ? 0 : 1)} km radius`
      : `${Math.round(area.radiusMeters)} m radius`;
    return distance;
  }
  const parts = [
    area.localityName,
    area.townName,
    area.cityName,
    area.lgaName,
    area.stateName,
    area.countryName ?? area.countryCode,
  ].filter((part, index, all): part is string => Boolean(part) && all.indexOf(part) === index);
  return parts.join(", ") || area.areaType.replace(/_/g, " ");
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
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  locationBtnText: { color: colors.brand, fontSize: 13, fontWeight: "800" },
  coordBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#F0FDF4",
    padding: spacing.sm,
    borderRadius: radii.md,
  },
  coordCopy: { flex: 1, gap: 2 },
  coordTitle: { fontSize: 12, fontWeight: "800", color: colors.ink },
  coordText: { fontSize: 11, fontWeight: "700", color: colors.success },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  emptyAreaBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#FAFAFA",
    gap: 4,
  },
  emptyAreaTitle: { fontSize: 13, fontWeight: "800", color: colors.ink },
  areaList: { gap: spacing.sm, marginTop: spacing.md },
  areaCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  areaCardSelected: { borderColor: colors.brand, backgroundColor: "#FFF8F8" },
  areaSelectRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  checkBox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  checkBoxSelected: { borderColor: colors.brand, backgroundColor: colors.brand },
  areaCopy: { flex: 1, gap: 2 },
  areaTitle: { fontSize: 14, fontWeight: "800", color: colors.ink },
  areaMeta: { fontSize: 11, lineHeight: 16, color: colors.muted, fontWeight: "600" },
  primaryBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  primaryBtnActive: { borderColor: colors.brand, backgroundColor: "#FFF0F1" },
  primaryBtnText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  primaryBtnTextActive: { color: colors.brand },
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
  prevBtnText: { fontSize: 14, fontWeight: "800", color: colors.ink },
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
  nextBtnText: { color: "white", fontSize: 14, fontWeight: "900" },
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
  submitBtnText: { color: "white", fontSize: 14, fontWeight: "900" },
  btnDisabled: { opacity: 0.5 },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
function readCoverageGeographyIds(service: Record<string, unknown> | null): string[] {
  const requests = service?.coverageRequests;
  if (!Array.isArray(requests)) return [];
  return requests.flatMap((request) => request && typeof request === "object" && !Array.isArray(request) && typeof (request as Record<string, unknown>).geographyId === "string" ? [(request as Record<string, unknown>).geographyId as string] : []);
}
