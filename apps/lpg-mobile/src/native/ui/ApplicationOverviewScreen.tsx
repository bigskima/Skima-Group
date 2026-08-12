import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { LocateFixed, ShieldCheck } from "lucide-react-native";
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
  useLpgConfig,
} from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  displayStatus,
  firstNumber,
  firstString,
  nestedRecords,
  nestedRecord,
  recordId,
  type PlatformRecord,
} from "../api/records";
import { readOperationalLocation } from "../device/location";
import { useSession } from "../session/SessionProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { Card } from "./Card";
import { Screen } from "./Screen";
const editable = new Set(["draft", "incomplete", "additional_info_required"]);
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
  const stations = domainQueries.stations();
  const config = useLpgConfig();
  const client = useQueryClient();
  const [name, setName] = useState(
    session.context?.profile?.display_name ?? "",
  );
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [legalOrLicence, setLegalOrLicence] = useState("");
  const [serviceZone, setServiceZone] = useState("");
  const [slug, setSlug] = useState("");
  const [capacity, setCapacity] = useState("");
  const [opens, setOpens] = useState("");
  const [closes, setCloses] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [sizes, setSizes] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
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
      firstString(item, ["application_type_id", "applicationTypeId"]) ===
        typeId &&
      !["rejected", "withdrawn", "expired"].includes(
        firstString(item, ["status"]) ?? "",
      ),
  );
  const status = current ? (displayStatus(current) ?? "draft") : "draft";
  const currentId = current ? recordId(current) : null;
  const payloadVersions = useApplicationPayload(currentId);
  const requirementSetId = firstString(type, [
    "document_requirement_set_id",
    "documentRequirementSetId",
  ]);
  const requiredRequirements = (requirements.data ?? []).filter(
    (item) =>
      firstString(item, ["requirement_set_id", "requirementSetId"]) ===
        requirementSetId &&
      item.is_required === true &&
      firstString(item, ["status"]) === "active",
  );
  const requiredCount = requiredRequirements.length;
  const missingRequirements = requiredRequirements.filter(
    (requirement) =>
      !(documents.data ?? []).some(
        (document) =>
          firstString(document, ["application_id", "applicationId"]) ===
            currentId &&
          (firstString(document, ["requirement_id", "requirementId"]) ===
            recordId(requirement) ||
            firstString(document, ["requirement_key", "requirementKey"]) ===
              firstString(requirement, ["key"])),
      ),
  );
  const profiles = nestedRecords(config.data, "cylinderTypeProfiles");
  const organizationId = firstString(current, [
    "organization_id",
    "organizationId",
  ]);
  const stationActive = (stations.data ?? []).some(
    (station) =>
      firstString(station, ["organization_id", "organizationId"]) ===
        organizationId &&
      firstString(station, ["approval_status", "approvalStatus"]) ===
        "approved",
  );
  const hydratedApplication = useRef<string | null>(null);
  useEffect(() => {
    if (!currentId || hydratedApplication.current === currentId) return;
    const version = payloadVersions.data?.[0];
    const payload = nestedRecord(version, "payload") ?? version;
    if (!payload) return;
    const contact = nestedRecord(payload, "contact");
    const identity = nestedRecord(payload, "identity");
    const licence = nestedRecord(payload, "licence");
    const service = nestedRecord(payload, "service");
    const organization = nestedRecord(payload, "organization");
    const station = nestedRecord(payload, "station");
    const hours =
      nestedRecord(station, "operatingHours") ??
      nestedRecord(station, "operating_hours");
    setName(
      firstString(identity, ["fullName", "full_name"]) ??
        firstString(organization, ["displayName", "display_name"]) ??
        name,
    );
    setPhone(firstString(contact, ["phone"]) ?? phone);
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
    setServiceZone(firstString(service, ["zone"]) ?? serviceZone);
    setSlug(firstString(organization, ["slug"]) ?? slug);
    const storedCapacity = firstNumber(station, [
      "refillCapacityKg",
      "refill_capacity_kg",
    ]);
    if (storedCapacity !== null) setCapacity(String(storedCapacity));
    setOpens(firstString(hours, ["opensAt", "opens_at"]) ?? opens);
    setCloses(firstString(hours, ["closesAt", "closes_at"]) ?? closes);
    setLatitude(firstNumber(station, ["latitude", "lat"]));
    setLongitude(firstNumber(station, ["longitude", "lng", "lon"]));
    const storedSizes =
      station?.supportedCylinderSizesKg ?? station?.supported_cylinder_sizes_kg;
    if (Array.isArray(storedSizes))
      setSizes(
        storedSizes.filter(
          (value): value is number => typeof value === "number",
        ),
      );
    hydratedApplication.current = currentId;
  }, [currentId, payloadVersions.data]);
  const create = useGatewayMutation({
    path: "/runtime/applications",
    schema: ActionResponseSchema,
  });
  const update = useGatewayMutation({
    path: "/runtime/applications/payload",
    schema: ActionResponseSchema,
  });
  const submitMutation = useGatewayMutation({
    path: "/runtime/applications/submit",
    schema: ActionResponseSchema,
  });
  const activate = useGatewayMutation({
    path: "/lpg/stations/activate",
    schema: ActionResponseSchema,
    invalidate: [["stations"], ["station-runtime"]],
  });
  const locate = async () => {
    try {
      const point = await readOperationalLocation();
      setLatitude(point.latitude);
      setLongitude(point.longitude);
    } catch (cause) {
      setError(friendlyError(cause, "We couldn't get your station location. Please try again."));
    }
  };
  const send = async () => {
    setError(null);
    if (
      !name.trim() ||
      !phone.trim() ||
      !address.trim() ||
      !legalOrLicence.trim() ||
      (workspace === "driver" && !serviceZone.trim())
    ) {
      setError("Please complete all the required details.");
      return;
    }
    if (!type) {
      setError("Applications are unavailable right now. Please try again later.");
      return;
    }
    const stationCapacity = Number(capacity);
    if (
      workspace === "station" &&
      (!slug.trim() ||
        !Number.isFinite(stationCapacity) ||
        stationCapacity <= 0 ||
        !opens ||
        !closes ||
        latitude === null ||
        longitude === null ||
        sizes.length === 0)
    ) {
      setError(
        "Add your station short name, capacity, opening hours, cylinder sizes and location.",
      );
      return;
    }
    const payload =
      workspace === "driver"
        ? {
            contact: {
              email: session.context?.user.email,
              phone: phone.trim(),
            },
            identity: { address: address.trim(), fullName: name.trim() },
            licence: { number: legalOrLicence.trim() },
            service: { zone: serviceZone.trim() },
            workingHours: {},
            zones: [serviceZone.trim()],
          }
        : {
            contact: {
              email: session.context?.user.email,
              phone: phone.trim(),
            },
            organization: {
              displayName: name.trim(),
              legalName: legalOrLicence.trim(),
              slug: slug.trim(),
            },
            ownership: { ownerUserId: session.context?.user.id },
            station: {
              formattedAddress: address.trim(),
              latitude,
              longitude,
              operatingHours: { opensAt: opens, closesAt: closes },
              refillCapacityKg: stationCapacity,
              supportedCylinderSizesKg: sizes,
            },
          };
    try {
      let applicationId = current ? recordId(current) : null;
      if (applicationId)
        await update.mutateAsync({
          applicationId,
          payload,
          idempotencyKey: idempotencyKey(
            `${workspace}-application-payload`,
            applicationId,
          ),
        });
      else {
        const result = await create.mutateAsync({
          applicationTypeKey: firstString(type, ["key"]),
          payload,
          idempotencyKey: idempotencyKey(
            `${workspace}-application-create`,
            typeId ?? category,
          ),
        });
        applicationId = resultId(result);
      }
      if (!applicationId)
        throw new Error(
          "The application could not be saved.",
        );
      const hasMissingEvidence =
        requiredCount > 0 &&
        (!currentId ||
          applicationId !== currentId ||
          missingRequirements.length > 0);
      await client.invalidateQueries({
        queryKey: ["lpg-expo", "applications"],
      });
      if (hasMissingEvidence) {
        router.push(`/(customer)/${workspace}-documents` as never);
        return;
      }
      await submitMutation.mutateAsync({
        applicationId,
        idempotencyKey: idempotencyKey(
          `${workspace}-application-submit`,
          applicationId,
        ),
      });
      await client.invalidateQueries({
        queryKey: ["lpg-expo", "applications"],
      });
    } catch (cause) {
      setError(friendlyError(cause, "We couldn't submit your application. Please try again."));
    }
  };
  const activateStation = async () => {
    const applicationId = current ? recordId(current) : null;
    if (
      !applicationId ||
      !organizationId ||
      latitude === null ||
      longitude === null
    ) {
      setError(
        "Your approval and station location are needed before activation.",
      );
      return;
    }
    try {
      await activate.mutateAsync({
        applicationId,
        organizationId,
        ownerUserId: session.context?.user.id,
        branchKey: slug.trim(),
        displayName: name.trim(),
        formattedAddress: address.trim(),
        latitude,
        longitude,
        operatingHours: { opensAt: opens, closesAt: closes },
        refillCapacityKg: Number(capacity),
        currentAvailableKg: Number(capacity),
        supportedCylinderSizesKg: sizes,
        idempotencyKey: idempotencyKey("station-activation", applicationId),
      });
      await session.refresh();
    } catch (cause) {
      setError(friendlyError(cause, "We couldn't activate your station. Please try again."));
    }
  };
  const loading =
    applications.isPending ||
    types.isPending ||
    requirements.isPending ||
    documents.isPending ||
    (Boolean(currentId) && payloadVersions.isPending) ||
    config.isPending;
  if (loading)
    return (
      <Screen
        eyebrow={workspace === "driver" ? "Driver application" : "Station application"}
        title="Getting things ready"
      >
        <ActivityIndicator color={colors.brand} />
      </Screen>
    );
  if (current && !editable.has(status))
    return (
      <Screen
        eyebrow={`${workspace} application`}
        title="Application status"
        action={<Back />}
      >
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>APPLICATION STATUS</Text>
          <Text style={styles.heroTitle}>{applicationStatusLabel(status)}</Text>
          <Text style={styles.heroBody}>
            {applicationStatusMessage(status)}
          </Text>
        </View>
        <Card>
          <Field
            label="Application reference"
            value={
              firstString(current, [
                "public_reference",
                "publicReference",
                "id",
              ]) ?? "Unavailable"
            }
          />
          <Field
            label="Documents requested"
            value={String(requiredCount)}
          />
          <Field
            label="Last updated"
            value={
              formatDate(firstString(current, ["updated_at", "created_at"]))
            }
          />
        </Card>
        <Pressable
          style={styles.secondary}
          onPress={() =>
            router.push(`/(customer)/${workspace}-documents` as never)
          }
        >
          <Text style={styles.secondaryText}>View submitted documents</Text>
        </Pressable>
        {workspace === "station" && status === "approved" && !stationActive ? (
          <>
            <StationFields
              name={name}
              setName={setName}
              phone={phone}
              setPhone={setPhone}
              address={address}
              setAddress={setAddress}
              legal={legalOrLicence}
              setLegal={setLegalOrLicence}
              slug={slug}
              setSlug={setSlug}
              capacity={capacity}
              setCapacity={setCapacity}
              opens={opens}
              setOpens={setOpens}
              closes={closes}
              setCloses={setCloses}
              latitude={latitude}
              longitude={longitude}
              locate={locate}
              profiles={profiles}
              sizes={sizes}
              setSizes={setSizes}
            />
            <Pressable
              disabled={activate.isPending}
              style={styles.primary}
              onPress={() => void activateStation()}
            >
              {activate.isPending ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.primaryText}>
                  Activate station
                </Text>
              )}
            </Pressable>
          </>
        ) : null}
        {stationActive ? (
          <View style={styles.approved}>
            <ShieldCheck color={colors.success} />
            <Text style={styles.approvedText}>Your station is active.</Text>
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Screen>
    );
  return (
    <Screen
      eyebrow={`${workspace} application`}
      title={workspace === "driver" ? "Drive with SKIMA" : "Join as a station"}
      action={<Back />}
    >
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>
          {workspace === "driver" ? "DELIVER WITH SKIMA" : "PARTNER WITH SKIMA"}
        </Text>
        <Text style={styles.heroTitle}>
          {workspace === "driver" ? "Start your application" : "Tell us about your station"}
        </Text>
        <Text style={styles.heroBody}>
          {workspace === "driver"
            ? "Share your details so we can review your application. Your progress is saved as you go."
            : "Share your business and service details. Your progress is saved as you go."}
        </Text>
      </View>
      {workspace === "driver" ? (
        <DriverFields
          name={name}
          setName={setName}
          phone={phone}
          setPhone={setPhone}
          address={address}
          setAddress={setAddress}
          licence={legalOrLicence}
          setLicence={setLegalOrLicence}
          zone={serviceZone}
          setZone={setServiceZone}
        />
      ) : (
        <StationFields
          name={name}
          setName={setName}
          phone={phone}
          setPhone={setPhone}
          address={address}
          setAddress={setAddress}
          legal={legalOrLicence}
          setLegal={setLegalOrLicence}
          slug={slug}
          setSlug={setSlug}
          capacity={capacity}
          setCapacity={setCapacity}
          opens={opens}
          setOpens={setOpens}
          closes={closes}
          setCloses={setCloses}
          latitude={latitude}
          longitude={longitude}
          locate={locate}
          profiles={profiles}
          sizes={sizes}
          setSizes={setSizes}
        />
      )}
      <Card>
        <Field
          label="Applying as"
          value={workspace === "driver" ? "Delivery driver" : "Partner station"}
        />
        <Field
          label="Required documents"
          value={requiredCount === 1 ? "1 document" : `${requiredCount} documents`}
        />
      </Card>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        disabled={
          create.isPending || update.isPending || submitMutation.isPending
        }
        style={styles.primary}
        onPress={() => void send()}
      >
        {create.isPending || update.isPending || submitMutation.isPending ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.primaryText}>
            {requiredCount > 0 && missingRequirements.length > 0
              ? "Save and add documents"
              : "Submit application"}
          </Text>
        )}
      </Pressable>
      <Text style={styles.note}>
        {requiredCount > 0
          ? "You'll add the requested documents before your application is submitted."
          : "Review your details before submitting your application."}
      </Text>
    </Screen>
  );
}
function DriverFields(p: {
  name: string;
  setName(v: string): void;
  phone: string;
  setPhone(v: string): void;
  address: string;
  setAddress(v: string): void;
  licence: string;
  setLicence(v: string): void;
  zone: string;
  setZone(v: string): void;
}) {
  return (
    <>
      <Input
        placeholder="Full legal name"
        value={p.name}
        onChange={p.setName}
      />
      <Input
        placeholder="Phone number"
        value={p.phone}
        onChange={p.setPhone}
        keyboard="phone-pad"
      />
      <Input
        placeholder="Residential address"
        value={p.address}
        onChange={p.setAddress}
        multiline
      />
      <Input
        placeholder="Driver licence number"
        value={p.licence}
        onChange={p.setLicence}
      />
      <Input
        placeholder="Preferred service zone"
        value={p.zone}
        onChange={p.setZone}
      />
    </>
  );
}
function StationFields(p: {
  name: string;
  setName(v: string): void;
  phone: string;
  setPhone(v: string): void;
  address: string;
  setAddress(v: string): void;
  legal: string;
  setLegal(v: string): void;
  slug: string;
  setSlug(v: string): void;
  capacity: string;
  setCapacity(v: string): void;
  opens: string;
  setOpens(v: string): void;
  closes: string;
  setCloses(v: string): void;
  latitude: number | null;
  longitude: number | null;
  locate(): Promise<void>;
  profiles: PlatformRecord[];
  sizes: number[];
  setSizes(v: number[]): void;
}) {
  return (
    <>
      <Input
        placeholder="Station display name"
        value={p.name}
        onChange={p.setName}
      />
      <Input
        placeholder="Registered legal name"
        value={p.legal}
        onChange={p.setLegal}
      />
      <Input
        placeholder="Station short name (for example, skima-awka)"
        value={p.slug}
        onChange={(value) => p.setSlug(toSlug(value))}
      />
      <Input
        placeholder="Business phone"
        value={p.phone}
        onChange={p.setPhone}
        keyboard="phone-pad"
      />
      <Input
        placeholder="Station address"
        value={p.address}
        onChange={p.setAddress}
        multiline
      />
      <Pressable style={styles.location} onPress={() => void p.locate()}>
        <LocateFixed color={colors.brand} size={20} />
        <Text style={styles.locationText}>
          {p.latitude !== null && p.longitude !== null
            ? "Station location captured"
            : "Use my station location"}
        </Text>
      </Pressable>
      <Input
        placeholder="Daily refill capacity (kg)"
        value={p.capacity}
        onChange={p.setCapacity}
        keyboard="decimal-pad"
      />
      <View style={styles.two}>
        <View style={{ flex: 1 }}>
          <Input
            placeholder="Opening time (08:00)"
            value={p.opens}
            onChange={p.setOpens}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Input
            placeholder="Closing time (18:00)"
            value={p.closes}
            onChange={p.setCloses}
          />
        </View>
      </View>
      <Text style={styles.fieldTitle}>Supported cylinder sizes</Text>
      <View style={styles.options}>
        {p.profiles.map((item, index) => {
          const size = firstNumber(item, ["sizeKg", "size_kg"]);
          if (size === null) return null;
          const selected = p.sizes.includes(size);
          return (
            <Pressable
              key={recordId(item) ?? String(index)}
              onPress={() =>
                p.setSizes(
                  selected
                    ? p.sizes.filter((value) => value !== size)
                    : [...p.sizes, size],
                )
              }
              style={[styles.option, selected && styles.selected]}
            >
              <Text style={styles.optionText}>
                {firstString(item, ["displayName", "display_name"]) ??
                  `${size} kg`}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}
function Input({
  placeholder,
  value,
  onChange,
  multiline,
  keyboard,
}: {
  placeholder: string;
  value: string;
  onChange(v: string): void;
  multiline?: boolean;
  keyboard?: "phone-pad" | "decimal-pad";
}) {
  return (
    <TextInput
      style={[styles.input, multiline && styles.multiline]}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      value={value}
      onChangeText={onChange}
      multiline={multiline}
      keyboardType={keyboard}
    />
  );
}
function Back() {
  return (
    <Pressable onPress={() => router.back()}>
      <Text style={styles.link}>Back</Text>
    </Pressable>
  );
}
function resultId(result: string | PlatformRecord | null) {
  return typeof result === "string"
    ? result
    : result
      ? firstString(result, ["id", "applicationId", "application_id"])
      : null;
}
function applicationStatusLabel(status: string) {
  const labels: Record<string, string> = {
    approved: "Approved",
    expired: "Expired",
    rejected: "Not approved",
    submitted: "Submitted",
    under_review: "Under review",
    reviewing: "Under review",
    withdrawn: "Withdrawn",
  };
  return labels[status] ?? "In progress";
}
function applicationStatusMessage(status: string) {
  if (status === "approved")
    return "Your application has been approved. Complete any remaining setup to begin.";
  if (status === "rejected")
    return "We couldn't approve this application. Review the decision and contact support if you need help.";
  if (status === "submitted" || status === "under_review" || status === "reviewing")
    return "We're reviewing your application and will let you know when a decision is ready.";
  if (status === "withdrawn") return "This application has been withdrawn.";
  if (status === "expired") return "This application has expired. Start a new application when you're ready.";
  return "We'll let you know when there is an update to your application.";
}
function formatDate(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}
function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 3 }}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}
function toSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
const styles = StyleSheet.create({
  link: { color: colors.brand, fontWeight: "800" },
  hero: {
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.brand,
  },
  heroLabel: { color: "#FFDDE1", fontWeight: "900", fontSize: 11 },
  heroTitle: {
    color: "white",
    fontSize: 28,
    fontWeight: "900",
    textTransform: "capitalize",
  },
  heroBody: { color: "#FFF1F2", lineHeight: 21 },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    color: colors.ink,
    fontSize: 16,
  },
  multiline: {
    minHeight: 92,
    paddingTop: spacing.md,
    textAlignVertical: "top",
  },
  two: { flexDirection: "row", gap: spacing.md },
  location: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radii.md,
  },
  locationText: { color: colors.brand, fontWeight: "800" },
  fieldTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  option: {
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
  },
  selected: { borderColor: colors.brand, backgroundColor: "#FFF0F1" },
  optionText: { color: colors.ink, fontWeight: "800" },
  label: {
    color: colors.muted,
    fontWeight: "800",
    fontSize: 11,
    textTransform: "uppercase",
  },
  value: { color: colors.ink, fontWeight: "700" },
  primary: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontWeight: "900" },
  secondary: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  secondaryText: { color: colors.brand, fontWeight: "900" },
  approved: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: "#E9F7EE",
    borderRadius: radii.md,
  },
  approvedText: { color: colors.success, fontWeight: "900" },
  error: { color: colors.danger },
  note: { color: colors.muted, lineHeight: 20 },
});
