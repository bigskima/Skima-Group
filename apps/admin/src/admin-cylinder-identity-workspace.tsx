import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, PackageCheck, RefreshCcw, ShieldCheck, Tag } from "lucide-react";
import { useMemo, useState } from "react";

import { normalizeStatusLabel } from "@skima/frontend-core";
import {
  Button,
  DataTable,
  ErrorState,
  LoadingState,
  MetricTile,
  SelectInput,
  StatusBadge,
  TextInput,
  type TableColumn,
} from "@skima/ui";

import { useSessionState } from "./session";

type PlatformRecord = Readonly<Record<string, unknown>>;
type IdentityTab = "cylinders" | "tags" | "history";
type TagAction = "issue" | "assign" | "bind" | "damaged" | "lost" | "replace" | "revoke";

const identityTabs: readonly { readonly key: IdentityTab; readonly label: string }[] = [
  { key: "cylinders", label: "Cylinders" },
  { key: "tags", label: "Physical tags" },
  { key: "history", label: "Tag history" },
];

const tagActions = [
  { label: "Issue a new physical tag", value: "issue" },
  { label: "Assign unused tag to driver", value: "assign" },
  { label: "Bind first tag to cylinder", value: "bind" },
  { label: "Report tag damaged", value: "damaged" },
  { label: "Report tag lost", value: "lost" },
  { label: "Replace physical tag", value: "replace" },
  { label: "Revoke physical tag", value: "revoke" },
] as const;

const tagTypes = [
  { label: "QR", value: "qr" },
  { label: "NFC", value: "nfc" },
  { label: "Barcode", value: "barcode" },
  { label: "Other", value: "other" },
] as const;

