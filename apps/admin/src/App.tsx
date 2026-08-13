import {
  Activity,
  BookOpenCheck,
  Boxes,
  Building2,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileCheck2,
  FileText,
  LayoutDashboard,
  Megaphone,
  type LucideIcon,
  MessageSquareWarning,
  PlugZap,
  RefreshCcw,
  ServerCog,
  Settings2,
  ShieldCheck,
  UserCheck,
  UsersRound,
  WalletCards,
  XCircle,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import {
  type ApiGatewayClient,
  createClientIdempotencyKey,
  filterNavigationItems,
  formatMoney,
  hasPermission,
  type NavigationItem,
  normalizeStatusLabel,
} from "@skima/frontend-core";
import {
  Button,
  DataTable,
  DetailList,
  Dialog,
  ErrorState,
  LoadingState,
  MetricTile,
  MoneyDisplay,
  type NavItem,
  PageHeader,
  PageShell,
  PermissionProvider,
  StatusBadge,
  type TableColumn,
  TextAreaInput,
  TextInput,
} from "@skima/ui";

import { AdminResourceConsole } from "./admin-resource-console";
import { AdminCompanyWorkspace } from "./admin-company-workspace";
import { AdminSystemWorkspace } from "./admin-system-workspace";
import { AdminAccessWorkspace } from "./admin-access-workspace";
import { AdminContentWorkspace } from "./admin-content-workspace";
import {
  catalogConsoleConfig,
  financeConsoleConfig,
  governanceConsoleConfig,
  integrationConsoleConfig,
  operationsConsoleConfig,
} from "./admin-resource-config";
import { useSessionState } from "./session";

const RecordSchema = z.record(z.unknown());
const RecordArraySchema = z.array(RecordSchema);
const MutationIdSchema = z.string().uuid();
const MediaReadSessionSchema = z.object({
  assetId: z.string().uuid(),
  contentType: z.string().nullable().optional(),
  expiresInSeconds: z.number().optional(),
  signedUrl: z.string().url(),
});

const APPLICATION_REVIEW_PERMISSION = "platform.applications.review";
const DOCUMENT_REVIEW_PERMISSION = "platform.documents.review";

type PlatformRecord = Readonly<Record<string, unknown>>;

type ReviewDialogState =
  | { readonly type: "assign"; readonly application: PlatformRecord }
  | { readonly type: "correction"; readonly application: PlatformRecord }
  | { readonly type: "approve"; readonly application: PlatformRecord }
  | { readonly type: "reject"; readonly application: PlatformRecord }
  | {
    readonly type: "document-approve" | "document-correction" | "document-reject";
    readonly application: PlatformRecord;
    readonly document: PlatformRecord;
  };

type ReviewCommand =
  | {
    readonly type: "assign";
    readonly applicationId: string;
    readonly reviewerUserId: string;
  }
  | {
    readonly type: "correction";
    readonly applicationId: string;
    readonly applicantMessage: string;
    readonly internalNotes: string | null;
  }
  | {
    readonly type: "decision";
    readonly applicationId: string;
    readonly decision: "approved" | "rejected";
    readonly reason: string;
    readonly reviewerUserId: string | null;
  }
  | {
    readonly type: "document-review";
    readonly documentSubmissionId: string;
    readonly decision: "approved" | "rejected" | "correction_required";
    readonly applicantMessage: string | null;
    readonly internalNotes: string | null;
  };

const navIconMap = {
  overview: LayoutDashboard,
  company: Building2,
  access: UsersRound,
  governance: Settings2,
  applications: ClipboardList,
  organizations: Building2,
  operations: Activity,
  finance: WalletCards,
  content: Megaphone,
  catalog: Boxes,
  providers: PlugZap,
  system: ServerCog,
} as const;

const foundationNavigation: readonly NavigationItem[] = [
  {
    key: "overview",
    label: "Overview",
    href: "/",
    icon: "overview",
  },
  {
    key: "company",
    label: "Companies",
    href: "/company",
    icon: "company",
    requiredPermissions: ["platform.organizations.read"],
  },
  {
    key: "access",
    label: "People & Access",
    href: "/access",
    icon: "access",
    requiredPermissions: ["platform.admins.read"],
  },
  {
    key: "applications",
    label: "Applications",
    href: "/applications",
    icon: "applications",
    requiredPermissions: ["platform.applications.read"],
  },
  {
    key: "operations",
    label: "Operations",
    href: "/operations",
    icon: "operations",
    requiredPermissions: ["platform.events.read"],
  },
  {
    key: "finance",
    label: "Finance",
    href: "/finance",
    icon: "finance",
    requiredPermissions: ["platform.financial.read"],
  },
  {
    key: "content",
    label: "Brand & Content",
    href: "/content",
    icon: "content",
    requiredPermissions: ["platform.content.read"],
  },
  {
    key: "catalog",
    label: "Services",
    href: "/catalog",
    icon: "catalog",
    requiredPermissions: ["platform.configuration.read"],
  },
  {
    key: "governance",
    label: "Configuration",
    href: "/governance",
    icon: "governance",
    requiredPermissions: ["platform.configuration.read"],
  },
  {
    key: "providers",
    label: "Integrations",
    href: "/providers",
    icon: "providers",
    requiredPermissions: ["platform.providers.manage"],
  },
  {
    key: "system",
    label: "Systems & Audit",
    href: "/system",
    icon: "system",
    requiredPermissions: ["platform.health.read"],
  },
];

export function App() {
  const sessionState = useSessionState();
  const [route, setRoute] = useState(readRouteFromHash);

  useEffect(() => {
    const handleHashChange = () => setRoute(readRouteFromHash());
    window.addEventListener("hashchange", handleHashChange);

    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  if (sessionState.status === "loading") {
    return <LoadingState label="Loading your account" />;
  }

  if (sessionState.status === "unauthenticated") {
    return <LoginView />;
  }

  if (sessionState.status === "error" || !sessionState.context) {
    return (
      <div className="skima-auth-page">
        <ErrorState
          title="Account unavailable"
          message={sessionState.error ?? "We could not load your account. Please try again."}
          onRetry={sessionState.refreshContext}
        />
      </div>
    );
  }

  const permissionContext = {
    permissions: sessionState.context.permissions,
    roles: sessionState.context.roles,
    organizations: sessionState.context.organizations,
  };
  const can = (permission: string) =>
    sessionState.context?.platformAdmin?.admin_kind === "super_admin" ||
    hasPermission(permissionContext, permission);
  const filteredNavigation = sessionState.context.platformAdmin?.admin_kind === "super_admin"
    ? foundationNavigation
    : filterNavigationItems(foundationNavigation, permissionContext);
  const shellNavItems = filteredNavigation.map(toShellNavItem);
  const activeRoute = shellNavItems.some((item) => item.href === route) ? route : "/";

  const navigate = (href: string) => {
    window.location.hash = href === "/" ? "" : href;
    setRoute(href);
  };

  return (
    <PermissionProvider can={can}>
      <PageShell
        brand="Skima"
        navItems={shellNavItems}
        activeHref={activeRoute}
        contextLabel={sessionState.context.platformAdmin?.title ?? "Platform"}
        userLabel={sessionState.context.profile?.display_name ?? sessionState.context.user.email ??
          "User"}
        onNavigate={navigate}
        onSignOut={sessionState.signOut}
      >
        <Workspace route={activeRoute} onNavigate={navigate} />
      </PageShell>
    </PermissionProvider>
  );
}

function LoginView() {
  const { signIn, error } = useSessionState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      await signIn(email, password);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="skima-auth-page">
      <section className="skima-auth-panel">
        <div className="admin-login-brand">
          <span aria-hidden="true">S</span>
          <div>
            <h1>Skima</h1>
            <p>Company administration</p>
          </div>
        </div>
        <div className="admin-login-copy">
          <h2>Welcome back</h2>
          <p>Sign in with an approved administrator account.</p>
        </div>
        <form className="skima-form" onSubmit={submit}>
          <TextInput
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            required
          />
          <TextInput
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            required
          />
          {error ? <StatusBadge tone="danger">{error}</StatusBadge> : null}
          <Button icon={ShieldCheck} isLoading={isSubmitting} type="submit">
            Continue securely
          </Button>
        </form>
      </section>
    </main>
  );
}

function Workspace(props: { readonly route: string; readonly onNavigate: (href: string) => void }) {
  if (props.route === "/company") {
    return <AdminCompanyWorkspace />;
  }

  if (props.route === "/access") {
    return <AdminAccessWorkspace />;
  }

  if (props.route === "/content") {
    return <AdminContentWorkspace />;
  }

  if (props.route === "/governance") {
    return <AdminResourceConsole config={governanceConsoleConfig} />;
  }

  if (props.route === "/applications") {
    return <ApplicationsWorkspace />;
  }

  if (props.route === "/operations") {
    return <AdminResourceConsole config={operationsConsoleConfig} />;
  }

  if (props.route === "/finance") {
    return <AdminResourceConsole config={financeConsoleConfig} />;
  }

  if (props.route === "/catalog") {
    return <AdminResourceConsole config={catalogConsoleConfig} />;
  }

  if (props.route === "/providers") {
    return <AdminResourceConsole config={integrationConsoleConfig} />;
  }

  if (props.route === "/system") {
    return <AdminSystemWorkspace />;
  }

  return <OverviewWorkspace onNavigate={props.onNavigate} />;
}

function OverviewWorkspace(props: { readonly onNavigate: (href: string) => void }) {
  const sessionState = useSessionState();
  const administrators = useGatewayRecords("command-admins", "/admin/users");
  const companies = useGatewayRecords("command-companies", "/admin/organizations");
  const applications = useGatewayRecords("command-applications", "/runtime/applications");
  const jobs = useGatewayRecords("command-jobs", "/admin/system/jobs");
  const incidents = useGatewayRecords("command-incidents", "/admin/system/errors");
  const pendingApplications = (applications.data ?? []).filter((record) =>
    ["submitted", "resubmitted", "under_review", "additional_info_required"].includes(
      getRecordString(record, "status") ?? "",
    )
  ).length;
  const failedJobs = (jobs.data ?? []).filter((record) =>
    getRecordString(record, "status") === "failed"
  ).length;
  const openIncidents = (incidents.data ?? []).filter((record) =>
    ["open", "acknowledged"].includes(getRecordString(record, "status") ?? "")
  ).length;
  const activeAdmins = (administrators.data ?? []).filter((record) =>
    getRecordString(record, "status") === "active"
  ).length;
  const requiresAttention = pendingApplications + failedJobs + openIncidents;

  return (
    <>
      <section className="admin-command-hero">
        <div>
          <p className="admin-command-hero__eyebrow">Company command center</p>
          <h1>Good to see you, {firstName(sessionState.context?.profile?.display_name)}.</h1>
          <p>
            Run company access, live operations, money movement, customer content, and platform
            controls from one secure workspace.
          </p>
          <div className="admin-command-hero__actions">
            <Button icon={Activity} onClick={() => props.onNavigate("/operations")}>Open live operations</Button>
            <Button icon={UsersRound} variant="outline" onClick={() => props.onNavigate("/access")}>
              Manage admin team
            </Button>
          </div>
        </div>
        <div className="admin-command-hero__signal">
          <span>Operational attention</span>
          <strong>{requiresAttention}</strong>
          <small>{requiresAttention === 0 ? "No immediate action is waiting" : "items currently need review"}</small>
        </div>
      </section>
      <section className="skima-grid skima-grid--compact">
        <MetricTile
          label="Active admins"
          value={activeAdmins}
          icon={UsersRound}
        />
        <MetricTile
          label="Companies"
          value={companies.data?.length ?? 0}
          icon={Building2}
          tone="info"
        />
        <MetricTile
          label="Applications waiting"
          value={pendingApplications}
          icon={ClipboardList}
          tone={pendingApplications ? "warning" : "success"}
        />
        <MetricTile
          label="Platform incidents"
          value={openIncidents + failedJobs}
          icon={ServerCog}
          tone={openIncidents + failedJobs ? "warning" : "success"}
        />
      </section>
      <div className="admin-command-grid">
        <section className="sk-panel admin-command-actions">
          <div className="sk-panel__header">
            <div>
              <p className="admin-section-kicker">Workspaces</p>
              <h2>Run the company</h2>
            </div>
          </div>
          <div className="admin-launch-grid">
            <CommandLaunch
              icon={Building2}
              title="Companies"
              description="Company profiles, branches, teams, and operating status."
              onClick={() => props.onNavigate("/company")}
            />
            <CommandLaunch
              icon={ClipboardList}
              title="Approvals"
              description={`${pendingApplications} application${pendingApplications === 1 ? "" : "s"} waiting for action.`}
              onClick={() => props.onNavigate("/applications")}
            />
            <CommandLaunch
              icon={WalletCards}
              title="Finance"
              description="Wallets, deposits, escrow, payouts, and settlements."
              onClick={() => props.onNavigate("/finance")}
            />
            <CommandLaunch
              icon={Megaphone}
              title="Brand & content"
              description="Logos, promotions, onboarding, messages, and publishing."
              onClick={() => props.onNavigate("/content")}
            />
            <CommandLaunch
              icon={UsersRound}
              title="People & access"
              description="Multiple admins, custom roles, and permission scopes."
              onClick={() => props.onNavigate("/access")}
            />
            <CommandLaunch
              icon={ServerCog}
              title="Systems & audit"
              description="Health, jobs, incidents, service logs, and audit history."
              onClick={() => props.onNavigate("/system")}
            />
          </div>
        </section>
        <section className="sk-panel admin-attention-panel">
          <div className="sk-panel__header">
            <div>
              <p className="admin-section-kicker">Now</p>
              <h2>Attention queue</h2>
            </div>
            <StatusBadge tone={requiresAttention ? "warning" : "success"}>
              {requiresAttention ? `${requiresAttention} open` : "Clear"}
            </StatusBadge>
          </div>
          <AttentionRow
            label="Applications"
            value={pendingApplications}
            detail="Submitted profiles awaiting a decision"
            onClick={() => props.onNavigate("/applications")}
          />
          <AttentionRow
            label="Failed background work"
            value={failedJobs}
            detail="Jobs requiring retry or investigation"
            onClick={() => props.onNavigate("/system")}
          />
          <AttentionRow
            label="Open incidents"
            value={openIncidents}
            detail="Service issues not yet resolved"
            onClick={() => props.onNavigate("/system")}
          />
          <div className="admin-session-compact">
            <ShieldCheck aria-hidden="true" />
            <span>
              <strong>{sessionState.context?.platformAdmin?.title ?? "Platform administrator"}</strong>
              <small>{sessionState.context?.permissions.length ?? 0} governed permissions</small>
            </span>
          </div>
        </section>
      </div>
    </>
  );
}

function CommandLaunch(props: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly onClick: () => void;
}) {
  const Icon = props.icon;
  return (
    <button className="admin-launch-card" type="button" onClick={props.onClick}>
      <span className="admin-launch-card__icon"><Icon aria-hidden="true" /></span>
      <span>
        <strong>{props.title}</strong>
        <small>{props.description}</small>
      </span>
      <span className="admin-launch-card__arrow" aria-hidden="true">→</span>
    </button>
  );
}

function AttentionRow(props: {
  readonly label: string;
  readonly value: number;
  readonly detail: string;
  readonly onClick: () => void;
}) {
  return (
    <button className="admin-attention-row" type="button" onClick={props.onClick}>
      <span>
        <strong>{props.label}</strong>
        <small>{props.detail}</small>
      </span>
      <span className={props.value > 0 ? "is-active" : undefined}>{props.value}</span>
    </button>
  );
}

function ApplicationsWorkspace() {
  const sessionState = useSessionState();
  const queryClient = useQueryClient();
  const applications = useGatewayRecords("applications", "/runtime/applications");
  const applicationTypes = useGatewayRecords("application-types", "/runtime/application-types");
  const documents = useGatewayRecords("documents", "/runtime/documents");
  const requirements = useGatewayRecords(
    "document-requirements",
    "/runtime/documents/requirements",
  );
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<ReviewDialogState | null>(null);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);

  const applicationRecords = applications.data ?? [];
  const documentRecords = documents.data ?? [];
  const selectedApplication = useMemo(
    () =>
      applicationRecords.find((record) =>
        getRecordString(record, "id") === selectedApplicationId
      ) ??
        applicationRecords[0] ?? null,
    [applicationRecords, selectedApplicationId],
  );
  const selectedApplicationType = selectedApplication
    ? findRecordById(
      applicationTypes.data ?? [],
      getRecordString(selectedApplication, "application_type_id"),
    )
    : null;
  const selectedDocuments = selectedApplication
    ? documentRecords.filter((record) =>
      getRecordString(record, "application_id") === getRecordString(selectedApplication, "id")
    )
    : [];

  const reviewAction = useMutation({
    mutationFn: (command: ReviewCommand) => executeReviewCommand(sessionState.api, command),
    onSuccess: async () => {
      setDialogState(null);
      setOperationNotice("Review action saved.");
      await queryClient.invalidateQueries({ queryKey: ["gateway"] });
    },
  });

  const isLoading = applications.isLoading || applicationTypes.isLoading || documents.isLoading ||
    requirements.isLoading;
  const firstError = applications.error ?? applicationTypes.error ?? documents.error ??
    requirements.error;
  const refreshAll = () => {
    setOperationNotice(null);
    void queryClient.invalidateQueries({ queryKey: ["gateway"] });
  };

  return (
    <>
      <PageHeader
        eyebrow="Review"
        title="Applications"
        description="Assign, review, approve, reject, and request corrections for governed application and document workflows."
        actions={
          <Button icon={RefreshCcw} variant="outline" onClick={refreshAll}>
            Refresh
          </Button>
        }
      />
      <section className="skima-grid">
        <MetricTile
          label="Applications"
          value={applications.data?.length ?? 0}
          icon={ClipboardList}
        />
        <MetricTile
          label="Documents"
          value={documents.data?.length ?? 0}
          icon={FileText}
          tone="info"
        />
        <MetricTile
          label="Requirements"
          value={requirements.data?.length ?? 0}
          icon={ShieldCheck}
          tone="warning"
        />
      </section>
      {operationNotice
        ? <StatusBadge tone="success" className="skima-status-note">{operationNotice}</StatusBadge>
        : null}
      {isLoading ? <LoadingState label="Loading applications" /> : null}
      {firstError
        ? (
          <ErrorState
            title="Applications unavailable"
            message={readErrorMessage(firstError)}
            onRetry={refreshAll}
          />
        )
        : null}
      {!isLoading && !firstError
        ? (
          <section className="skima-review-layout">
            <ApplicationReviewQueue
              applications={applicationRecords}
              applicationTypes={applicationTypes.data ?? []}
              selectedApplicationId={getRecordString(selectedApplication, "id")}
              onSelect={setSelectedApplicationId}
            />
            <ApplicationReviewPanel
              application={selectedApplication}
              applicationType={selectedApplicationType}
              documents={selectedDocuments}
              requirements={requirements.data ?? []}
              currentUserId={sessionState.context?.user.id ?? null}
              isSubmitting={reviewAction.isPending}
              onOpenAction={(nextDialogState) => {
                reviewAction.reset();
                setOperationNotice(null);
                setDialogState(nextDialogState);
              }}
            />
          </section>
        )
        : null}
      <ReviewActionDialog
        state={dialogState}
        error={reviewAction.error}
        isSubmitting={reviewAction.isPending}
        currentUserId={sessionState.context?.user.id ?? null}
        onClose={() => {
          if (!reviewAction.isPending) {
            setDialogState(null);
            reviewAction.reset();
          }
        }}
        onSubmit={(command) => reviewAction.mutate(command)}
      />
    </>
  );
}

