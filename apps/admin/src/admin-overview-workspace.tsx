import {
  Activity,
  BadgeDollarSign,
  Building2,
  ClipboardList,
  Megaphone,
  ServerCog,
  ShieldCheck,
  Truck,
  type LucideIcon,
  UsersRound,
  WalletCards,
} from "lucide-react";

import { Button, MetricTile, StatusBadge } from "@skima/ui";

import { firstName, getRecordString, useGatewayRecords } from "./admin-gateway-data";
import { useSessionState } from "./session";

export function AdminOverviewWorkspace(props: { readonly onNavigate: (href: string) => void }) {
  const sessionState = useSessionState();
  const canReadLpgOperations = sessionState.context?.platformAdmin?.admin_kind === "super_admin" ||
    sessionState.context?.permissions.some((permission) =>
      ["lpg.orders.manage", "lpg.dispatch.execute", "lpg.cylinders.manage", "lpg.safety.manage", "lpg.config.manage"].includes(permission)
    ) ||
    false;
  const administrators = useGatewayRecords("command-admins", "/admin/users");
  const companies = useGatewayRecords("command-companies", "/admin/organizations");
  const applications = useGatewayRecords("command-applications", "/runtime/applications");
  const jobs = useGatewayRecords("command-jobs", "/admin/system/jobs");
  const incidents = useGatewayRecords("command-incidents", "/admin/system/errors");
  const lpgOrders = useGatewayRecords("command-lpg-orders", "/lpg/orders", canReadLpgOperations);

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
  const lpgDriverRecovery = (lpgOrders.data ?? []).filter((record) => {
    const status = getRecordString(record, "status") ?? "";
    const paymentStatus = getRecordString(record, "payment_status") ?? "";
    return !getRecordString(record, "driver_profile_id") &&
      ["payment_reserved", "matching_station", "matching_driver"].includes(status) &&
      ["reserved", "held", "payment_reserved"].includes(paymentStatus);
  }).length;
  const requiresAttention = pendingApplications + failedJobs + openIncidents + lpgDriverRecovery;

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
        <MetricTile label="Active admins" value={activeAdmins} icon={UsersRound} />
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
          label="Refills need driver"
          value={lpgDriverRecovery}
          icon={Truck}
          tone={lpgDriverRecovery ? "warning" : "success"}
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
              icon={BadgeDollarSign}
              title="Delivery pricing"
              description="Set LPG base delivery fee, included distance, per-km fee and pricing approvals."
              onClick={() => props.onNavigate("/delivery-pricing")}
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
              title="System health & history"
              description="Check service health, failed work, incidents, activity history, and important changes."
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
            label="Driver recovery"
            value={lpgDriverRecovery}
            detail="Funded LPG refills left without an assigned driver"
            onClick={() => props.onNavigate("/operations")}
          />
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
              <small>{sessionState.context?.permissions.length ?? 0} permissions</small>
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