export function AdminCylinderIdentityWorkspace() {
  const { supabase, status } = useSessionState();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<IdentityTab>("cylinders");
  const [action, setAction] = useState<TagAction>("issue");
  const [tagType, setTagType] = useState("qr");
  const [tagReference, setTagReference] = useState("");
  const [replacementTagReference, setReplacementTagReference] = useState("");
  const [cylinderId, setCylinderId] = useState("");
  const [driverProfileId, setDriverProfileId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [issuedCredential, setIssuedCredential] = useState<{ reference: string; credential: string } | null>(null);

  const cylinders = useIdentityRecords("cylinders", async () => {
    const { data, error } = await supabase
      .from("lpg_cylinders")
      .select("id,public_reference,cylinder_identifier,size_kg,max_capacity_kg,status,condition_status,tag_status,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(250);
    if (error) throw error;
    return (data ?? []) as PlatformRecord[];
  });

  const tags = useIdentityRecords("tags", async () => {
    const { data, error } = await supabase
      .from("lpg_cylinder_tags")
      .select("id,cylinder_id,public_tag_reference,tag_type,status,assigned_driver_profile_id,issued_at,bound_at,revoked_at,revocation_reason,replaces_tag_id,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(250);
    if (error) throw error;
    return (data ?? []) as PlatformRecord[];
  });

  const history = useIdentityRecords("history", async () => {
    const { data, error } = await supabase
      .from("lpg_cylinder_tag_history")
      .select("id,tag_id,cylinder_id,lpg_order_id,driver_profile_id,station_branch_id,event_type,from_status,to_status,reason,actor_user_id,created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw error;
    return (data ?? []) as PlatformRecord[];
  });

  const drivers = useIdentityRecords("drivers", async () => {
    const { data, error } = await supabase
      .from("driver_profiles")
      .select("id,user_id,public_driver_id,driver_display_name,operational_status,verification_status,created_at")
      .order("created_at", { ascending: false })
      .limit(250);
    if (error) throw error;
    return (data ?? []) as PlatformRecord[];
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const idempotencyKey = `admin-cylinder-tag:${action}:${crypto.randomUUID()}`;
      setIssuedCredential(null);

      if (action === "issue") {
        const { data, error } = await supabase.rpc("issue_lpg_cylinder_tag", {
          target_tag_type: tagType,
          target_assigned_driver_profile_id: cleanUuid(driverProfileId),
          target_metadata: { source: "admin.cylinder_identity" },
        });
        if (error) throw error;
        const payload = asRecord(data);
        const reference = recordString(payload, "publicTagReference");
        const credential = recordString(payload, "credential");
        if (!reference || !credential) throw new Error("The tag was issued, but its printable credential was not returned.");
        return { message: `Tag ${reference} issued.`, issued: { reference, credential } };
      }

      if (action === "assign") {
        requireText(tagReference, "Tag reference");
        requireText(driverProfileId, "Driver profile ID");
        const { error } = await supabase.rpc("assign_lpg_cylinder_tag_to_driver", {
          target_public_tag_reference: tagReference.trim().toUpperCase(),
          target_driver_profile_id: driverProfileId.trim(),
          target_idempotency_key: idempotencyKey,
          target_metadata: { source: "admin.cylinder_identity" },
        });
        if (error) throw error;
        return { message: `Tag ${tagReference.trim().toUpperCase()} assigned to the driver.` };
      }

      if (action === "bind") {
        requireText(tagReference, "Tag reference");
        requireText(cylinderId, "Cylinder ID");
        const { error } = await supabase.rpc("bind_lpg_cylinder_tag", {
          target_public_tag_reference: tagReference.trim().toUpperCase(),
          target_cylinder_id: cylinderId.trim(),
          target_idempotency_key: idempotencyKey,
          target_lpg_order_id: cleanUuid(orderId),
          target_metadata: { source: "admin.cylinder_identity" },
        });
        if (error) throw error;
        return { message: `Tag ${tagReference.trim().toUpperCase()} bound to the cylinder.` };
      }

      if (action === "damaged" || action === "lost") {
        requireText(tagReference, "Tag reference");
        const { error } = await supabase.rpc("report_lpg_cylinder_tag_condition", {
          target_public_tag_reference: tagReference.trim().toUpperCase(),
          target_condition: action,
          target_idempotency_key: idempotencyKey,
          target_reason: reason.trim() || `Reported ${action} by an administrator`,
          target_lpg_order_id: cleanUuid(orderId),
          target_metadata: { source: "admin.cylinder_identity" },
        });
        if (error) throw error;
        return { message: `Tag ${tagReference.trim().toUpperCase()} marked ${action}.` };
      }

      if (action === "replace") {
        requireText(tagReference, "Current tag reference");
        requireText(replacementTagReference, "Replacement tag reference");
        requireText(cylinderId, "Cylinder ID");
        const { error } = await supabase.rpc("replace_lpg_cylinder_tag", {
          target_old_tag_reference: tagReference.trim().toUpperCase(),
          target_new_tag_reference: replacementTagReference.trim().toUpperCase(),
          target_cylinder_id: cylinderId.trim(),
          target_idempotency_key: idempotencyKey,
          target_lpg_order_id: cleanUuid(orderId),
          target_reason: reason.trim() || "physical_tag_replacement",
          target_metadata: { source: "admin.cylinder_identity" },
        });
        if (error) throw error;
        return { message: `Cylinder kept its identity and now uses ${replacementTagReference.trim().toUpperCase()}.` };
      }

      requireText(tagReference, "Tag reference");
      requireText(reason, "Revocation reason");
      const { error } = await supabase.rpc("revoke_lpg_cylinder_tag", {
        target_public_tag_reference: tagReference.trim().toUpperCase(),
        target_idempotency_key: idempotencyKey,
        target_reason: reason.trim(),
        target_metadata: { source: "admin.cylinder_identity" },
      });
      if (error) throw error;
      return { message: `Tag ${tagReference.trim().toUpperCase()} revoked.` };
    },
    onSuccess: async (result) => {
      setNotice(result.message);
      setIssuedCredential(result.issued ?? null);
      await queryClient.invalidateQueries({ queryKey: ["admin-cylinder-identity"] });
    },
  });

  const activeTags = (tags.data ?? []).filter((record) => recordString(record, "status") === "active").length;
  const untagged = (cylinders.data ?? []).filter((record) => recordString(record, "tag_status") === "untagged").length;
  const replacements = (cylinders.data ?? []).filter((record) =>
    ["tag_damaged", "tag_lost", "replacement_pending"].includes(recordString(record, "tag_status") ?? ""),
  ).length;

  const dataByTab = { cylinders, tags, history } as const;
  const activeQuery = dataByTab[activeTab];
  const columns = useMemo(() => buildColumns(activeTab), [activeTab]);
  const driverOptions = [
    { label: "Unassigned", value: "" },
    ...(drivers.data ?? []).map((driver) => ({
      value: recordString(driver, "id") ?? "",
      label: [
        recordString(driver, "driver_display_name"),
        recordString(driver, "public_driver_id"),
        recordString(driver, "verification_status"),
        recordString(driver, "operational_status"),
      ].filter(Boolean).join(" · ") || recordString(driver, "id") || "Driver",
    })).filter((option) => option.value),
  ];

  const refreshAll = async () => {
    setNotice(null);
    await queryClient.invalidateQueries({ queryKey: ["admin-cylinder-identity"] });
  };

  return (
    <section className="sk-panel admin-system-console" aria-labelledby="cylinder-identity-title">
      <div className="sk-panel__header">
        <div>
          <p className="admin-section-kicker">LPG custody control</p>
          <h2 id="cylinder-identity-title">Cylinder identity</h2>
          <p>
            Govern permanent cylinder IDs and physical SKIMA tags. Replacing a damaged or lost tag never creates a new cylinder identity.
          </p>
        </div>
        <Button icon={RefreshCcw} variant="outline" onClick={() => void refreshAll()}>Refresh</Button>
      </div>

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Registered cylinders" value={(cylinders.data ?? []).length} icon={PackageCheck} />
        <MetricTile label="Untagged" value={untagged} icon={Tag} tone={untagged ? "warning" : "success"} />
        <MetricTile label="Active physical tags" value={activeTags} icon={ShieldCheck} tone="success" />
        <MetricTile label="Need tag attention" value={replacements} icon={History} tone={replacements ? "warning" : "neutral"} />
      </section>

      <div className="skima-resource-tabs" role="tablist" aria-label="Cylinder identity records">
        {identityTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={activeTab === tab.key ? "is-active" : undefined}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeQuery.isLoading
        ? <LoadingState label={`Loading ${activeTab}`} />
        : activeQuery.error
        ? <ErrorState title="Cylinder identity records unavailable" message={readError(activeQuery.error)} onRetry={() => void activeQuery.refetch()} />
        : (
          <DataTable
            caption={identityTabs.find((tab) => tab.key === activeTab)?.label ?? activeTab}
            columns={columns}
            records={activeQuery.data ?? []}
            getRowKey={(record) => recordString(record, "id") ?? JSON.stringify(record)}
            emptyTitle={`No ${normalizeStatusLabel(activeTab).toLowerCase()}`}
            emptyMessage="No records have been created in this area yet."
          />
        )}

      <div className="sk-panel__header">
        <div>
          <p className="admin-section-kicker">Controlled tag operation</p>
          <h3>Physical tag control</h3>
          <p>Every action is permission checked by Supabase and written to the tag audit history.</p>
        </div>
      </div>

      <div className="skima-form">
        <SelectInput
          label="Action"
          name="tag-action"
          value={action}
          options={tagActions}
          onChange={(event) => {
            setAction(event.currentTarget.value as TagAction);
            setNotice(null);
            setIssuedCredential(null);
          }}
        />

        {action === "issue" ? (
          <>
            <SelectInput label="Tag type" name="tag-type" value={tagType} options={tagTypes} onChange={(event) => setTagType(event.currentTarget.value)} />
            <SelectInput
              label="Assign to driver (optional)"
              name="tag-driver"
              value={driverProfileId}
              options={driverOptions}
              onChange={(event) => setDriverProfileId(event.currentTarget.value)}
            />
          </>
        ) : null}

        {action !== "issue" ? (
          <TextInput
            label={action === "replace" ? "Current tag reference" : "Tag reference"}
            name="tag-reference"
            value={tagReference}
            placeholder="SKTAG-..."
            onChange={(event) => setTagReference(event.currentTarget.value)}
          />
        ) : null}

        {action === "assign" ? (
          <SelectInput
            label="Driver"
            name="assign-driver"
            value={driverProfileId}
            options={driverOptions}
            onChange={(event) => setDriverProfileId(event.currentTarget.value)}
          />
        ) : null}

        {action === "bind" || action === "replace" ? (
          <TextInput label="Cylinder UUID" name="cylinder-id" value={cylinderId} onChange={(event) => setCylinderId(event.currentTarget.value)} />
        ) : null}

        {action === "replace" ? (
          <TextInput
            label="Replacement tag reference"
            name="replacement-tag-reference"
            value={replacementTagReference}
            placeholder="SKTAG-..."
            onChange={(event) => setReplacementTagReference(event.currentTarget.value)}
          />
        ) : null}

        {["bind", "damaged", "lost", "replace"].includes(action) ? (
          <TextInput
            label="LPG order UUID (optional)"
            name="tag-order-id"
            value={orderId}
            helperText="Use only when the physical tag operation is being performed during an active LPG job."
            onChange={(event) => setOrderId(event.currentTarget.value)}
          />
        ) : null}

        {["damaged", "lost", "replace", "revoke"].includes(action) ? (
          <TextInput
            label={action === "revoke" ? "Reason" : "Reason (optional)"}
            name="tag-reason"
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
        ) : null}

        <Button
          icon={ShieldCheck}
          isLoading={mutation.isPending}
          requiredPermission="lpg.cylinders.manage"
          onClick={() => {
            setNotice(null);
            mutation.mutate();
          }}
        >
          Run controlled action
        </Button>
      </div>

      {notice ? <div className="admin-notice" role="status">{notice}</div> : null}
      {mutation.error ? <div className="admin-notice is-error" role="alert">{readError(mutation.error)}</div> : null}
      {issuedCredential ? (
        <div className="admin-notice" role="status">
          <strong>{issuedCredential.reference}</strong>
          <div>Printable credential: <code>{issuedCredential.credential}</code></div>
          <small>This credential is shown at issuance time. Print/encode it on the controlled SKIMA tag; the database stores only its hash.</small>
        </div>
      ) : null}
    </section>
  );

  function useIdentityRecords(key: string, queryFn: () => Promise<PlatformRecord[]>) {
    return useQuery({
      queryKey: ["admin-cylinder-identity", key],
      queryFn,
      enabled: status === "authenticated",
    });
  }
}

function buildColumns(tab: IdentityTab): TableColumn<PlatformRecord>[] {
  const keys: readonly string[] = tab === "cylinders"
    ? ["public_reference", "cylinder_identifier", "size_kg", "status", "condition_status", "tag_status", "created_at"]
    : tab === "tags"
    ? ["public_tag_reference", "tag_type", "status", "cylinder_id", "assigned_driver_profile_id", "bound_at", "revoked_at"]
    : ["event_type", "tag_id", "cylinder_id", "from_status", "to_status", "reason", "created_at"];

  return keys.map((key) => ({
    key,
    header: normalizeStatusLabel(key),
    render: (record) => renderValue(key, record[key]),
  }));
}

function renderValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "string") {
    if (key === "status" || key.endsWith("_status") || key === "event_type") {
      return <StatusBadge tone={statusTone(value)}>{normalizeStatusLabel(value)}</StatusBadge>;
    }
    if (key.endsWith("_at")) return formatDate(value);
    return value.length > 64 ? `${value.slice(0, 61)}...` : value;
  }
  return String(value);
}

function statusTone(value: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (["active", "tagged", "verified", "approved", "bound", "issued"].includes(value)) return "success";
  if (["untagged", "tag_pending", "replacement_pending", "damaged", "tag_damaged", "assigned"].includes(value)) return "warning";
  if (["lost", "tag_lost", "revoked", "destroyed", "unsafe", "retired"].includes(value)) return "danger";
  if (["replaced"].includes(value)) return "info";
  return "neutral";
}

function asRecord(value: unknown): PlatformRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as PlatformRecord : {};
}

function recordString(record: PlatformRecord | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function cleanUuid(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function requireText(value: string, label: string) {
  if (!value.trim()) throw new Error(`${label} is required.`);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be completed.";
}