import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useMemo, useState, type FormEvent } from "react";
import { MapPinned, Pause, Play, Plus, RefreshCcw, ShieldCheck } from "lucide-react";

import { createClientIdempotencyKey, normalizeStatusLabel } from "@skima/frontend-core";
import {
  Button,
  DataTable,
  Dialog,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  SelectInput,
  StatusBadge,
  TextAreaInput,
  TextInput,
  type TableColumn,
} from "@skima/ui";

import { useSessionState } from "./session";

const CoverageRecordSchema = z.object({
  area_id: z.string().uuid(),
  area_key: z.string(),
  display_name: z.string(),
  parent_area_id: z.string().uuid().nullable(),
  area_type: z.enum(["country", "state", "lga", "city", "town", "locality", "radius", "polygon"]),
  country_code: z.string().nullable(),
  country_name: z.string().nullable(),
  state_name: z.string().nullable(),
  lga_name: z.string().nullable(),
  city_name: z.string().nullable(),
  town_name: z.string().nullable(),
  locality_name: z.string().nullable(),
  center_latitude: z.coerce.number().nullable(),
  center_longitude: z.coerce.number().nullable(),
  radius_meters: z.coerce.number().nullable(),
  polygon_geojson: z.record(z.unknown()).nullable(),
  area_priority: z.coerce.number(),
  area_status: z.enum(["active", "inactive"]),
  rule_id: z.string().uuid().nullable(),
  effect: z.enum(["include", "exclude"]).nullable(),
  rule_priority: z.coerce.number().nullable(),
  rule_status: z.enum(["active", "inactive"]).nullable(),
  effective_from: z.string().nullable(),
  effective_until: z.string().nullable(),
  area_metadata: z.record(z.unknown()),
  rule_metadata: z.record(z.unknown()).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const CoverageRecordsSchema = z.array(CoverageRecordSchema);
type CoverageRecord = z.infer<typeof CoverageRecordSchema>;
type CoverageAreaType = CoverageRecord["area_type"];
type CoverageEffect = Exclude<CoverageRecord["effect"], null>;

interface CoverageFormState {
  readonly displayName: string;
  readonly areaType: CoverageAreaType;
  readonly effect: CoverageEffect;
  readonly parentAreaId: string;
  readonly countryCode: string;
  readonly countryName: string;
  readonly stateName: string;
  readonly lgaName: string;
  readonly cityName: string;
  readonly townName: string;
  readonly localityName: string;
  readonly centerLatitude: string;
  readonly centerLongitude: string;
  readonly radiusMeters: string;
  readonly polygonGeojson: string;
  readonly areaPriority: string;
  readonly rulePriority: string;
  readonly effectiveFrom: string;
  readonly effectiveUntil: string;
}

const EMPTY_FORM: CoverageFormState = {
  displayName: "",
  areaType: "town",
  effect: "include",
  parentAreaId: "",
  countryCode: "NG",
  countryName: "Nigeria",
  stateName: "",
  lgaName: "",
  cityName: "",
  townName: "",
  localityName: "",
  centerLatitude: "",
  centerLongitude: "",
  radiusMeters: "",
  polygonGeojson: "",
  areaPriority: "0",
  rulePriority: "0",
  effectiveFrom: "",
  effectiveUntil: "",
};

const areaTypeOptions = [
  { label: "Country", value: "country" },
  { label: "State", value: "state" },
  { label: "Local government area (LGA)", value: "lga" },
  { label: "City", value: "city" },
  { label: "Town", value: "town" },
  { label: "Locality / neighbourhood", value: "locality" },
  { label: "Radius around a point", value: "radius" },
  { label: "Mapped polygon", value: "polygon" },
] as const;

const effectOptions = [
  { label: "Service available", value: "include" },
  { label: "Service unavailable", value: "exclude" },
] as const;

export function AdminServiceCoverageWorkspace() {
  const { supabase, status } = useSessionState();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CoverageRecord | null | undefined>(undefined);
  const [statusTarget, setStatusTarget] = useState<CoverageRecord | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const coverageQuery = useQuery({
    queryKey: ["admin-service-coverage"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_service_coverage");
      if (error) throw error;
      return CoverageRecordsSchema.parse(data ?? []);
    },
  });

  const records = coverageQuery.data ?? [];
  const activeIncluded = records.filter(isActiveIncluded).length;
  const activeExcluded = records.filter(isActiveExcluded).length;
  const paused = records.filter((record) => record.area_status !== "active" || record.rule_status !== "active").length;
  const precisionAreas = records.filter((record) => ["radius", "polygon"].includes(record.area_type)).length;

  const configureMutation = useMutation({
    mutationFn: async ({ form, record }: { readonly form: CoverageFormState; readonly record: CoverageRecord | null }) => {
      const parsed = validateCoverageForm(form);
      const { data, error } = await supabase.rpc("configure_lpg_service_coverage", {
        target_display_name: parsed.displayName,
        target_area_type: parsed.areaType,
        target_effect: parsed.effect,
        target_idempotency_key: createClientIdempotencyKey(
          "admin.service-coverage.configure",
          record?.area_id ?? `${parsed.areaType}:${parsed.displayName}`,
        ),
        target_area_id: record?.area_id ?? null,
        target_area_key: record?.area_key ?? null,
        target_parent_area_id: parsed.parentAreaId,
        target_country_code: parsed.countryCode,
        target_country_name: parsed.countryName,
        target_state_name: parsed.stateName,
        target_lga_name: parsed.lgaName,
        target_city_name: parsed.cityName,
        target_town_name: parsed.townName,
        target_locality_name: parsed.localityName,
        target_center_latitude: parsed.centerLatitude,
        target_center_longitude: parsed.centerLongitude,
        target_radius_meters: parsed.radiusMeters,
        target_polygon_geojson: parsed.polygonGeojson,
        target_area_priority: parsed.areaPriority,
        target_rule_priority: parsed.rulePriority,
        target_area_status: record?.area_status ?? "active",
        target_rule_status: record?.rule_status ?? "active",
        target_effective_from: parsed.effectiveFrom,
        target_effective_until: parsed.effectiveUntil,
        target_metadata: { sourceSurface: "admin_service_coverage" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (_data, variables) => {
      setEditing(undefined);
      setNotice(variables.record ? "Coverage area updated." : "Coverage area added.");
      await queryClient.invalidateQueries({ queryKey: ["admin-service-coverage"] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ record, reason }: { readonly record: CoverageRecord; readonly reason: string }) => {
      const nextStatus = record.area_status === "active" && record.rule_status === "active" ? "inactive" : "active";
      const { data, error } = await supabase.rpc("set_lpg_service_coverage_status", {
        target_area_id: record.area_id,
        target_status: nextStatus,
        target_reason: reason.trim(),
        target_idempotency_key: createClientIdempotencyKey(
          `admin.service-coverage.${nextStatus}`,
          record.area_id,
        ),
      });
      if (error) throw error;
      return { data, nextStatus };
    },
    onSuccess: async ({ nextStatus }) => {
      setStatusTarget(null);
      setNotice(nextStatus === "active" ? "Coverage area activated." : "Coverage area paused.");
      await queryClient.invalidateQueries({ queryKey: ["admin-service-coverage"] });
    },
  });

  const columns = useMemo<TableColumn<CoverageRecord>[]>(() => [
    {
      key: "display_name",
      header: "Coverage area",
      render: (record) => (
        <span>
          <strong>{record.display_name}</strong>
          <br />
          <small>{geographySummary(record)}</small>
        </span>
      ),
    },
    {
      key: "area_type",
      header: "Level",
      render: (record) => normalizeStatusLabel(record.area_type === "lga" ? "LGA" : record.area_type),
    },
    {
      key: "effect",
      header: "Service decision",
      render: (record) => (
        <StatusBadge tone={record.effect === "include" ? "success" : record.effect === "exclude" ? "danger" : "neutral"}>
          {record.effect === "include" ? "Available" : record.effect === "exclude" ? "Unavailable" : "Not set"}
        </StatusBadge>
      ),
    },
    {
      key: "area_status",
      header: "Status",
      render: (record) => (
        <StatusBadge tone={record.area_status === "active" && record.rule_status === "active" ? "success" : "warning"}>
          {record.area_status === "active" && record.rule_status === "active" ? "Active" : "Paused"}
        </StatusBadge>
      ),
    },
    {
      key: "effective_from",
      header: "Schedule",
      render: (record) => coverageSchedule(record),
    },
    {
      key: "actions",
      header: "Actions",
      render: (record) => (
        <div className="skima-action-row">
          <Button size="sm" variant="outline" onClick={() => setEditing(record)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant={record.area_status === "active" && record.rule_status === "active" ? "destructive" : "outline"}
            icon={record.area_status === "active" && record.rule_status === "active" ? Pause : Play}
            onClick={() => setStatusTarget(record)}
          >
            {record.area_status === "active" && record.rule_status === "active" ? "Pause" : "Activate"}
          </Button>
        </div>
      ),
    },
  ], []);

  const refresh = () => {
    setNotice(null);
    void coverageQuery.refetch();
  };

  return (
    <>
      <PageHeader
        eyebrow="LPG operations"
        title="Service Coverage"
        description="Control exactly where SKIMA LPG can accept pickup and return locations. Enable broad areas such as a state, then add more specific exclusions for LGAs, towns or neighbourhoods when needed."
        actions={
          <div className="skima-action-row">
            <Button icon={RefreshCcw} variant="outline" onClick={refresh}>Refresh coverage</Button>
            <Button icon={Plus} requiredPermission="lpg.config.manage" onClick={() => setEditing(null)}>
              Add coverage area
            </Button>
          </div>
        }
      />

      {notice ? <StatusBadge tone="success" className="skima-status-note">{notice}</StatusBadge> : null}

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Service available" value={activeIncluded} icon={MapPinned} tone="success" />
        <MetricTile label="Service exclusions" value={activeExcluded} icon={ShieldCheck} tone={activeExcluded ? "warning" : "info"} />
        <MetricTile label="Paused areas" value={paused} icon={Pause} tone={paused ? "warning" : "success"} />
        <MetricTile label="Radius / mapped zones" value={precisionAreas} icon={MapPinned} tone="info" />
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <h2>How coverage decisions work</h2>
            <p className="skima-muted">
              More specific areas take priority over broader ones. For example, you can make Anambra State available and then mark one LGA unavailable. A town, radius or mapped polygon can override a broader state decision without changing the database structure.
            </p>
          </div>
        </div>
      </section>

      {coverageQuery.isLoading ? <LoadingState label="Loading service coverage" /> : null}
      {coverageQuery.error ? (
        <ErrorState
          title="Service coverage unavailable"
          message={readError(coverageQuery.error)}
          onRetry={() => void coverageQuery.refetch()}
        />
      ) : null}
      {!coverageQuery.isLoading && !coverageQuery.error ? (
        <section className="sk-panel">
          <div className="sk-panel__header">
            <div>
              <h2>Coverage areas</h2>
              <p className="skima-muted">These rules are used by customer serviceability checks and refill quote validation.</p>
            </div>
            <StatusBadge>{records.length === 1 ? "1 area" : `${records.length} areas`}</StatusBadge>
          </div>
          <DataTable
            caption="LPG service coverage areas"
            columns={columns}
            records={records}
            getRowKey={(record) => record.area_id}
            emptyTitle="No service coverage configured"
            emptyMessage="Add the first coverage area before accepting LPG refill orders."
          />
        </section>
      ) : null}

      <CoverageDialog
        record={editing === undefined ? undefined : editing}
        records={records}
        isSubmitting={configureMutation.isPending}
        error={configureMutation.error}
        onClose={() => {
          if (!configureMutation.isPending) {
            configureMutation.reset();
            setEditing(undefined);
          }
        }}
        onSubmit={(form) => configureMutation.mutate({ form, record: editing ?? null })}
      />

      <CoverageStatusDialog
        record={statusTarget}
        isSubmitting={statusMutation.isPending}
        error={statusMutation.error}
        onClose={() => {
          if (!statusMutation.isPending) {
            statusMutation.reset();
            setStatusTarget(null);
          }
        }}
        onSubmit={(reason) => {
          if (statusTarget) statusMutation.mutate({ record: statusTarget, reason });
        }}
      />
    </>
  );
}

function CoverageDialog(props: {
  readonly record: CoverageRecord | null | undefined;
  readonly records: readonly CoverageRecord[];
  readonly isSubmitting: boolean;
  readonly error: unknown;
  readonly onClose: () => void;
  readonly onSubmit: (form: CoverageFormState) => void;
}) {
  const open = props.record !== undefined;
  const [form, setForm] = useState<CoverageFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const recordKey = props.record?.area_id ?? (props.record === null ? "new" : "closed");

  useMemo(() => {
    if (!open) return null;
    setForm(props.record ? formFromRecord(props.record) : EMPTY_FORM);
    setFormError(null);
    return null;
  }, [recordKey]);

  if (!open) return null;

  const update = (patch: Partial<CoverageFormState>) => setForm((current) => ({ ...current, ...patch }));
  const parentOptions = [
    { label: "No parent area", value: "" },
    ...props.records
      .filter((record) => record.area_id !== props.record?.area_id)
      .map((record) => ({ label: `${record.display_name} — ${normalizeStatusLabel(record.area_type)}`, value: record.area_id })),
  ];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      validateCoverageForm(form);
      setFormError(null);
      props.onSubmit(form);
    } catch (error) {
      setFormError(readError(error));
    }
  };

  return (
    <Dialog
      title={props.record ? "Edit coverage area" : "Add coverage area"}
      isOpen={open}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" disabled={props.isSubmitting} onClick={props.onClose}>Cancel</Button>
          <Button type="submit" form="service-coverage-form" isLoading={props.isSubmitting}>
            {props.record ? "Save coverage" : "Add coverage"}
          </Button>
        </>
      }
    >
      <form id="service-coverage-form" className="skima-form-grid" onSubmit={submit}>
        <p className="admin-dialog-guidance">
          Choose the geographic level and whether SKIMA LPG should be available there. The stable internal reference is created automatically.
        </p>
        <TextInput
          label="Coverage area name"
          helperText="Use a clear operational name, for example Anambra State or Anambra West LGA."
          value={form.displayName}
          onChange={(event) => update({ displayName: event.currentTarget.value })}
          required
        />
        <SelectInput
          label="Geographic level"
          value={form.areaType}
          options={areaTypeOptions}
          onChange={(event) => update({ areaType: event.currentTarget.value as CoverageAreaType })}
          required
        />
        <SelectInput
          label="Service decision"
          helperText="Available enables orders here. Unavailable creates an exclusion that can override a broader enabled area."
          value={form.effect}
          options={effectOptions}
          onChange={(event) => update({ effect: event.currentTarget.value as CoverageEffect })}
          required
        />
        <SelectInput
          label="Parent area (optional)"
          helperText="Use this to keep state, LGA, town and locality records organised as a hierarchy."
          value={form.parentAreaId}
          options={parentOptions}
          onChange={(event) => update({ parentAreaId: event.currentTarget.value })}
        />

        <TextInput
          label="Country code"
          helperText="Two-letter country code, for example NG. This remains editable for future countries."
          value={form.countryCode}
          onChange={(event) => update({ countryCode: event.currentTarget.value.toUpperCase() })}
        />
        <TextInput label="Country" value={form.countryName} onChange={(event) => update({ countryName: event.currentTarget.value })} />

        {form.areaType !== "country" && !["radius", "polygon"].includes(form.areaType) ? (
          <TextInput
            label="State / region"
            value={form.stateName}
            onChange={(event) => update({ stateName: event.currentTarget.value })}
            required
          />
        ) : null}
        {form.areaType === "lga" ? (
          <TextInput label="LGA" value={form.lgaName} onChange={(event) => update({ lgaName: event.currentTarget.value })} required />
        ) : null}
        {form.areaType === "city" ? (
          <TextInput label="City" value={form.cityName} onChange={(event) => update({ cityName: event.currentTarget.value })} required />
        ) : null}
        {form.areaType === "town" ? (
          <TextInput label="Town" value={form.townName} onChange={(event) => update({ townName: event.currentTarget.value })} required />
        ) : null}
        {form.areaType === "locality" ? (
          <TextInput label="Locality / neighbourhood" value={form.localityName} onChange={(event) => update({ localityName: event.currentTarget.value })} required />
        ) : null}

        {form.areaType === "radius" ? (
          <>
            <TextInput label="Centre latitude" type="number" value={form.centerLatitude} onChange={(event) => update({ centerLatitude: event.currentTarget.value })} required />
            <TextInput label="Centre longitude" type="number" value={form.centerLongitude} onChange={(event) => update({ centerLongitude: event.currentTarget.value })} required />
            <TextInput
              label="Radius (metres)"
              helperText="Customers must fall inside this distance from the centre point for this area to match."
              type="number"
              value={form.radiusMeters}
              onChange={(event) => update({ radiusMeters: event.currentTarget.value })}
              required
            />
          </>
        ) : null}

        {form.areaType === "polygon" ? (
          <TextAreaInput
            label="Polygon GeoJSON"
            helperText="Paste a GeoJSON Polygon object. This is useful when a real service boundary is not circular."
            value={form.polygonGeojson}
            onChange={(event) => update({ polygonGeojson: event.currentTarget.value })}
            required
          />
        ) : null}

        <TextInput
          label="Area priority"
          helperText="Usually leave at 0. Increase only when two areas at the same geographic level overlap."
          type="number"
          value={form.areaPriority}
          onChange={(event) => update({ areaPriority: event.currentTarget.value })}
        />
        <TextInput
          label="Decision priority"
          helperText="Usually leave at 0. More specific geographic levels already take priority automatically."
          type="number"
          value={form.rulePriority}
          onChange={(event) => update({ rulePriority: event.currentTarget.value })}
        />
        <TextInput
          label="Starts at (optional)"
          type="datetime-local"
          value={form.effectiveFrom}
          onChange={(event) => update({ effectiveFrom: event.currentTarget.value })}
        />
        <TextInput
          label="Ends at (optional)"
          type="datetime-local"
          value={form.effectiveUntil}
          onChange={(event) => update({ effectiveUntil: event.currentTarget.value })}
        />

        {formError ? <StatusBadge tone="danger">{formError}</StatusBadge> : null}
        {props.error ? <StatusBadge tone="danger">{readError(props.error)}</StatusBadge> : null}
      </form>
    </Dialog>
  );
}

function CoverageStatusDialog(props: {
  readonly record: CoverageRecord | null;
  readonly isSubmitting: boolean;
  readonly error: unknown;
  readonly onClose: () => void;
  readonly onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const active = Boolean(props.record && props.record.area_status === "active" && props.record.rule_status === "active");

  useMemo(() => {
    setReason("");
    return null;
  }, [props.record?.area_id]);

  if (!props.record) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason.trim()) return;
    props.onSubmit(reason);
  };

  return (
    <Dialog
      title={active ? "Pause coverage area" : "Activate coverage area"}
      isOpen={Boolean(props.record)}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" disabled={props.isSubmitting} onClick={props.onClose}>Cancel</Button>
          <Button
            type="submit"
            form="coverage-status-form"
            variant={active ? "destructive" : "primary"}
            icon={active ? Pause : Play}
            isLoading={props.isSubmitting}
            disabled={!reason.trim()}
          >
            {active ? "Pause area" : "Activate area"}
          </Button>
        </>
      }
    >
      <form id="coverage-status-form" className="skima-form-grid" onSubmit={submit}>
        <p className="admin-dialog-guidance">
          {active
            ? `Pausing ${props.record.display_name} removes this area from active LPG service matching until it is activated again.`
            : `Activating ${props.record.display_name} restores its latest saved service decision. Historical decisions remain inactive.`}
        </p>
        <TextAreaInput
          label="Reason"
          helperText="Record why this service coverage status is changing."
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
          required
        />
        {props.error ? <StatusBadge tone="danger">{readError(props.error)}</StatusBadge> : null}
      </form>
    </Dialog>
  );
}

function validateCoverageForm(form: CoverageFormState) {
  const displayName = form.displayName.trim();
  if (!displayName) throw new Error("Coverage area name is required.");

  const countryCode = nullableText(form.countryCode)?.toUpperCase() ?? null;
  const countryName = nullableText(form.countryName);
  if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
    throw new Error("Country code must contain two letters, such as NG.");
  }
  if (form.areaType === "country" && !countryCode && !countryName) {
    throw new Error("Enter a country name or country code.");
  }

  const stateName = nullableText(form.stateName);
  const needsState = ["state", "lga", "city", "town", "locality"].includes(form.areaType);
  if (needsState && !stateName) throw new Error("State / region is required for this geographic level.");

  const lgaName = nullableText(form.lgaName);
  const cityName = nullableText(form.cityName);
  const townName = nullableText(form.townName);
  const localityName = nullableText(form.localityName);
  if (form.areaType === "lga" && !lgaName) throw new Error("LGA is required.");
  if (form.areaType === "city" && !cityName) throw new Error("City is required.");
  if (form.areaType === "town" && !townName) throw new Error("Town is required.");
  if (form.areaType === "locality" && !localityName) throw new Error("Locality / neighbourhood is required.");

  const centerLatitude = nullableNumber(form.centerLatitude, "Centre latitude");
  const centerLongitude = nullableNumber(form.centerLongitude, "Centre longitude");
  const radiusMeters = nullableNumber(form.radiusMeters, "Radius");
  if (form.areaType === "radius") {
    if (centerLatitude === null || centerLatitude < -90 || centerLatitude > 90) throw new Error("Centre latitude must be between -90 and 90.");
    if (centerLongitude === null || centerLongitude < -180 || centerLongitude > 180) throw new Error("Centre longitude must be between -180 and 180.");
    if (radiusMeters === null || radiusMeters <= 0) throw new Error("Radius must be greater than zero metres.");
  }

  let polygonGeojson: Record<string, unknown> | null = null;
  if (form.areaType === "polygon") {
    try {
      const parsed: unknown = JSON.parse(form.polygonGeojson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      polygonGeojson = parsed as Record<string, unknown>;
      if (polygonGeojson.type !== "Polygon" || !Array.isArray(polygonGeojson.coordinates)) {
        throw new Error("Polygon GeoJSON must have type Polygon and a coordinates array.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Polygon GeoJSON")) throw error;
      throw new Error("Polygon GeoJSON is not valid JSON.");
    }
  }

  const areaPriority = requiredInteger(form.areaPriority, "Area priority");
  const rulePriority = requiredInteger(form.rulePriority, "Decision priority");
  const effectiveFrom = isoOrNull(form.effectiveFrom, "Start time");
  const effectiveUntil = isoOrNull(form.effectiveUntil, "End time");
  if (effectiveFrom && effectiveUntil && new Date(effectiveUntil) <= new Date(effectiveFrom)) {
    throw new Error("End time must be after start time.");
  }

  return {
    displayName,
    areaType: form.areaType,
    effect: form.effect,
    parentAreaId: nullableText(form.parentAreaId),
    countryCode,
    countryName,
    stateName,
    lgaName,
    cityName,
    townName,
    localityName,
    centerLatitude: form.areaType === "radius" ? centerLatitude : null,
    centerLongitude: form.areaType === "radius" ? centerLongitude : null,
    radiusMeters: form.areaType === "radius" ? radiusMeters : null,
    polygonGeojson: form.areaType === "polygon" ? polygonGeojson : null,
    areaPriority,
    rulePriority,
    effectiveFrom,
    effectiveUntil,
  };
}

function formFromRecord(record: CoverageRecord): CoverageFormState {
  return {
    displayName: record.display_name,
    areaType: record.area_type,
    effect: record.effect ?? "include",
    parentAreaId: record.parent_area_id ?? "",
    countryCode: record.country_code ?? "",
    countryName: record.country_name ?? "",
    stateName: record.state_name ?? "",
    lgaName: record.lga_name ?? "",
    cityName: record.city_name ?? "",
    townName: record.town_name ?? "",
    localityName: record.locality_name ?? "",
    centerLatitude: record.center_latitude === null ? "" : String(record.center_latitude),
    centerLongitude: record.center_longitude === null ? "" : String(record.center_longitude),
    radiusMeters: record.radius_meters === null ? "" : String(record.radius_meters),
    polygonGeojson: record.polygon_geojson ? JSON.stringify(record.polygon_geojson, null, 2) : "",
    areaPriority: String(record.area_priority),
    rulePriority: String(record.rule_priority ?? 0),
    effectiveFrom: dateTimeInput(record.effective_from),
    effectiveUntil: dateTimeInput(record.effective_until),
  };
}

function isActiveIncluded(record: CoverageRecord) {
  return record.area_status === "active" && record.rule_status === "active" && record.effect === "include";
}

function isActiveExcluded(record: CoverageRecord) {
  return record.area_status === "active" && record.rule_status === "active" && record.effect === "exclude";
}

function geographySummary(record: CoverageRecord): string {
  if (record.area_type === "radius") {
    const radius = record.radius_meters === null ? "radius not set" : `${formatDistance(record.radius_meters)} radius`;
    return [coordinateText(record.center_latitude, record.center_longitude), radius].filter(Boolean).join(" • ");
  }
  if (record.area_type === "polygon") return "Mapped polygon boundary";

  const parts = [
    record.locality_name,
    record.town_name,
    record.city_name,
    record.lga_name,
    record.state_name,
    record.country_name ?? record.country_code,
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);
  return parts.join(", ") || "Geography details not set";
}

function coverageSchedule(record: CoverageRecord): string {
  if (!record.effective_from && !record.effective_until) return "No scheduled limit";
  const start = record.effective_from ? formatDate(record.effective_from) : "Now";
  const end = record.effective_until ? formatDate(record.effective_until) : "No end date";
  return `${start} → ${end}`;
}

function coordinateText(latitude: number | null, longitude: number | null): string | null {
  if (latitude === null || longitude === null) return null;
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(metres % 1000 === 0 ? 0 : 1)} km` : `${Math.round(metres)} m`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function dateTimeInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function isoOrNull(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is not a valid date and time.`);
  return date.toISOString();
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nullableNumber(value: string, label: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number.`);
  return parsed;
}

function requiredInteger(value: string, label: string): number {
  const parsed = Number(value.trim() || "0");
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be a whole number.`);
  return parsed;
}

function readError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) return record.message;
  }
  return "The service coverage action could not be completed. Please try again.";
}