function ApplicationReviewQueue(props: {
  readonly applications: readonly PlatformRecord[];
  readonly applicationTypes: readonly PlatformRecord[];
  readonly selectedApplicationId: string | null;
  readonly onSelect: (applicationId: string) => void;
}) {
  if (props.applications.length === 0) {
    return (
      <section className="sk-panel">
        <div className="sk-panel__header">
          <h2>Review Queue</h2>
        </div>
        <p className="skima-muted">No applications need review right now.</p>
      </section>
    );
  }

  const orderedApplications = [...props.applications].sort(compareApplicationsForReview);

  return (
    <section className="sk-panel">
      <div className="sk-panel__header">
        <h2>Review Queue</h2>
        <StatusBadge>{String(props.applications.length)}</StatusBadge>
      </div>
      <div className="skima-review-queue">
        {orderedApplications.map((application) => {
          const applicationId = requireRecordString(application, "id");
          const applicationType = findRecordById(
            props.applicationTypes,
            getRecordString(application, "application_type_id"),
          );
          const title = getRecordString(applicationType, "display_name") ??
            normalizeStatusLabel(getRecordString(applicationType, "key") ?? "Application");
          const status = getRecordString(application, "status") ?? "unknown";
          const applicantName = applicantDisplayName(application);
          const applicantEmail = getRecordString(application, "applicant_email");
          const subjectName = getRecordString(application, "application_subject_name");

          return (
            <button
              key={applicationId}
              type="button"
              className={`skima-review-item ${
                applicationId === props.selectedApplicationId ? "is-active" : ""
              }`}
              onClick={() => props.onSelect(applicationId)}
            >
              <span className="skima-review-item__header">
                <strong>{title}</strong>
                <StatusBadge tone={statusTone(status)}>{normalizeStatusLabel(status)}</StatusBadge>
              </span>
              <span className="skima-review-item__person">
                <ApplicantAvatar application={application} />
                <span>
                  <strong>{applicantName}</strong>
                  <small>{subjectName ?? applicantEmail ?? "Applicant details pending"}</small>
                </span>
              </span>
              <p>
                {formatShortId(applicationId)} ·{" "}
                {formatDate(getRecordString(application, "created_at"))}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ApplicationReviewPanel(props: {
  readonly application: PlatformRecord | null;
  readonly applicationType: PlatformRecord | null;
  readonly documents: readonly PlatformRecord[];
  readonly requirements: readonly PlatformRecord[];
  readonly currentUserId: string | null;
  readonly isSubmitting: boolean;
  readonly onOpenAction: (state: ReviewDialogState) => void;
}) {
  if (!props.application) {
    return (
      <section className="sk-panel">
        <div className="sk-panel__header">
          <h2>Application Details</h2>
        </div>
        <p className="skima-muted">Choose an application to review.</p>
      </section>
    );
  }

  const application = props.application;
  const status = getRecordString(application, "status") ?? "unknown";
  const applicationId = requireRecordString(application, "id");
  const applicationName = getRecordString(props.applicationType, "display_name") ??
    normalizeStatusLabel(getRecordString(props.applicationType, "key") ?? "Application");
  const applicantName = applicantDisplayName(application);
  const applicantEmail = getRecordString(application, "applicant_email");
  const applicantPhone = getRecordString(application, "applicant_phone");
  const subjectName = getRecordString(application, "application_subject_name");
  const canAssign = Boolean(props.currentUserId) &&
    ["submitted", "resubmitted", "under_review"].includes(status);
  const canRequestCorrection = status === "under_review";
  const canDecide = Boolean(props.currentUserId) && ["submitted", "resubmitted", "under_review"].includes(status);

  return (
    <section className="sk-panel">
      <div className="sk-panel__header">
        <div>
          <h2>{applicationName}</h2>
          <p className="skima-muted">{formatShortId(applicationId)}</p>
        </div>
        <StatusBadge tone={statusTone(status)}>{normalizeStatusLabel(status)}</StatusBadge>
      </div>
      <div className="skima-applicant-card">
        <ApplicantAvatar application={application} size="lg" />
        <div>
          <p>Applicant</p>
          <h3>{applicantName}</h3>
          <small>
            {[applicantEmail, applicantPhone, subjectName].filter(Boolean).join(" • ") ||
              "No contact details submitted yet"}
          </small>
        </div>
      </div>
      <DetailList
        items={[
          {
            label: "Applicant",
            value: applicantName,
          },
          {
            label: "Applicant Contact",
            value: [applicantEmail, applicantPhone].filter(Boolean).join(" • ") || "Not provided",
          },
          {
            label: "Application Subject",
            value: subjectName ?? "Not provided",
          },
          {
            label: "Reviewer",
            value: getRecordString(application, "reviewer_display_name") ?? "Unassigned",
          },
          {
            label: "Submitted",
            value: formatDate(getRecordString(application, "submitted_at")),
          },
          {
            label: "Last Updated",
            value: formatDate(getRecordString(application, "updated_at")),
          },
          {
            label: "Category",
            value: normalizeStatusLabel(
              getRecordString(props.applicationType, "application_category") ?? "Application",
            ),
          },
        ]}
      />
      <div className="skima-action-row">
        <Button
          icon={UserCheck}
          variant="outline"
          requiredPermission={APPLICATION_REVIEW_PERMISSION}
          disabled={!canAssign || props.isSubmitting}
          onClick={() => props.onOpenAction({ type: "assign", application })}
        >
          Take Review
        </Button>
        <Button
          icon={MessageSquareWarning}
          variant="outline"
          requiredPermission={APPLICATION_REVIEW_PERMISSION}
          disabled={!canRequestCorrection || props.isSubmitting}
          onClick={() => props.onOpenAction({ type: "correction", application })}
        >
          Request Update
        </Button>
        <Button
          icon={CheckCircle2}
          requiredPermission={APPLICATION_REVIEW_PERMISSION}
          disabled={!canDecide || props.isSubmitting}
          onClick={() => props.onOpenAction({ type: "approve", application })}
        >
          Approve
        </Button>
        <Button
          icon={XCircle}
          variant="destructive"
          requiredPermission={APPLICATION_REVIEW_PERMISSION}
          disabled={!canDecide || props.isSubmitting}
          onClick={() => props.onOpenAction({ type: "reject", application })}
        >
          Reject
        </Button>
      </div>
      <DocumentReviewList
        application={application}
        documents={props.documents}
        requirements={props.requirements}
        isSubmitting={props.isSubmitting}
        onOpenAction={props.onOpenAction}
      />
    </section>
  );
}

function DocumentReviewList(props: {
  readonly application: PlatformRecord;
  readonly documents: readonly PlatformRecord[];
  readonly requirements: readonly PlatformRecord[];
  readonly isSubmitting: boolean;
  readonly onOpenAction: (state: ReviewDialogState) => void;
}) {
  return (
    <section className="sk-panel">
      <div className="sk-panel__header">
        <h2>Submitted Documents</h2>
        <StatusBadge>{String(props.documents.length)}</StatusBadge>
      </div>
      {props.documents.length === 0
        ? <p className="skima-muted">No documents have been submitted for this application.</p>
        : (
          <div className="skima-document-list">
            {props.documents.map((document) => {
              const documentId = requireRecordString(document, "id");
              const status = getRecordString(document, "status") ?? "unknown";
              const requirement = findRecordById(
                props.requirements,
                getRecordString(document, "requirement_id"),
              );
              const title = getRecordString(requirement, "display_name") ?? "Document";
              const fileName = getNestedRecordString(document, ["metadata", "originalFileName"]) ??
                getNestedRecordString(document, ["media_assets", "metadata", "originalFileName"]) ??
                getRecordString(document, "storage_path")?.split("/").at(-1) ??
                "Uploaded file";

              return (
                <article className="skima-document-row" key={documentId}>
                  <div className="skima-document-row__header">
                    <strong>{title}</strong>
                    <StatusBadge tone={statusTone(status)}>
                      {normalizeStatusLabel(status)}
                    </StatusBadge>
                  </div>
                  <DetailList
                    items={[
                      {
                        label: "File Type",
                        value: getRecordString(document, "content_type") ?? "Not provided",
                      },
                      {
                        label: "File",
                        value: fileName,
                      },
                      {
                        label: "Submitted",
                        value: formatDate(getRecordString(document, "submitted_at")),
                      },
                      {
                        label: "Decision",
                        value: getRecordString(document, "decision_reason") ?? "None",
                      },
                      {
                        label: "Reference",
                        value: formatShortId(documentId),
                      },
                    ]}
                  />
                  <div className="skima-action-row">
                    <DocumentViewButton document={document} />
                    <Button
                      icon={FileCheck2}
                      variant="outline"
                      size="sm"
                      requiredPermission={DOCUMENT_REVIEW_PERMISSION}
                      disabled={props.isSubmitting}
                      onClick={() =>
                        props.onOpenAction({
                          type: "document-approve",
                          application: props.application,
                          document,
                        })}
                    >
                      Approve
                    </Button>
                    <Button
                      icon={MessageSquareWarning}
                      variant="outline"
                      size="sm"
                      requiredPermission={DOCUMENT_REVIEW_PERMISSION}
                      disabled={props.isSubmitting}
                      onClick={() =>
                        props.onOpenAction({
                          type: "document-correction",
                          application: props.application,
                          document,
                        })}
                    >
                      Request Update
                    </Button>
                    <Button
                      icon={XCircle}
                      variant="destructive"
                      size="sm"
                      requiredPermission={DOCUMENT_REVIEW_PERMISSION}
                      disabled={props.isSubmitting}
                      onClick={() =>
                        props.onOpenAction({
                          type: "document-reject",
                          application: props.application,
                          document,
                        })}
                    >
                      Reject
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
    </section>
  );
}

function DocumentViewButton(props: { readonly document: PlatformRecord }) {
  const { api } = useSessionState();
  const mediaAssetId = getRecordString(props.document, "media_asset_id") ??
    getNestedRecordString(props.document, ["media_assets", "id"]);
  const [error, setError] = useState<string | null>(null);
  const readSession = useMutation({
    mutationFn: () =>
      api.post(
        "/runtime/media/read-sessions",
        {
          assetId: mediaAssetId,
          idempotencyKey: createClientIdempotencyKey(
            "admin.application-document.view",
            mediaAssetId ?? undefined,
          ),
        },
        MediaReadSessionSchema,
      ),
    onSuccess: (session) => {
      setError(null);
      window.open(session.signedUrl, "_blank", "noopener,noreferrer");
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : "The document file could not be opened.");
    },
  });

  return (
    <span className="skima-document-view">
      <Button
        icon={Eye}
        variant="outline"
        size="sm"
        requiredPermission={DOCUMENT_REVIEW_PERMISSION}
        disabled={!mediaAssetId || readSession.isPending}
        onClick={() => readSession.mutate()}
      >
        {readSession.isPending ? "Opening" : "View File"}
      </Button>
      {error ? <small role="alert">{error}</small> : null}
    </span>
  );
}

function ReviewActionDialog(props: {
  readonly state: ReviewDialogState | null;
  readonly currentUserId: string | null;
  readonly error: unknown;
  readonly isSubmitting: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (command: ReviewCommand) => void;
}) {
  const [reason, setReason] = useState("");
  const [internalNotes, setInternalNotes] = useState("");

  useEffect(() => {
    setReason("");
    setInternalNotes("");
  }, [props.state]);

  const state = props.state;

  if (!state) {
    return null;
  }

  const title = reviewDialogTitle(state);
  const requiresReason = state.type !== "assign";
  const reasonLabel = state.type === "correction" || state.type === "document-correction"
    ? "Message to Applicant"
    : "Review Reason";
  const canSubmit = state.type === "assign"
    ? Boolean(props.currentUserId)
    : reason.trim().length > 0;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    const applicationId = requireRecordString(state.application, "id");

    if (state.type === "assign") {
      props.onSubmit({
        type: "assign",
        applicationId,
        reviewerUserId: props.currentUserId ?? "",
      });
      return;
    }

    if (state.type === "correction") {
      props.onSubmit({
        type: "correction",
        applicationId,
        applicantMessage: reason.trim(),
        internalNotes: optionalTrimmedValue(internalNotes),
      });
      return;
    }

    if (state.type === "approve" || state.type === "reject") {
      props.onSubmit({
        type: "decision",
        applicationId,
        decision: state.type === "approve" ? "approved" : "rejected",
        reason: reason.trim(),
        reviewerUserId: props.currentUserId,
      });
      return;
    }

    const documentSubmissionId = requireRecordString(state.document, "id");
    const decision = state.type === "document-approve"
      ? "approved"
      : state.type === "document-reject"
      ? "rejected"
      : "correction_required";

    props.onSubmit({
      type: "document-review",
      documentSubmissionId,
      decision,
      applicantMessage: state.type === "document-correction" ? reason.trim() : null,
      internalNotes: state.type === "document-correction"
        ? optionalTrimmedValue(internalNotes)
        : reason.trim(),
    });
  };

  return (
    <Dialog
      title={title}
      isOpen={Boolean(props.state)}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose} disabled={props.isSubmitting}>
            Cancel
          </Button>
          <Button
            icon={reviewDialogIcon(state)}
            type="submit"
            form="review-action-form"
            isLoading={props.isSubmitting}
            disabled={!canSubmit}
            variant={reviewDialogVariant(state)}
          >
            Save
          </Button>
        </>
      }
    >
      <form id="review-action-form" className="skima-form-grid" onSubmit={submit}>
        {state.type === "assign"
          ? (
            <p className="skima-muted">
              This assigns the review to your account and starts the review state when allowed.
            </p>
          )
          : null}
        {requiresReason
          ? (
            <TextAreaInput
              id="review-reason"
              label={reasonLabel}
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
              required
            />
          )
          : null}
        {state.type === "correction" || state.type === "document-correction"
          ? (
            <TextAreaInput
              id="review-internal-notes"
              label="Internal Notes"
              value={internalNotes}
              onChange={(event) => setInternalNotes(event.currentTarget.value)}
            />
          )
          : null}
        {props.error
          ? <StatusBadge tone="danger">{readErrorMessage(props.error)}</StatusBadge>
          : null}
      </form>
    </Dialog>
  );
}

async function executeReviewCommand(
  api: ApiGatewayClient,
  command: ReviewCommand,
): Promise<string> {
  if (command.type === "assign") {
    return api.post(
      "/runtime/applications/reviewer",
      {
        applicationId: command.applicationId,
        reviewerUserId: command.reviewerUserId,
        idempotencyKey: createClientIdempotencyKey(
          "application-review.assign",
          command.applicationId,
        ),
        metadata: { source: "admin_review_console" },
      },
      MutationIdSchema,
    );
  }

  if (command.type === "correction") {
    return api.post(
      "/runtime/applications/corrections",
      {
        applicationId: command.applicationId,
        applicantMessage: command.applicantMessage,
        internalNotes: command.internalNotes,
        idempotencyKey: createClientIdempotencyKey(
          "application-review.correction",
          command.applicationId,
        ),
        metadata: { source: "admin_review_console" },
      },
      MutationIdSchema,
    );
  }

  if (command.type === "decision") {
    if (command.reviewerUserId) {
      await api.post(
        "/runtime/applications/reviewer",
        {
          applicationId: command.applicationId,
          reviewerUserId: command.reviewerUserId,
          idempotencyKey: createClientIdempotencyKey(
            "application-review.auto-assign",
            command.applicationId,
          ),
          metadata: { source: "admin_review_console", reason: "auto_start_before_decision" },
        },
        MutationIdSchema,
      );
    }

    return api.post(
      "/runtime/applications/decisions",
      {
        applicationId: command.applicationId,
        decision: command.decision,
        reason: command.reason,
        idempotencyKey: createClientIdempotencyKey(
          `application-review.${command.decision}`,
          command.applicationId,
        ),
        metadata: { source: "admin_review_console" },
      },
      MutationIdSchema,
    );
  }

  return api.post(
    "/runtime/documents/review",
    {
      documentSubmissionId: command.documentSubmissionId,
      decision: command.decision,
      applicantMessage: command.applicantMessage,
      internalNotes: command.internalNotes,
      idempotencyKey: createClientIdempotencyKey(
        `document-review.${command.decision}`,
        command.documentSubmissionId,
      ),
      metadata: { source: "admin_review_console" },
    },
    MutationIdSchema,
  );
}

function OperationsWorkspace() {
  const orders = useGatewayRecords("orders", "/runtime/orders");
  const serviceRequests = useGatewayRecords("service-requests", "/runtime/service-requests");
  const messages = useGatewayRecords("communications", "/runtime/communications/messages");

  return (
    <>
      <PageHeader
        eyebrow="Live Work"
        title="Operations"
        description="Track active orders, service requests, communications, workflow activity, and operational exceptions."
      />
      <section className="skima-grid">
        <MetricTile label="Orders" value={orders.data?.length ?? 0} icon={ClipboardList} />
        <MetricTile
          label="Service Requests"
          value={serviceRequests.data?.length ?? 0}
          icon={Activity}
          tone="success"
        />
        <MetricTile
          label="Messages"
          value={messages.data?.length ?? 0}
          icon={BookOpenCheck}
          tone="info"
        />
      </section>
      <RecordsTable
        title="Order Records"
        query={orders}
        preferredKeys={["order_number", "status", "organization_id", "created_at"]}
      />
      <RecordsTable
        title="Service Requests"
        query={serviceRequests}
        preferredKeys={["module_key", "status", "customer_user_id", "created_at"]}
      />
    </>
  );
}

function FinanceWorkspace() {
  const balances = useGatewayRecords("wallet-balances", "/runtime/wallet-balances");
  const withdrawals = useGatewayRecords("withdrawals", "/runtime/withdrawals");
  const commissions = useGatewayRecords("commission-executions", "/runtime/commission-executions");
  const settlements = useGatewayRecords("settlement-statements", "/runtime/settlement-statements");

  return (
    <>
      <PageHeader
        eyebrow="Money Movement"
        title="Finance"
        description="Review wallet balances, withdrawals, commissions, settlements, refunds, and reconciliation activity."
      />
      <section className="skima-grid">
        <MetricTile label="Wallet Balances" value={balances.data?.length ?? 0} icon={WalletCards} />
        <MetricTile
          label="Withdrawals"
          value={withdrawals.data?.length ?? 0}
          icon={Activity}
          tone="warning"
        />
        <MetricTile
          label="Commissions"
          value={commissions.data?.length ?? 0}
          icon={ShieldCheck}
          tone="success"
        />
        <MetricTile
          label="Settlements"
          value={settlements.data?.length ?? 0}
          icon={FileText}
          tone="info"
        />
      </section>
      <RecordsTable
        title="Wallet Balances"
        query={balances}
        preferredKeys={[
          "owner_display_name",
          "owner_entity_type",
          "wallet_type",
          "currency_code",
          "balance",
        ]}
        valueRenderer={(key, value, record) => {
          if (key.endsWith("_balance_minor") && typeof value === "number") {
            return (
              <MoneyDisplay value={formatMoney(value, String(record.currency_code ?? "NGN"))} />
            );
          }

          return renderRecordValue(value);
        }}
      />
    </>
  );
}

function CatalogWorkspace() {
  const items = useGatewayRecords("catalog-items", "/runtime/catalog/items");
  const variants = useGatewayRecords("catalog-variants", "/runtime/catalog/variants");
  const availability = useGatewayRecords("catalog-availability", "/runtime/catalog/availability");

  return (
    <>
      <PageHeader
        eyebrow="Offerings"
        title="Catalog"
        description="Manage reusable products, services, variants, prices, media, availability, and capacity policies."
      />
      <section className="skima-grid">
        <MetricTile label="Items" value={items.data?.length ?? 0} icon={Boxes} />
        <MetricTile
          label="Variants"
          value={variants.data?.length ?? 0}
          icon={FileText}
          tone="info"
        />
        <MetricTile
          label="Availability Rules"
          value={availability.data?.length ?? 0}
          icon={Activity}
          tone="success"
        />
      </section>
      <RecordsTable
        title="Catalog Items"
        query={items}
        preferredKeys={["display_name", "status", "organization_id", "created_at"]}
      />
    </>
  );
}

function ProvidersWorkspace() {
  const providers = useGatewayRecords("provider-adapters", "/engines/provider-adapters");
  const deliveries = useGatewayRecords("webhook-deliveries", "/admin/webhook-deliveries");
  const paymentEvents = useGatewayRecords(
    "payment-webhook-events",
    "/runtime/payment-webhook-events",
  );

  return (
    <>
      <PageHeader
        eyebrow="Connections"
        title="Integrations"
        description="Inspect provider adapters, payment events, communication delivery, and webhook processing."
      />
      <section className="skima-grid">
        <MetricTile label="Connections" value={providers.data?.length ?? 0} icon={PlugZap} />
        <MetricTile
          label="Webhook Deliveries"
          value={deliveries.data?.length ?? 0}
          icon={Activity}
          tone="warning"
        />
        <MetricTile
          label="Payment Events"
          value={paymentEvents.data?.length ?? 0}
          icon={WalletCards}
          tone="success"
        />
      </section>
      <RecordsTable
        title="Integration Connections"
        query={providers}
        preferredKeys={["provider_kind", "key", "display_name", "status"]}
      />
    </>
  );
}

function RecordsTable(props: {
  readonly title: string;
  readonly query: ReturnType<typeof useGatewayRecords>;
  readonly preferredKeys: readonly string[];
  readonly valueRenderer?: (
    key: string,
    value: unknown,
    record: Readonly<Record<string, unknown>>,
  ) => ReactNode;
}) {
  if (props.query.isLoading) {
    return <LoadingState label={`Loading ${props.title}`} />;
  }

  if (props.query.error) {
    return (
      <ErrorState
        title={`${props.title} unavailable`}
        message={props.query.error instanceof Error
          ? props.query.error.message
          : "The request failed."}
        onRetry={() => void props.query.refetch()}
      />
    );
  }

  const records = props.query.data ?? [];
  const columns = buildColumns(records, props.preferredKeys, props.valueRenderer);

  return (
    <DataTable
      caption={props.title}
      columns={columns}
      records={records}
      getRowKey={(record) => String(record.id ?? record.key ?? JSON.stringify(record))}
      emptyTitle={props.title}
      emptyMessage="No records are available for this view."
    />
  );
}

function useGatewayRecords(queryKey: string, path: string) {
  return useGatewayData(queryKey, path, RecordArraySchema);
}

function useGatewayData<TData>(queryKey: string, path: string, schema: z.ZodType<TData>) {
  const { api, status } = useSessionState();

  return useQuery({
    queryKey: ["gateway", queryKey, path],
    queryFn: () => api.get(path, schema),
    enabled: status === "authenticated",
  });
}

function buildColumns(
  records: readonly Readonly<Record<string, unknown>>[],
  preferredKeys: readonly string[],
  valueRenderer?: (
    key: string,
    value: unknown,
    record: Readonly<Record<string, unknown>>,
  ) => ReactNode,
): TableColumn<Readonly<Record<string, unknown>>>[] {
  const keys = new Set(preferredKeys);

  for (const record of records.slice(0, 4)) {
    for (const key of Object.keys(record).slice(0, 6)) {
      keys.add(key);
    }
  }

  return Array.from(keys).slice(0, 6).map((key) => ({
    key,
    header: normalizeStatusLabel(key),
    render: (record) => valueRenderer?.(key, record[key], record) ?? renderRecordValue(record[key]),
  }));
}

function renderRecordValue(value: unknown): ReactNode {
  if (typeof value === "string") {
    if (/status|state/i.exec(value)) {
      return <StatusBadge>{normalizeStatusLabel(value)}</StatusBadge>;
    }

    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      return <span title={value}>{formatShortId(value)}</span>;
    }

    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "None";
  }

  return JSON.stringify(value);
}

function getRecordString(record: PlatformRecord | null | undefined, key: string): string | null {
  const value = record?.[key];

  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getNestedRecordString(
  record: PlatformRecord | null | undefined,
  path: readonly string[],
): string | null {
  let value: unknown = record;

  for (const key of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    value = (value as PlatformRecord)[key];
  }

  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function ApplicantAvatar(props: {
  readonly application: PlatformRecord;
  readonly size?: "sm" | "lg";
}) {
  const avatarUrl = getNestedRecordString(props.application, ["applicant_profile", "avatarUrl"]);
  const displayName = applicantDisplayName(props.application);
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "A";
  const className = `skima-applicant-avatar ${props.size === "lg" ? "is-large" : ""}`;

  if (avatarUrl && /^https?:\/\//i.test(avatarUrl)) {
    return <img className={className} src={avatarUrl} alt="" />;
  }

  return <span className={className}>{initials}</span>;
}

function applicantDisplayName(application: PlatformRecord): string {
  return getRecordString(application, "applicant_display_name") ??
    getNestedRecordString(application, ["applicant_profile", "displayName"]) ??
    getRecordString(application, "applicant_email") ??
    formatShortId(getRecordString(application, "applicant_user_id"));
}

function requireRecordString(record: PlatformRecord, key: string): string {
  const value = getRecordString(record, key);

  if (!value) {
    throw new Error(`${key} is required for this action.`);
  }

  return value;
}

function findRecordById(
  records: readonly PlatformRecord[],
  id: string | null,
): PlatformRecord | null {
  if (!id) {
    return null;
  }

  return records.find((record) => getRecordString(record, "id") === id) ?? null;
}

function compareApplicationsForReview(left: PlatformRecord, right: PlatformRecord): number {
  const leftStatus = getRecordString(left, "status") ?? "";
  const rightStatus = getRecordString(right, "status") ?? "";
  const statusDifference = reviewStatusWeight(leftStatus) - reviewStatusWeight(rightStatus);

  if (statusDifference !== 0) {
    return statusDifference;
  }

  return dateSortValue(getRecordString(right, "created_at")) -
    dateSortValue(getRecordString(left, "created_at"));
}

function reviewStatusWeight(status: string): number {
  const weights: Readonly<Record<string, number>> = {
    submitted: 0,
    resubmitted: 1,
    under_review: 2,
    additional_info_required: 3,
    draft: 4,
    incomplete: 5,
    approved: 6,
    rejected: 7,
    suspended: 8,
    withdrawn: 9,
    expired: 10,
  };

  return weights[status] ?? 11;
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  if (["approved", "active", "completed"].includes(status)) {
    return "success";
  }

  if (["rejected", "failed", "suspended", "quarantined"].includes(status)) {
    return "danger";
  }

  if (
    ["submitted", "resubmitted", "under_review", "correction_required", "additional_info_required"]
      .includes(status)
  ) {
    return "warning";
  }

  if (["draft", "incomplete", "uploaded"].includes(status)) {
    return "info";
  }

  return "neutral";
}

function formatShortId(value: string | null): string {
  if (!value) {
    return "None";
  }

  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Not recorded";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function dateSortValue(value: string | null): number {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();

  return Number.isNaN(time) ? 0 : time;
}

function firstName(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized ? normalized.split(/\s+/)[0] : "there";
}

function optionalTrimmedValue(value: string): string | null {
  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function reviewDialogTitle(state: ReviewDialogState): string {
  if (state.type === "assign") {
    return "Take Review";
  }

  if (state.type === "correction") {
    return "Request Application Update";
  }

  if (state.type === "approve") {
    return "Approve Application";
  }

  if (state.type === "reject") {
    return "Reject Application";
  }

  if (state.type === "document-approve") {
    return "Approve Document";
  }

  if (state.type === "document-reject") {
    return "Reject Document";
  }

  return "Request Document Update";
}

function reviewDialogIcon(state: ReviewDialogState): LucideIcon {
  if (state.type === "assign") {
    return UserCheck;
  }

  if (state.type === "correction" || state.type === "document-correction") {
    return MessageSquareWarning;
  }

  if (state.type === "reject" || state.type === "document-reject") {
    return XCircle;
  }

  return CheckCircle2;
}

function reviewDialogVariant(state: ReviewDialogState): "primary" | "destructive" {
  return state.type === "reject" || state.type === "document-reject" ? "destructive" : "primary";
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The action could not be completed.";
}

function toShellNavItem(item: NavigationItem): NavItem {
  const Icon = navIconMap[item.icon as keyof typeof navIconMap] ?? LayoutDashboard;

  return {
    key: item.key,
    label: item.label,
    href: item.href,
    icon: Icon,
    requiredPermissions: item.requiredPermissions,
  };
}

function readRouteFromHash(): string {
  const route = window.location.hash.replace(/^#/, "");

  return route.length > 0 ? route : "/";
}
