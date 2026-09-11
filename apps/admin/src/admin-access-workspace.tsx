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

import { AdminWorkspaceSections } from "./admin-workspace-sections";
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

type AccessView = "team" | "roles";
type RoleEditorStep = "details" | "access";

interface NoticeState {
  readonly tone: "success" | "danger";
  readonly message: string;
}

const ADMIN_MANAGEMENT_PERMISSION = "platform.admins.super_manage";
const USER_MANAGEMENT_PERMISSION = "platform.users.manage";

export function AdminAccessWorkspace() {
  const { api, context, status } = useSessionState();
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState<AccessView>("team");
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
    if (selectedRoleKey && roles.some((role) => role.key === selectedRoleKey)) return;
    setSelectedRoleKey(roles.find((role) => role.status === "active")?.key ?? roles[0]?.key ?? null);
  }, [roles, selectedRoleKey]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin-access"] });
  const closeDialog = () => setDialog(null);

  if (adminsQuery.isLoading || rolesQuery.isLoading) {
    return <LoadingState label="Loading people and access" />;
  }

  if (adminsQuery.error || rolesQuery.error) {
    return (
      <ErrorState
        title="People and access is unavailable"
        message={readErrorMessage(adminsQuery.error ?? rolesQuery.error)}
        onRetry={refresh}
      />
    );
  }

  const activeAdmins = admins.filter((admin) => admin.status === "active");
  const ownerCount = activeAdmins.filter((admin) => admin.admin_kind === "super_admin").length;
  const teamAdminCount = activeAdmins.length - ownerCount;
  const activeRoles = roles.filter((role) => role.status === "active");

  return (
    <>
      <PageHeader
        eyebrow="Team access"
        title="People & Access"
        description="Choose who can use the admin workspace and what each person is allowed to do. Roles keep access consistent without exposing technical settings."
        actions={
          <>
            <Button icon={RefreshCcw} variant="outline" onClick={refresh}>Refresh</Button>
            <Button
              icon={UserPlus}
              requiredPermission={ADMIN_MANAGEMENT_PERMISSION}
              onClick={() => setDialog({ type: "assign" })}
            >
              Add admin
            </Button>
          </>
        }
      />

      {notice ? (
        <div className={`skima-access-notice is-${notice.tone}`} role="status">
          {notice.tone === "success" ? <CheckCircle2 /> : <Ban />}
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      ) : null}

      <section className="skima-access-owner-note">
        <span className="skima-access-owner-note__icon"><Crown /></span>
        <div>
          <strong>Owner account protection</strong>
          <p>
            The main owner account stays protected for recovery and sensitive changes. Add other admins
            for daily work and give each person only the access they need.
          </p>
        </div>
        <StatusBadge tone={ownerCount === 1 ? "success" : "warning"}>
          {ownerCount === 1 ? "Owner protected" : `${ownerCount} owner accounts active`}
        </StatusBadge>
      </section>

      <section className="skima-grid skima-access-metrics">
        <MetricTile label="Active admins" value={activeAdmins.length} icon={UsersRound} />
        <MetricTile label="Team admins" value={teamAdminCount} icon={UserCog} tone="info" />
        <MetricTile label="Active roles" value={activeRoles.length} icon={ShieldCheck} tone="success" />
        <MetricTile label="Available access rules" value={permissions.length} icon={KeyRound} tone="warning" />
      </section>

      <AdminWorkspaceSections
        compact
        label="People and access sections"
        activeKey={activeView}
        onChange={(key) => setActiveView(key as AccessView)}
        sections={[
          {
            key: "team",
            label: "Admin team",
            description: "People who can open the SKIMA admin workspace.",
            icon: UsersRound,
            badge: admins.length,
          },
          {
            key: "roles",
            label: "Roles & access",
            description: "Reusable access levels for different responsibilities.",
            icon: ShieldCheck,
            badge: roles.length,
          },
        ]}
      />

      {activeView === "team" ? (
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
      ) : (
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
    return [admin.user_id, admin.title, admin.status, profile?.display_name, role?.display_name]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedSearch));
  });

  const columns = useMemo<TableColumn<AdminRecord>[]>(() => [
    {
      key: "administrator",
      header: "Person",
      minWidth: "220px",
      render: (admin) => {
        const profile = props.profileById.get(admin.user_id);
        return (
          <div className="skima-access-person">
            <Avatar profile={profile} />
            <span>
              <strong>{profile?.display_name || "Administrator"}</strong>
              <small>{admin.title || "SKIMA admin"}</small>
            </span>
          </div>
        );
      },
    },
    {
      key: "responsibility",
      header: "Role",
      minWidth: "200px",
      render: (admin) => {
        const role = admin.primary_role_id ? props.roleById.get(admin.primary_role_id) : undefined;
        return (
          <div className="skima-access-responsibility">
            <strong>{role?.display_name || (admin.admin_kind === "super_admin" ? "Platform owner" : "Admin")}</strong>
            <small>{role?.description || "Access set by role"}</small>
          </div>
        );
      },
    },
    {
      key: "access-level",
      header: "Access level",
      render: (admin) => admin.admin_kind === "super_admin"
        ? <StatusBadge tone="warning">Owner</StatusBadge>
        : <StatusBadge tone="info">Team admin</StatusBadge>,
    },
    {
      key: "access",
      header: "Status",
      render: (admin) => {
        const profile = props.profileById.get(admin.user_id);
        return (
          <div className="skima-access-statuses">
            <StatusBadge tone={statusTone(admin.status)}>{friendlyStatus(admin.status)}</StatusBadge>
            {profile && profile.status !== "active" ? (
              <StatusBadge tone={statusTone(profile.status)}>Account {friendlyStatus(profile.status)}</StatusBadge>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      minWidth: "250px",
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
              Change role
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={UserCog}
              requiredPermission={USER_MANAGEMENT_PERMISSION}
              disabled={isSelf}
              onClick={() => props.onAccount(admin)}
            >
              Account status
            </Button>
            <Button
              size="sm"
              variant="ghost"
              requiredPermission={ADMIN_MANAGEMENT_PERMISSION}
              disabled={isSelf || admin.status === "revoked"}
              onClick={() => props.onRevoke(admin)}
            >
              Remove access
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
          <h2>Admin team</h2>
          <p>Give each person a role that matches the work they are responsible for.</p>
        </div>
        <div className="skima-access-search">
          <Search aria-hidden="true" />
          <input
            aria-label="Search admins"
            placeholder="Search people or roles"
            value={props.search}
            onChange={(event) => props.onSearch(event.currentTarget.value)}
          />
        </div>
      </div>
      <DataTable
        caption="SKIMA admin team"
        columns={columns}
        records={records}
        getRowKey={(admin) => admin.id}
        emptyTitle={normalizedSearch ? "No matching admin" : "No team admins yet"}
        emptyMessage={normalizedSearch
          ? "Try another name or role."
          : "Add an admin when you are ready to share responsibility for the platform."}
      />
      {props.admins.length === 0 ? (
        <Button icon={UserPlus} requiredPermission={ADMIN_MANAGEMENT_PERMISSION} onClick={props.onAssign}>
          Add first admin
        </Button>
      ) : null}
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
            <h2>Roles</h2>
            <p>Reusable access levels</p>
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
        <div className="skima-access-role-options" role="listbox" aria-label="Admin roles">
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
                  <small>{role.permission_keys.length} allowed actions · {count} people</small>
                </span>
                <StatusBadge tone={statusTone(role.status)}>{friendlyStatus(role.status)}</StatusBadge>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="sk-panel skima-access-role-detail">
        {selectedRole ? (
          <>
            <header className="skima-access-role-heading">
              <div>
                <div className="skima-access-role-kicker">
                  <StatusBadge tone={selectedRole.is_system ? "info" : "neutral"}>
                    {selectedRole.is_system ? "Built-in role" : "Custom role"}
                  </StatusBadge>
                </div>
                <h2>{selectedRole.display_name}</h2>
                <p>{selectedRole.description || "No role description has been added."}</p>
              </div>
              {selectedRole.key === "platform.super_admin" ? (
                <span className="skima-access-protected"><Crown /> Owner role protected</span>
              ) : (
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
              <div><span>People using this role</span><strong>{assignedCount}</strong></div>
              <div><span>Allowed actions</span><strong>{selectedRole.permission_keys.length}</strong></div>
              <div><span>Status</span><strong>{friendlyStatus(selectedRole.status)}</strong></div>
            </div>
            <div className="skima-access-scope-heading">
              <div>
                <h3>What this role can do</h3>
                <p>Access is grouped by work area so you can review it without reading technical permission names.</p>
              </div>
            </div>
            {groupedPermissions.length > 0 ? (
              <div className="skima-access-permission-groups">
                {groupedPermissions.map((group) => (
                  <section key={group.key}>
                    <header>
                      <span>{friendlyAccessArea(group.key)}</span>
                      <StatusBadge>{group.permissions.length}</StatusBadge>
                    </header>
                    <div>
                      {group.permissions.map((permission) => (
                        <span className="skima-access-permission" key={permission.key}>
                          <KeyRound />
                          <span>
                            <strong>{permissionAction(permission.key)}</strong>
                            <small>{permissionFriendlyDescription(permission, group.key)}</small>
                          </span>
                          {permission.risk_level === "critical" || permission.risk_level === "high" ? (
                            <StatusBadge tone={permission.risk_level === "critical" ? "danger" : "warning"}>
                              {permission.risk_level === "critical" ? "Sensitive" : "Higher access"}
                            </StatusBadge>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <p className="skima-access-empty">This role does not allow any admin actions yet.</p>
            )}
          </>
        ) : (
          <p className="skima-access-empty">Create a role to define what team admins can do.</p>
        )}
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
      props.onComplete(state?.admin ? "Admin role updated." : "Admin access added.");
    },
  });

  if (!state) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (!z.string().uuid().safeParse(userId.trim()).success) {
      setFormError("Choose a person from the list.");
      return;
    }
    if (!roleKey) {
      setFormError("Choose a role for this person.");
      return;
    }
    mutation.mutate({ userId: userId.trim(), roleKey, ...(title.trim() ? { title: title.trim() } : {}) });
  };

  return (
    <Dialog
      title={state.admin ? "Change admin role" : "Add admin"}
      isOpen
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" disabled={mutation.isPending} onClick={props.onClose}>Cancel</Button>
          <Button type="submit" form="assign-administrator-form" isLoading={mutation.isPending} icon={UserPlus}>
            {state.admin ? "Save role" : "Add admin"}
          </Button>
        </>
      }
    >
      <form id="assign-administrator-form" className="skima-form-grid" onSubmit={submit}>
        <div className="skima-access-dialog-intro">
          <ShieldCheck />
          <p>Choose a person and a role. The role decides which admin areas and actions this person can use.</p>
        </div>
        <SelectInput
          label="Person"
          helperText={state.admin ? "The person cannot be changed while editing an existing admin." : "Choose an existing SKIMA account."}
          value={userId}
          disabled={Boolean(state.admin)}
          options={[
            { label: "Choose a person", value: "" },
            ...props.profiles.map((profile) => ({
              label: `${profile.display_name || "Unnamed account"}${profile.status !== "active" ? ` — ${friendlyStatus(profile.status)}` : ""}`,
              value: profile.id,
            })),
          ]}
          required
          onChange={(event) => setUserId(event.currentTarget.value)}
        />
        <SelectInput
          label="Role"
          helperText="Choose the set of admin actions this person needs for their work."
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
          label="Job title (optional)"
          helperText="This is only a display label and does not change the person's access."
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
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [roleStatus, setRoleStatus] = useState("active");
  const [selectedPermissions, setSelectedPermissions] = useState<ReadonlySet<string>>(new Set());
  const [permissionSearch, setPermissionSearch] = useState("");
  const [step, setStep] = useState<RoleEditorStep>("details");
  const [formError, setFormError] = useState<string | null>(null);
  const state = props.state;

  useEffect(() => {
    const role = state?.role;
    setDisplayName(role?.display_name ?? "");
    setDescription(role?.description ?? "");
    setRoleStatus(role?.status ?? "active");
    setSelectedPermissions(new Set(role?.permission_keys ?? []));
    setPermissionSearch("");
    setStep("details");
    setFormError(null);
  }, [state]);

  const mutation = useMutation({
    mutationFn: (payload: Readonly<Record<string, unknown>>) =>
      api.post("/admin/role-templates", payload, MutationResponseSchema),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-access"] });
      props.onComplete(state?.role ? "Role updated." : "Role created.");
    },
  });

  if (!state) return null;

  const normalizedSearch = permissionSearch.trim().toLowerCase();
  const visiblePermissions = props.permissions.filter((permission) =>
    !normalizedSearch || [permission.key, permission.description, permissionAction(permission.key)]
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
    if (!displayName.trim()) {
      setFormError("Enter a role name.");
      setStep("details");
      return;
    }
    if (selectedPermissions.size === 0) {
      setFormError("Choose at least one allowed action for this role.");
      setStep("access");
      return;
    }
    const normalizedKey = state.role?.key ?? buildRoleKey(displayName);
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
      title={state.role ? "Edit role" : "Create role"}
      isOpen
      onClose={props.onClose}
      footer={
        <>
          <span className="skima-access-selection-count">{selectedPermissions.size} allowed actions</span>
          <Button variant="ghost" disabled={mutation.isPending} onClick={props.onClose}>Cancel</Button>
          <Button type="submit" form="administrator-role-form" isLoading={mutation.isPending} icon={ShieldCheck}>
            {state.role ? "Save role" : "Create role"}
          </Button>
        </>
      }
    >
      <form id="administrator-role-form" className="skima-form-grid" onSubmit={submit}>
        <AdminWorkspaceSections
          compact
          label="Role setup sections"
          activeKey={step}
          onChange={(key) => {
            setFormError(null);
            setStep(key as RoleEditorStep);
          }}
          sections={[
            {
              key: "details",
              label: "Role details",
              description: "Name, purpose and status.",
              icon: ShieldCheck,
            },
            {
              key: "access",
              label: "Allowed actions",
              description: "Choose what people with this role can do.",
              icon: KeyRound,
              badge: selectedPermissions.size,
            },
          ]}
        />

        {step === "details" ? (
          <div className="admin-layer-grid">
            <TextInput
              label="Role name"
              placeholder="Finance Lead"
              helperText="Use a clear name that matches the person's responsibility."
              value={displayName}
              required
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
            <TextAreaInput
              label="What is this role responsible for?"
              helperText="A short explanation helps other admins choose the right role later."
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
            />
            <SelectInput
              label="Role status"
              value={roleStatus}
              options={[
                { label: "Active — can be assigned", value: "active" },
                { label: "Draft — still being prepared", value: "draft" },
                { label: "Retired — keep existing history only", value: "retired" },
              ]}
              onChange={(event) => setRoleStatus(event.currentTarget.value)}
            />
            <Button type="button" onClick={() => setStep("access")}>
              Next: choose allowed actions
            </Button>
          </div>
        ) : null}

        {step === "access" ? (
          <div className="admin-layer-grid">
            <div className="skima-access-permission-picker-heading">
              <div>
                <h3>What can this role do?</h3>
                <p>Choose only the work areas and actions this role needs. Technical permission names stay hidden.</p>
              </div>
              <div className="skima-access-search">
                <Search aria-hidden="true" />
                <input
                  aria-label="Search allowed actions"
                  placeholder="Search actions"
                  value={permissionSearch}
                  onChange={(event) => setPermissionSearch(event.currentTarget.value)}
                />
              </div>
            </div>
            {!props.permissionCatalogAvailable ? (
              <p className="skima-access-catalog-note">The full access list is temporarily unavailable. Showing actions already used by existing roles.</p>
            ) : null}
            <div className="skima-access-permission-picker">
              {groups.map((group) => {
                const keys = group.permissions.map((permission) => permission.key);
                const allSelected = keys.every((key) => selectedPermissions.has(key));
                return (
                  <section key={group.key}>
                    <header>
                      <span>
                        <strong>{friendlyAccessArea(group.key)}</strong>
                        <small>{keys.filter((key) => selectedPermissions.has(key)).length}/{keys.length} allowed</small>
                      </span>
                      <Button size="sm" variant="ghost" type="button" onClick={() => toggleGroup(keys)}>
                        {allSelected ? "Clear area" : "Allow all"}
                      </Button>
                    </header>
                    <div>
                      {group.permissions.map((permission) => (
                        <CheckboxField
                          key={permission.key}
                          id={`permission-${permission.key.replaceAll(".", "-")}`}
                          label={permissionAction(permission.key)}
                          helperText={permissionFriendlyDescription(permission, group.key)}
                          checked={selectedPermissions.has(permission.key)}
                          onChange={(event) => togglePermission(permission.key, event.currentTarget.checked)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
            <Button type="button" variant="outline" onClick={() => setStep("details")}>
              Back to role details
            </Button>
          </div>
        ) : null}

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
      props.onComplete(`Account status changed to ${friendlyStatus(nextStatus)}.`);
    },
  });

  if (!state) return null;
  const name = props.profile?.display_name || "this admin";

  return (
    <Dialog
      title="Change account status"
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
          <p>This changes the whole SKIMA account for <strong>{name}</strong>, not only admin access. A disabled account cannot sign in anywhere.</p>
        </div>
        <SelectInput
          label="New status"
          value={nextStatus}
          options={[
            { label: "Active — sign-in allowed", value: "active" },
            { label: "Disabled — sign-in blocked", value: "disabled" },
            { label: "Pending — waiting to be activated", value: "pending" },
          ]}
          onChange={(event) => setNextStatus(event.currentTarget.value)}
        />
        <TextAreaInput
          label="Reason for change"
          helperText="Required so other admins can understand why this change was made."
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
      props.onComplete("Admin access removed.");
    },
  });

  if (!state) return null;
  const name = props.profile?.display_name || "this administrator";

  return (
    <Dialog
      title="Remove admin access?"
      isOpen
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" disabled={mutation.isPending} onClick={props.onClose}>Keep access</Button>
          <Button variant="destructive" isLoading={mutation.isPending} onClick={() => mutation.mutate()}>
            Remove admin access
          </Button>
        </>
      }
    >
      <div className="skima-access-warning is-danger">
        <Ban />
        <p><strong>{name}</strong> will immediately lose access to the admin workspace. Their normal SKIMA account stays available and admin access can be added again later.</p>
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
    label: friendlyAccessArea(key),
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
  const raw = parts.slice(2).join(" ") || parts.at(-1) || key;
  const friendly = normalizeStatusLabel(raw);
  return friendly
    .replace(/\bManage\b/i, "Manage")
    .replace(/\bRead\b/i, "View")
    .replace(/\bSuper Manage\b/i, "Manage sensitive settings");
}

function permissionFriendlyDescription(permission: PermissionRecord, groupKey: string): string {
  if (permission.description && !permission.description.includes(permission.key)) {
    return permission.description;
  }
  return `Allows this role to ${permissionAction(permission.key).toLowerCase()} in ${friendlyAccessArea(groupKey).toLowerCase()}.`;
}

function friendlyAccessArea(key: string): string {
  const labels: Readonly<Record<string, string>> = {
    admins: "Admin team",
    applications: "Applications",
    billing: "Utility billing",
    configuration: "Platform settings",
    content: "Brand & content",
    coverage: "Service coverage",
    documents: "Application documents",
    drivers: "Drivers",
    financial: "Finance",
    financial_policy: "Pricing & financial rules",
    health: "System health",
    inventory: "Station stock",
    organizations: "Companies & stations",
    policy: "Terms & policies",
    providers: "Connections & providers",
    revenue: "Revenue",
    support: "Support",
    users: "User accounts",
    verification: "Identity checks",
    orders: "Orders",
    dispatch: "Driver matching",
    cylinders: "Cylinders",
    quality: "Service quality",
    operations: "Operations",
    safety: "Safety",
    config: "LPG settings",
  };
  return labels[key] ?? normalizeStatusLabel(key);
}

function buildRoleKey(displayName: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
  return `platform.${slug || "custom_admin"}`;
}

function readRoleCategory(key: string): string {
  return key.split(".")[1]?.replaceAll("_", "-") || "general";
}

function friendlyStatus(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    active: "Active",
    disabled: "Disabled",
    revoked: "Access removed",
    retired: "Retired",
    suspended: "Paused",
    pending: "Pending",
    draft: "Draft",
  };
  return labels[value] ?? normalizeStatusLabel(value);
}

function statusTone(value: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (/active|approved|complete/i.test(value)) return "success";
  if (/disabled|revoked|retired|blocked|suspended/i.test(value)) return "danger";
  if (/pending|draft|review/i.test(value)) return "warning";
  return "neutral";
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The admin access change could not be completed.";
}
