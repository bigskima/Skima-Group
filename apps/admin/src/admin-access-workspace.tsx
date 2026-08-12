import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CheckCircle2,
  Crown,
  KeyRound,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  UserCog,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { createClientIdempotencyKey, normalizeStatusLabel } from "@skima/frontend-core";
import {
  Button,
  CheckboxField,
  DataTable,
  Dialog,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  SelectInput,
  StatusBadge,
  type TableColumn,
  TextAreaInput,
  TextInput,
} from "@skima/ui";

import { useSessionState } from "./session";
import "./admin-access-workspace.css";

const PermissionSchema = z.object({
  id: z.string().optional(),
  key: z.string(),
  description: z.string().nullable().optional(),
  risk_level: z.string().optional(),
}).passthrough();

const RoleTemplateSchema = z.object({
  id: z.string(),
  role_id: z.string().nullable().optional(),
  key: z.string(),
  display_name: z.string(),
  description: z.string().nullable().optional(),
  permission_keys: z.array(z.string()),
  status: z.string(),
  is_system: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
}).passthrough();

const AdminSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  primary_role_id: z.string().nullable().optional(),
  admin_kind: z.string(),
  title: z.string().nullable().optional(),
  status: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
}).passthrough();

const ProfileSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  status: z.string(),
  created_at: z.string().optional(),
}).passthrough();

const PermissionArraySchema = z.array(PermissionSchema);
const RoleTemplateArraySchema = z.array(RoleTemplateSchema);
const AdminArraySchema = z.array(AdminSchema);
const ProfileArraySchema = z.array(ProfileSchema);
const MutationResponseSchema = z.unknown();

type PermissionRecord = z.infer<typeof PermissionSchema>;
type RoleTemplate = z.infer<typeof RoleTemplateSchema>;
type AdminRecord = z.infer<typeof AdminSchema>;
type ProfileRecord = z.infer<typeof ProfileSchema>;

type AccessDialog =
  | { readonly type: "assign"; readonly admin?: AdminRecord }
  | { readonly type: "role"; readonly role?: RoleTemplate }
  | { readonly type: "account"; readonly admin: AdminRecord }
  | { readonly type: "revoke"; readonly admin: AdminRecord };

interface NoticeState {
  readonly tone: "success" | "danger";
  readonly message: string;
}

const ADMIN_MANAGEMENT_PERMISSION = "platform.admins.super_manage";
const USER_MANAGEMENT_PERMISSION = "platform.users.manage";

export function AdminAccessWorkspace() {
  const { api, context, status } = useSessionState();
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState<"team" | "roles">("team");
  const [dialog, setDialog] = useState<AccessDialog | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [teamSearch, setTeamSearch] = useState("");
  const [selectedRoleKey, setSelectedRoleKey] = useState<string | null>(null);

  const adminsQuery = useQuery({
    queryKey: ["admin-access", "admins"],
    queryFn: () => api.get("/admin/users", AdminArraySchema),
    enabled: status === "authenticated",
  });
  const rolesQuery = useQuery({
    queryKey: ["admin-access", "roles"],
    queryFn: () => api.get("/admin/role-templates", RoleTemplateArraySchema),
    enabled: status === "authenticated",
  });
  const profilesQuery = useQuery({
    queryKey: ["admin-access", "profiles"],
    queryFn: () => api.get("/admin/profiles", ProfileArraySchema),
    enabled: status === "authenticated",
  });
  const permissionsQuery = useQuery({
    queryKey: ["admin-access", "permissions"],
    queryFn: () => api.get("/admin/permissions", PermissionArraySchema),
    enabled: status === "authenticated",
    retry: false,
  });

  const admins = adminsQuery.data ?? [];
  const roles = rolesQuery.data ?? [];
  const profiles = profilesQuery.data ?? [];
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );
  const roleById = useMemo(
    () => new Map(roles.flatMap((role) => role.role_id ? [[role.role_id, role] as const] : [])),
    [roles],
  );
  const permissions = useMemo(
    () => mergePermissionCatalog(permissionsQuery.data ?? [], roles),
    [permissionsQuery.data, roles],
  );

  useEffect(() => {
    if (selectedRoleKey && roles.some((role) => role.key === selectedRoleKey)) {
      return;
    }

    setSelectedRoleKey(roles.find((role) => role.status === "active")?.key ?? roles[0]?.key ?? null);
  }, [roles, selectedRoleKey]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin-access"] });
  const closeDialog = () => setDialog(null);

  if (adminsQuery.isLoading || rolesQuery.isLoading) {
    return <LoadingState label="Loading administrator access" />;
  }

  if (adminsQuery.error || rolesQuery.error) {
    return (
      <ErrorState
        title="Administrator access is unavailable"
        message={readErrorMessage(adminsQuery.error ?? rolesQuery.error)}
        onRetry={refresh}
      />
    );
  }

  const activeAdmins = admins.filter((admin) => admin.status === "active");
  const ownerCount = activeAdmins.filter((admin) => admin.admin_kind === "super_admin").length;
  const delegatedCount = activeAdmins.length - ownerCount;
  const activeRoles = roles.filter((role) => role.status === "active");

  return (
    <>
      <PageHeader
        eyebrow="People & authority"
        title="Administrator access"
        description="Delegate company and platform responsibilities through governed roles, with every assignment enforced by backend permissions."
        actions={
          <>
            <Button icon={RefreshCcw} variant="outline" onClick={refresh}>Refresh</Button>
            <Button
              icon={UserPlus}
              requiredPermission={ADMIN_MANAGEMENT_PERMISSION}
              onClick={() => setDialog({ type: "assign" })}
            >
              Add administrator
            </Button>
          </>
        }
      />

      {notice
        ? (
          <div className={`skima-access-notice is-${notice.tone}`} role="status">
            {notice.tone === "success" ? <CheckCircle2 /> : <Ban />}
            <span>{notice.message}</span>
            <button type="button" onClick={() => setNotice(null)}>Dismiss</button>
          </div>
        )
        : null}

      <section className="skima-access-owner-note">
        <span className="skima-access-owner-note__icon"><Crown /></span>
        <div>
          <strong>Protected ownership, delegated operations</strong>
          <p>
            One platform owner remains protected for recovery and highest-risk control. There is no
            limit on role-based administrators for company, operations, finance, support, content,
            security, or infrastructure work.
          </p>
        </div>
        <StatusBadge tone={ownerCount === 1 ? "success" : "warning"}>
          {ownerCount === 1 ? "Owner protected" : `${ownerCount} active owners`}
        </StatusBadge>
      </section>

      <section className="skima-grid skima-access-metrics">
        <MetricTile label="Active administrators" value={activeAdmins.length} icon={UsersRound} />
        <MetricTile label="Delegated operators" value={delegatedCount} icon={UserCog} tone="info" />
        <MetricTile label="Active role templates" value={activeRoles.length} icon={ShieldCheck} tone="success" />
        <MetricTile label="Permission catalog" value={permissions.length} icon={KeyRound} tone="warning" />
      </section>

      <div className="skima-access-switcher" role="tablist" aria-label="Access views">
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "team"}
          className={activeView === "team" ? "is-active" : undefined}
          onClick={() => setActiveView("team")}
        >
          <UsersRound /> Administrator team <span>{admins.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "roles"}
          className={activeView === "roles" ? "is-active" : undefined}
          onClick={() => setActiveView("roles")}
        >
          <ShieldCheck /> Roles & permissions <span>{roles.length}</span>
        </button>
      </div>

      {activeView === "team"
        ? (
          <AdministratorTeam
            admins={admins}
            profileById={profileById}
            roleById={roleById}
            currentUserId={context?.user.id ?? null}
            search={teamSearch}
            onSearch={setTeamSearch}
            onAssign={() => setDialog({ type: "assign" })}
            onEdit={(admin) => setDialog({ type: "assign", admin })}
            onAccount={(admin) => setDialog({ type: "account", admin })}
            onRevoke={(admin) => setDialog({ type: "revoke", admin })}
          />
        )
        : (
          <RoleDirectory
            roles={roles}
            permissions={permissions}
            admins={admins}
            selectedRoleKey={selectedRoleKey}
            onSelectRole={setSelectedRoleKey}
            onCreate={() => setDialog({ type: "role" })}
            onEdit={(role) => setDialog({ type: "role", role })}
          />
        )}

      <AssignAdministratorDialog
        state={dialog?.type === "assign" ? dialog : null}
        roles={activeRoles}
        profiles={profiles}
        roleById={roleById}
        onClose={closeDialog}
        onComplete={(message) => {
          setNotice({ tone: "success", message });
          closeDialog();
        }}
      />
      <RoleEditorDialog
        state={dialog?.type === "role" ? dialog : null}
        permissions={permissions}
        permissionCatalogAvailable={!permissionsQuery.error}
        onClose={closeDialog}
        onComplete={(message) => {
          setNotice({ tone: "success", message });
          closeDialog();
        }}
      />
      <AccountStatusDialog
        state={dialog?.type === "account" ? dialog : null}
        profile={dialog?.type === "account" ? profileById.get(dialog.admin.user_id) : undefined}
        onClose={closeDialog}
        onComplete={(message) => {
          setNotice({ tone: "success", message });
          closeDialog();
        }}
      />
      <RevokeAdministratorDialog
        state={dialog?.type === "revoke" ? dialog : null}
        profile={dialog?.type === "revoke" ? profileById.get(dialog.admin.user_id) : undefined}
        onClose={closeDialog}
        onComplete={(message) => {
          setNotice({ tone: "success", message });
          closeDialog();
        }}
      />
    </>
  );
}

function AdministratorTeam(props: {
  readonly admins: readonly AdminRecord[];
  readonly profileById: ReadonlyMap<string, ProfileRecord>;
  readonly roleById: ReadonlyMap<string, RoleTemplate>;
  readonly currentUserId: string | null;
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly onAssign: () => void;
  readonly onEdit: (admin: AdminRecord) => void;
  readonly onAccount: (admin: AdminRecord) => void;
  readonly onRevoke: (admin: AdminRecord) => void;
}) {
  const normalizedSearch = props.search.trim().toLowerCase();
  const records = props.admins.filter((admin) => {
    if (!normalizedSearch) return true;
    const profile = props.profileById.get(admin.user_id);
    const role = admin.primary_role_id ? props.roleById.get(admin.primary_role_id) : undefined;
    return [admin.user_id, admin.title, admin.status, profile?.display_name, role?.display_name, role?.key]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedSearch));
  });

  const columns = useMemo<TableColumn<AdminRecord>[]>(() => [
    {
      key: "administrator",
      header: "Administrator",
      minWidth: "240px",
      render: (admin) => {
        const profile = props.profileById.get(admin.user_id);
        return (
          <div className="skima-access-person">
            <Avatar profile={profile} />
            <span>
              <strong>{profile?.display_name || "Platform administrator"}</strong>
              <small title={admin.user_id}>{shortIdentifier(admin.user_id)}</small>
            </span>
          </div>
        );
      },
    },
    {
      key: "responsibility",
      header: "Responsibility",
      minWidth: "210px",
      render: (admin) => {
        const role = admin.primary_role_id ? props.roleById.get(admin.primary_role_id) : undefined;
        return (
          <div className="skima-access-responsibility">
            <strong>{admin.title || role?.display_name || normalizeStatusLabel(admin.admin_kind)}</strong>
            <small>{role?.display_name ?? "Protected owner role"}</small>
          </div>
        );
      },
    },
    {
      key: "authority",
      header: "Authority",
      render: (admin) => admin.admin_kind === "super_admin"
        ? <StatusBadge tone="warning">Platform owner</StatusBadge>
        : <StatusBadge tone="info">Role delegated</StatusBadge>,
    },
    {
      key: "access",
      header: "Access",
      render: (admin) => {
        const profile = props.profileById.get(admin.user_id);
        return (
          <div className="skima-access-statuses">
            <StatusBadge tone={statusTone(admin.status)}>Admin {normalizeStatusLabel(admin.status)}</StatusBadge>
            {profile && profile.status !== "active"
              ? <StatusBadge tone={statusTone(profile.status)}>Account {normalizeStatusLabel(profile.status)}</StatusBadge>
              : null}
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "Controls",
      align: "right",
      minWidth: "260px",
      render: (admin) => {
        const isOwner = admin.admin_kind === "super_admin";
        const isSelf = admin.user_id === props.currentUserId;
        if (isOwner) return <span className="skima-access-protected"><Crown /> Protected</span>;
        return (
          <div className="skima-access-row-actions">
            <Button
              size="sm"
              variant="ghost"
              icon={Pencil}
              requiredPermission={ADMIN_MANAGEMENT_PERMISSION}
              onClick={() => props.onEdit(admin)}
            >
              Role
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={UserCog}
              requiredPermission={USER_MANAGEMENT_PERMISSION}
              disabled={isSelf}
              onClick={() => props.onAccount(admin)}
            >
              Account
            </Button>
            <Button
              size="sm"
              variant="ghost"
              requiredPermission={ADMIN_MANAGEMENT_PERMISSION}
              disabled={isSelf || admin.status === "revoked"}
              onClick={() => props.onRevoke(admin)}
            >
              Revoke
            </Button>
          </div>
        );
      },
    },
  ], [props]);

  return (
    <section className="sk-panel skima-access-team">
      <div className="skima-access-toolbar">
        <div>
          <h2>Administrator team</h2>
          <p>Each person receives one primary operating role. Update the template once to change its governed scope everywhere.</p>
        </div>
        <div className="skima-access-search">
          <Search aria-hidden="true" />
          <input
            aria-label="Search administrators"
            placeholder="Search team or role"
            value={props.search}
            onChange={(event) => props.onSearch(event.currentTarget.value)}
          />
        </div>
      </div>
      <DataTable
        caption="Platform administrators"
        columns={columns}
        records={records}
        getRowKey={(admin) => admin.id}
        emptyTitle={normalizedSearch ? "No matching administrator" : "No administrators yet"}
        emptyMessage={normalizedSearch
          ? "Try another name, identifier, title, or role."
          : "Assign a role-based administrator to delegate platform work."}
      />
      {props.admins.length === 0
        ? (
          <Button icon={UserPlus} requiredPermission={ADMIN_MANAGEMENT_PERMISSION} onClick={props.onAssign}>
            Add first administrator
          </Button>
        )
        : null}
    </section>
  );
}

function RoleDirectory(props: {
  readonly roles: readonly RoleTemplate[];
  readonly permissions: readonly PermissionRecord[];
  readonly admins: readonly AdminRecord[];
  readonly selectedRoleKey: string | null;
  readonly onSelectRole: (key: string) => void;
  readonly onCreate: () => void;
  readonly onEdit: (role: RoleTemplate) => void;
}) {
  const selectedRole = props.roles.find((role) => role.key === props.selectedRoleKey) ?? props.roles[0];
  const permissionByKey = new Map(props.permissions.map((permission) => [permission.key, permission]));
  const groupedPermissions = selectedRole
    ? groupPermissions(selectedRole.permission_keys.map((key) => permissionByKey.get(key) ?? { key }))
    : [];
  const assignedCount = selectedRole?.role_id
    ? props.admins.filter((admin) => admin.primary_role_id === selectedRole.role_id && admin.status === "active").length
    : 0;

  return (
    <section className="skima-access-role-layout">
      <aside className="sk-panel skima-access-role-list">
        <div className="skima-access-toolbar">
          <div>
            <h2>Role templates</h2>
            <p>Reusable authority sets</p>
          </div>
          <Button
            size="sm"
            icon={Plus}
            requiredPermission={ADMIN_MANAGEMENT_PERMISSION}
            onClick={props.onCreate}
          >
            New role
          </Button>
        </div>
        <div className="skima-access-role-options" role="listbox" aria-label="Administrator roles">
          {props.roles.map((role) => {
            const count = role.role_id
              ? props.admins.filter((admin) => admin.primary_role_id === role.role_id && admin.status === "active").length
              : 0;
            return (
              <button
                key={role.key}
                type="button"
                role="option"
                aria-selected={role.key === selectedRole?.key}
                className={role.key === selectedRole?.key ? "is-active" : undefined}
                onClick={() => props.onSelectRole(role.key)}
              >
                <span className="skima-access-role-icon">
                  {role.key === "platform.super_admin" ? <Crown /> : <ShieldCheck />}
                </span>
                <span>
                  <strong>{role.display_name}</strong>
                  <small>{role.permission_keys.length} permissions · {count} assigned</small>
                </span>
                <StatusBadge tone={statusTone(role.status)}>{normalizeStatusLabel(role.status)}</StatusBadge>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="sk-panel skima-access-role-detail">
        {selectedRole
          ? (
            <>
              <header className="skima-access-role-heading">
                <div>
                  <div className="skima-access-role-kicker">
                    <StatusBadge tone={selectedRole.is_system ? "info" : "neutral"}>
                      {selectedRole.is_system ? "System template" : "Custom template"}
                    </StatusBadge>
                    <span>{selectedRole.key}</span>
                  </div>
                  <h2>{selectedRole.display_name}</h2>
                  <p>{selectedRole.description || "No role description has been added."}</p>
                </div>
                {selectedRole.key === "platform.super_admin"
                  ? <span className="skima-access-protected"><Crown /> Deployment protected</span>
                  : (
                    <Button
                      icon={Pencil}
                      variant="outline"
                      requiredPermission={ADMIN_MANAGEMENT_PERMISSION}
                      onClick={() => props.onEdit(selectedRole)}
                    >
                      Edit role
                    </Button>
                  )}
              </header>
              <div className="skima-access-role-facts">
                <div><span>Assigned administrators</span><strong>{assignedCount}</strong></div>
                <div><span>Granted permissions</span><strong>{selectedRole.permission_keys.length}</strong></div>
                <div><span>Template state</span><strong>{normalizeStatusLabel(selectedRole.status)}</strong></div>
              </div>
              <div className="skima-access-scope-heading">
                <div>
                  <h3>Authority scope</h3>
                  <p>Permissions are grouped by platform engine so the role is easy to review.</p>
                </div>
              </div>
              {groupedPermissions.length > 0
                ? (
                  <div className="skima-access-permission-groups">
                    {groupedPermissions.map((group) => (
                      <section key={group.key}>
                        <header>
                          <span>{group.label}</span>
                          <StatusBadge>{group.permissions.length}</StatusBadge>
                        </header>
                        <div>
                          {group.permissions.map((permission) => (
                            <span className="skima-access-permission" key={permission.key}>
                              <KeyRound />
                              <span>
                                <strong>{permissionAction(permission.key)}</strong>
                                <small>{permission.description || permission.key}</small>
                              </span>
                              {permission.risk_level === "critical" || permission.risk_level === "high"
                                ? <StatusBadge tone={permission.risk_level === "critical" ? "danger" : "warning"}>{permission.risk_level}</StatusBadge>
                                : null}
                            </span>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )
                : <p className="skima-access-empty">This role does not grant any permissions yet.</p>}
            </>
          )
          : <p className="skima-access-empty">Create a role template to begin delegating authority.</p>}
      </section>
    </section>
  );
}

function AssignAdministratorDialog(props: {
  readonly state: Extract<AccessDialog, { type: "assign" }> | null;
  readonly roles: readonly RoleTemplate[];
  readonly profiles: readonly ProfileRecord[];
  readonly roleById: ReadonlyMap<string, RoleTemplate>;
  readonly onClose: () => void;
  readonly onComplete: (message: string) => void;
}) {
  const { api } = useSessionState();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [title, setTitle] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const state = props.state;

  useEffect(() => {
    const admin = state?.admin;
    setUserId(admin?.user_id ?? "");
    setRoleKey(admin?.primary_role_id ? props.roleById.get(admin.primary_role_id)?.key ?? "" : "");
    setTitle(admin?.title ?? "");
    setFormError(null);
  }, [state, props.roleById]);

  const mutation = useMutation({
    mutationFn: (payload: { readonly userId: string; readonly roleKey: string; readonly title?: string }) =>
      api.post("/admin/users", payload, MutationResponseSchema),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-access"] });
      props.onComplete(state?.admin ? "Administrator role updated." : "Administrator access assigned.");
    },
  });

  if (!state) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (!z.string().uuid().safeParse(userId.trim()).success) {
      setFormError("Choose a valid platform user ID.");
      return;
    }
    if (!roleKey) {
      setFormError("Choose an active administrator role.");
      return;
    }
    mutation.mutate({ userId: userId.trim(), roleKey, ...(title.trim() ? { title: title.trim() } : {}) });
  };

  const matchedProfile = props.profiles.find((profile) => profile.id === userId.trim());

  return (
    <Dialog
      title={state.admin ? "Update administrator role" : "Add role-based administrator"}
      isOpen
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" disabled={mutation.isPending} onClick={props.onClose}>Cancel</Button>
          <Button type="submit" form="assign-administrator-form" isLoading={mutation.isPending} icon={UserPlus}>
            {state.admin ? "Save assignment" : "Grant access"}
          </Button>
        </>
      }
    >
      <form id="assign-administrator-form" className="skima-form-grid" onSubmit={submit}>
        <div className="skima-access-dialog-intro">
          <ShieldCheck />
          <p>The selected role controls this administrator’s authority. Reassigning a person updates their operating scope immediately.</p>
        </div>
        <TextInput
          label="Platform user ID"
          helperText={matchedProfile
            ? `Matched account: ${matchedProfile.display_name || "Unnamed platform user"} (${normalizeStatusLabel(matchedProfile.status)})`
            : "Select an existing authenticated platform user."}
          value={userId}
          list="platform-profile-identifiers"
          disabled={Boolean(state.admin)}
          required
          onChange={(event) => setUserId(event.currentTarget.value)}
        />
        <datalist id="platform-profile-identifiers">
          {props.profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.display_name || profile.id}</option>
          ))}
        </datalist>
        <SelectInput
          label="Administrator role"
          helperText="Only active, delegated role templates can be assigned here."
          value={roleKey}
          options={[
            { label: "Choose a role", value: "" },
            ...props.roles
              .filter((role) => role.key !== "platform.super_admin")
              .map((role) => ({ label: role.display_name, value: role.key })),
          ]}
          required
          onChange={(event) => setRoleKey(event.currentTarget.value)}
        />
        <TextInput
          label="Position title"
          helperText="Shown in the admin workspace; it does not add permissions."
          placeholder="For example, Head of Operations"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
        {formError ? <StatusBadge tone="danger">{formError}</StatusBadge> : null}
        {mutation.error ? <StatusBadge tone="danger">{readErrorMessage(mutation.error)}</StatusBadge> : null}
      </form>
    </Dialog>
  );
}

function RoleEditorDialog(props: {
  readonly state: Extract<AccessDialog, { type: "role" }> | null;
  readonly permissions: readonly PermissionRecord[];
  readonly permissionCatalogAvailable: boolean;
  readonly onClose: () => void;
  readonly onComplete: (message: string) => void;
}) {
  const { api } = useSessionState();
  const queryClient = useQueryClient();
  const [roleKey, setRoleKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [roleStatus, setRoleStatus] = useState("active");
  const [selectedPermissions, setSelectedPermissions] = useState<ReadonlySet<string>>(new Set());
  const [permissionSearch, setPermissionSearch] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const state = props.state;

  useEffect(() => {
    const role = state?.role;
    setRoleKey(role?.key ?? "platform.");
    setDisplayName(role?.display_name ?? "");
    setDescription(role?.description ?? "");
    setRoleStatus(role?.status ?? "active");
    setSelectedPermissions(new Set(role?.permission_keys ?? []));
    setPermissionSearch("");
    setFormError(null);
  }, [state]);

  const mutation = useMutation({
    mutationFn: (payload: Readonly<Record<string, unknown>>) =>
      api.post("/admin/role-templates", payload, MutationResponseSchema),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-access"] });
      props.onComplete(state?.role ? "Administrator role updated." : "Administrator role created.");
    },
  });

  if (!state) return null;

  const normalizedSearch = permissionSearch.trim().toLowerCase();
  const visiblePermissions = props.permissions.filter((permission) =>
    !normalizedSearch || [permission.key, permission.description]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedSearch))
  );
  const groups = groupPermissions(visiblePermissions);

  const togglePermission = (key: string, checked: boolean) => {
    setSelectedPermissions((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleGroup = (keys: readonly string[]) => {
    const allSelected = keys.every((key) => selectedPermissions.has(key));
    setSelectedPermissions((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (allSelected) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const normalizedKey = roleKey.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_.:-]{2,120}$/.test(normalizedKey)) {
      setFormError("Use a valid role key such as platform.finance_lead.");
      return;
    }
    if (!displayName.trim()) {
      setFormError("Enter a role name.");
      return;
    }
    if (selectedPermissions.size === 0) {
      setFormError("Select at least one permission for this role.");
      return;
    }
    mutation.mutate({
      roleKey: normalizedKey,
      displayName: displayName.trim(),
      description: description.trim() || undefined,
      permissionKeys: Array.from(selectedPermissions).sort(),
      status: roleStatus,
      metadata: {
        ...(state.role?.metadata ?? {}),
        category: readRoleCategory(normalizedKey),
        managed_from: "admin_access_workspace",
      },
    });
  };

  return (
    <Dialog
      title={state.role ? "Edit administrator role" : "Create administrator role"}
      isOpen
      onClose={props.onClose}
      footer={
        <>
          <span className="skima-access-selection-count">{selectedPermissions.size} selected</span>
          <Button variant="ghost" disabled={mutation.isPending} onClick={props.onClose}>Cancel</Button>
          <Button type="submit" form="administrator-role-form" isLoading={mutation.isPending} icon={ShieldCheck}>
            {state.role ? "Save role" : "Create role"}
          </Button>
        </>
      }
    >
      <form id="administrator-role-form" className="skima-form-grid" onSubmit={submit}>
        <div className="skima-access-role-form-grid">
          <TextInput
            label="Role key"
            helperText="Stable configuration key; it cannot be changed after creation."
            value={roleKey}
            disabled={Boolean(state.role)}
            required
            onChange={(event) => setRoleKey(event.currentTarget.value)}
          />
          <TextInput
            label="Role name"
            placeholder="Finance Lead"
            value={displayName}
            required
            onChange={(event) => setDisplayName(event.currentTarget.value)}
          />
        </div>
        <TextAreaInput
          label="Responsibility summary"
          helperText="Explain what this role owns so assignments are easy to review."
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
        <SelectInput
          label="Template state"
          value={roleStatus}
          options={[
            { label: "Active — available for assignment", value: "active" },
            { label: "Draft — being prepared", value: "draft" },
            { label: "Retired — no new assignments", value: "retired" },
          ]}
          onChange={(event) => setRoleStatus(event.currentTarget.value)}
        />
        <div className="skima-access-permission-picker-heading">
          <div>
            <h3>Permission scope</h3>
            <p>Select explicit engine permissions. Position titles never grant authority.</p>
          </div>
          <div className="skima-access-search">
            <Search aria-hidden="true" />
            <input
              aria-label="Search permission catalog"
              placeholder="Search permissions"
              value={permissionSearch}
              onChange={(event) => setPermissionSearch(event.currentTarget.value)}
            />
          </div>
        </div>
        {!props.permissionCatalogAvailable
          ? <p className="skima-access-catalog-note">The live catalog is unavailable; showing permissions already used by existing roles.</p>
          : null}
        <div className="skima-access-permission-picker">
          {groups.map((group) => {
            const keys = group.permissions.map((permission) => permission.key);
            const allSelected = keys.every((key) => selectedPermissions.has(key));
            return (
              <section key={group.key}>
                <header>
                  <span><strong>{group.label}</strong><small>{keys.filter((key) => selectedPermissions.has(key)).length}/{keys.length} selected</small></span>
                  <Button size="sm" variant="ghost" onClick={() => toggleGroup(keys)}>
                    {allSelected ? "Clear group" : "Select group"}
                  </Button>
                </header>
                <div>
                  {group.permissions.map((permission) => (
                    <CheckboxField
                      key={permission.key}
                      id={`permission-${permission.key.replaceAll(".", "-")}`}
                      label={permissionAction(permission.key)}
                      helperText={permission.description || permission.key}
                      checked={selectedPermissions.has(permission.key)}
                      onChange={(event) => togglePermission(permission.key, event.currentTarget.checked)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        {formError ? <StatusBadge tone="danger">{formError}</StatusBadge> : null}
        {mutation.error ? <StatusBadge tone="danger">{readErrorMessage(mutation.error)}</StatusBadge> : null}
      </form>
    </Dialog>
  );
}

function AccountStatusDialog(props: {
  readonly state: Extract<AccessDialog, { type: "account" }> | null;
  readonly profile?: ProfileRecord;
  readonly onClose: () => void;
  readonly onComplete: (message: string) => void;
}) {
  const { api } = useSessionState();
  const queryClient = useQueryClient();
  const [nextStatus, setNextStatus] = useState("active");
  const [reason, setReason] = useState("");
  const state = props.state;

  useEffect(() => {
    setNextStatus(props.profile?.status ?? "active");
    setReason("");
  }, [state, props.profile]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!state) throw new Error("Choose an administrator account.");
      return api.post("/admin/profiles/status", {
        userId: state.admin.user_id,
        status: nextStatus,
        reason: reason.trim(),
        idempotencyKey: createClientIdempotencyKey("admin-account-status"),
      }, MutationResponseSchema);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-access"] });
      props.onComplete(`Account status changed to ${normalizeStatusLabel(nextStatus)}.`);
    },
  });

  if (!state) return null;
  const name = props.profile?.display_name || "this administrator";

  return (
    <Dialog
      title="Confirm account access change"
      isOpen
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" disabled={mutation.isPending} onClick={props.onClose}>Cancel</Button>
          <Button
            variant={nextStatus === "disabled" ? "destructive" : "primary"}
            isLoading={mutation.isPending}
            disabled={!reason.trim() || nextStatus === props.profile?.status}
            onClick={() => mutation.mutate()}
          >
            Confirm change
          </Button>
        </>
      }
    >
      <div className="skima-form-grid">
        <div className="skima-access-warning">
          <Ban />
          <p>This changes the complete platform account for <strong>{name}</strong>, not only the admin console. Disabled accounts lose access to every assigned workspace.</p>
        </div>
        <SelectInput
          label="New account status"
          value={nextStatus}
          options={[
            { label: "Active — sign-in allowed", value: "active" },
            { label: "Disabled — all access blocked", value: "disabled" },
            { label: "Pending — awaiting activation", value: "pending" },
          ]}
          onChange={(event) => setNextStatus(event.currentTarget.value)}
        />
        <TextAreaInput
          label="Reason for change"
          helperText="Required for the governed audit trail."
          value={reason}
          required
          onChange={(event) => setReason(event.currentTarget.value)}
        />
        {mutation.error ? <StatusBadge tone="danger">{readErrorMessage(mutation.error)}</StatusBadge> : null}
      </div>
    </Dialog>
  );
}

function RevokeAdministratorDialog(props: {
  readonly state: Extract<AccessDialog, { type: "revoke" }> | null;
  readonly profile?: ProfileRecord;
  readonly onClose: () => void;
  readonly onComplete: (message: string) => void;
}) {
  const { api } = useSessionState();
  const queryClient = useQueryClient();
  const state = props.state;
  const mutation = useMutation({
    mutationFn: () => {
      if (!state) throw new Error("Choose an administrator.");
      return api.post("/admin/users/revoke", { userId: state.admin.user_id }, MutationResponseSchema);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-access"] });
      props.onComplete("Administrator authority revoked.");
    },
  });

  if (!state) return null;
  const name = props.profile?.display_name || shortIdentifier(state.admin.user_id);

  return (
    <Dialog
      title="Revoke administrator authority?"
      isOpen
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" disabled={mutation.isPending} onClick={props.onClose}>Keep access</Button>
          <Button variant="destructive" isLoading={mutation.isPending} onClick={() => mutation.mutate()}>
            Revoke administrator
          </Button>
        </>
      }
    >
      <div className="skima-access-warning is-danger">
        <Ban />
        <p><strong>{name}</strong> will immediately lose administrator permissions. Their platform profile remains intact and can be assigned again later.</p>
      </div>
      {mutation.error ? <StatusBadge tone="danger">{readErrorMessage(mutation.error)}</StatusBadge> : null}
    </Dialog>
  );
}

function Avatar(props: { readonly profile?: ProfileRecord }) {
  if (props.profile?.avatar_url) {
    return <img className="skima-access-avatar" alt="" src={props.profile.avatar_url} />;
  }
  const initials = (props.profile?.display_name || "A")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return <span className="skima-access-avatar is-placeholder" aria-hidden="true">{initials}</span>;
}

interface PermissionGroup {
  readonly key: string;
  readonly label: string;
  readonly permissions: readonly PermissionRecord[];
}

function groupPermissions(permissions: readonly PermissionRecord[]): PermissionGroup[] {
  const groups = new Map<string, PermissionRecord[]>();
  for (const permission of [...permissions].sort((left, right) => left.key.localeCompare(right.key))) {
    const key = permission.key.split(".")[1] ?? "platform";
    const group = groups.get(key) ?? [];
    group.push(permission);
    groups.set(key, group);
  }
  return Array.from(groups, ([key, records]) => ({
    key,
    label: normalizeStatusLabel(key),
    permissions: records,
  }));
}

function mergePermissionCatalog(
  catalog: readonly PermissionRecord[],
  roles: readonly RoleTemplate[],
): PermissionRecord[] {
  const permissions = new Map(catalog.map((permission) => [permission.key, permission]));
  for (const role of roles) {
    for (const key of role.permission_keys) {
      if (!permissions.has(key)) permissions.set(key, { key });
    }
  }
  return Array.from(permissions.values()).sort((left, right) => left.key.localeCompare(right.key));
}

function permissionAction(key: string): string {
  const parts = key.split(".");
  return normalizeStatusLabel(parts.slice(2).join(" ") || parts.at(-1) || key);
}

function readRoleCategory(key: string): string {
  return key.split(".")[1]?.replaceAll("_", "-") || "general";
}

function shortIdentifier(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function statusTone(value: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (/active|approved|complete/i.test(value)) return "success";
  if (/disabled|revoked|retired|blocked|suspended/i.test(value)) return "danger";
  if (/pending|draft|review/i.test(value)) return "warning";
  return "neutral";
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The administrator action could not be completed.";
}
