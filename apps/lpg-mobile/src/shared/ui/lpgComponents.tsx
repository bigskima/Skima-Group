import {
  Bell,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Home,
  MapPin,
  QrCode,
  Settings,
  ShieldCheck,
  Star,
  Truck,
  User,
  WalletCards,
} from "lucide-react";
import type { ReactNode } from "react";

import { formatMoney, normalizeStatusLabel, type SessionContext } from "@skima/frontend-core";

import {
  displayReference,
  formatStatus,
  getFirstRecordNumber,
  getFirstRecordString,
  getPublicReference,
  getRecordString,
  getStatus,
  type PlatformRecord,
  recordKey,
  statusTone,
} from "../api/records";
import type { CurrencyPreferenceState, InterfaceTheme, LpgAction, LpgTab, LpgWorkspace } from "../../features/permissions/workspaceAccess";
import { resolveProfileName, workspaceConfigs } from "../../features/permissions/workspaceAccess";
import {
  cylinderDescription,
  formatCylinderTitle,
  formatDate,
  formatTimeValue,
  moneyFromRecord,
  transactionAmount,
  transactionRows,
  transactionText,
  transactionTitle,
  walletTotal,
} from "../utilities/lpgFormat";

export function PhoneStatus() {
  return (
    <div className="phone-status" aria-hidden="true">
      <span>9:41</span>
      <div><i /><i /><i /></div>
    </div>
  );
}

export function StateScreen(props: {
  readonly title: string;
  readonly message: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}) {
  return (
    <main className="lpg-app-shell">
      <section className="phone-frame state-screen">
        <PhoneStatus />
        <BrandLockup />
        <h1>{props.title}</h1>
        <p>{props.message}</p>
        {props.actionLabel ? (
          <button type="button" className="primary-button" onClick={props.onAction}>
            {props.actionLabel}
          </button>
        ) : null}
      </section>
    </main>
  );
}

export function BrandLockup(props: { readonly badge?: string; readonly size?: "large" }) {
  return (
    <div className={`brand-lockup ${props.size === "large" ? "is-large" : ""}`}>
      <div className="brand-mark">S</div>
      <strong>SKIMA</strong>
      {props.badge ? <span>{props.badge}</span> : null}
    </div>
  );
}

export function StepDots(props: { readonly total: number; readonly active: number }) {
  return (
    <div className="step-dots" aria-hidden="true">
      {Array.from({ length: props.total }, (_, index) => (
        <span key={index} className={index === props.active ? "is-active" : ""} />
      ))}
    </div>
  );
}

export function IconBubble(props: {
  readonly label: string;
  readonly badge?: string;
  readonly children: ReactNode;
}) {
  return (
    <button type="button" className="icon-bubble" aria-label={props.label}>
      {props.children}
      {props.badge ? <span>{props.badge}</span> : null}
    </button>
  );
}

export function PageHeading(props: {
  readonly title: string;
  readonly subtitle?: string;
  readonly icon?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>{props.title}</h1>
        {props.subtitle ? <p>{props.subtitle}</p> : null}
      </div>
      {props.icon ? <IconBubble label={props.title}>{props.icon}</IconBubble> : null}
    </header>
  );
}

export function SectionHeader(props: {
  readonly title: string;
  readonly action?: string;
  readonly onAction?: () => void;
}) {
  return (
    <div className="section-header">
      <h2>{props.title}</h2>
      {props.action ? (
        <button type="button" onClick={props.onAction}>
          {props.action}
          <ChevronRight aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function StatusChip(props: {
  readonly label: string;
  readonly tone: "success" | "warning" | "danger" | "info";
}) {
  return <span className={`status-chip is-${props.tone}`}>{props.label}</span>;
}

export function CylinderIcon() {
  return <QrCode aria-hidden="true" />;
}

export function CylinderArt(props: {
  readonly size: "small" | "large" | "scan";
  readonly tone: "red" | "gray" | "mixed";
}) {
  return (
    <div className={`cylinder-art is-${props.size} is-${props.tone}`} aria-hidden="true">
      <span />
      <b>S</b>
      <i />
    </div>
  );
}

export function WalletArt() {
  return (
    <div className="wallet-art" aria-hidden="true">
      <span>S</span>
      <i />
      <b />
    </div>
  );
}

export function StationArt() {
  return (
    <div className="station-art" aria-hidden="true">
      <span />
      <i />
      <b>SKIMA</b>
    </div>
  );
}

export function DriverArt(props: { readonly compact?: boolean }) {
  return (
    <div className={`driver-art ${props.compact ? "is-compact" : ""}`} aria-hidden="true">
      <span />
      <i />
      <b />
    </div>
  );
}

export function AppHeader(props: {
  readonly context: SessionContext;
  readonly workspace: LpgWorkspace;
  readonly availableWorkspaces: readonly LpgWorkspace[];
  readonly onWorkspaceChange: (workspace: LpgWorkspace) => void;
  readonly onSignOut: () => void;
}) {
  return (
    <header className="app-header">
      <button type="button" aria-label="Menu" className="icon-button">
        <Settings aria-hidden="true" />
      </button>
      <div>
        <strong>{workspaceConfigs[props.workspace].title}</strong>
        <span>{workspaceConfigs[props.workspace].subtitle}</span>
      </div>
      <button type="button" aria-label="Notifications" className="icon-button notification-dot">
        <Bell aria-hidden="true" />
      </button>
      <button type="button" className="icon-button" onClick={props.onSignOut}>
        Sign out
      </button>
      {props.availableWorkspaces.length > 1 ? (
        <div className="workspace-switcher" aria-label="Workspace switcher">
          {props.availableWorkspaces.map((workspace) => (
            <button
              key={workspace}
              type="button"
              className={workspace === props.workspace ? "is-active" : ""}
              onClick={() => props.onWorkspaceChange(workspace)}
            >
              {workspaceConfigs[workspace].label}
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}

export function BottomNav(props: {
  readonly workspace: LpgWorkspace;
  readonly tab: LpgTab;
  readonly onChange: (tab: LpgTab) => void;
}) {
  return (
    <nav className="bottom-nav" aria-label={`${workspaceConfigs[props.workspace].label} navigation`}>
      {workspaceConfigs[props.workspace].nav.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`${item.key === props.tab ? "is-active" : ""} ${item.center ? "is-center" : ""}`}
          onClick={() => props.onChange(item.key)}
        >
          {navIcon(item.key)}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function ActiveOrderCard(props: {
  readonly order: PlatformRecord | null;
  readonly onOpenOrders: () => void;
}) {
  if (!props.order) {
    return (
      <section className="active-order-card is-empty">
        <div>
          <span>Ready when you are</span>
          <h2>No active refill</h2>
          <p>Your active LPG order and live route will appear here.</p>
        </div>
        <MapPreview compact />
      </section>
    );
  }

  const status = getStatus(props.order, "pending");

  return (
    <section className="active-order-card">
      <div>
        <span>Active Order</span>
        <h2>{displayReference(props.order)}</h2>
        <p>{formatStatus(status)}</p>
        <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
      </div>
      <MapPreview compact />
      <button type="button" onClick={props.onOpenOrders}>Live Tracking</button>
    </section>
  );
}

export function QuickActions(props: {
  readonly actions: readonly (readonly [string, LpgAction, ReactNode])[];
  readonly onAction: (action: LpgAction) => void;
}) {
  return (
    <section className="quick-actions" aria-label="Quick actions">
      {props.actions.map(([label, action, icon]) => (
        <button key={label} type="button" onClick={() => props.onAction(action)}>
          <span>{icon}</span>
          <strong>{label}</strong>
        </button>
      ))}
    </section>
  );
}

export function HorizontalCards(props: { readonly children: ReactNode }) {
  return <div className="horizontal-cards">{props.children}</div>;
}

export function EmptyMiniCard(props: { readonly title: string }) {
  return (
    <article className="mini-card empty-mini">
      <ShieldCheck aria-hidden="true" />
      <strong>{props.title}</strong>
    </article>
  );
}

export function MiniCylinderCard(props: { readonly cylinder: PlatformRecord; readonly media?: ReactNode }) {
  return (
    <article className="mini-card">
      {props.media ?? <span className="runtime-media-placeholder"><QrCode aria-hidden="true" /></span>}
      <div>
        <strong>{formatCylinderTitle(props.cylinder)}</strong>
        <span>{formatStatus(getStatus(props.cylinder, "registered"))}</span>
      </div>
      <ChevronRight aria-hidden="true" />
    </article>
  );
}

export function CylinderCard(props: { readonly cylinder: PlatformRecord; readonly media?: ReactNode }) {
  const status = getStatus(props.cylinder, "registered");
  const due = Boolean(getRecordString(props.cylinder, "next_inspection_at"));

  return (
    <article className="cylinder-card">
      {props.media ?? <span className="runtime-media-placeholder"><QrCode aria-hidden="true" /></span>}
      <div>
        <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
        <h2>{formatCylinderTitle(props.cylinder)}</h2>
        <p>{cylinderDescription(props.cylinder)}</p>
        <div className="info-grid">
          <InfoTile icon={<Calendar />} title="Last refill" text={formatDate(props.cylinder, "last_refill_at")} />
          <InfoTile
            icon={<ShieldCheck />}
            title="Next inspection"
            text={due ? formatDate(props.cylinder, "next_inspection_at") : "Not scheduled"}
          />
        </div>
      </div>
      <QrCode aria-hidden="true" />
    </article>
  );
}

export function SafetyCard(props: { readonly onAction?: () => void }) {
  return (
    <section className="safety-card">
      <ShieldCheck aria-hidden="true" />
      <div>
        <h2>Cylinder safety is important</h2>
        <p>Always ensure your cylinder is in good condition before refill.</p>
      </div>
      <button type="button" className="outline-button" onClick={props.onAction}>Safety Tips</button>
    </section>
  );
}

export function Segmented(props: { readonly labels: readonly string[]; readonly activeIndex: number }) {
  return (
    <div className="segmented">
      {props.labels.map((label, index) => (
        <button key={label} type="button" className={index === props.activeIndex ? "is-active" : ""}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function ProgressStepper(props: {
  readonly steps: readonly string[];
  readonly activeIndex: number;
}) {
  return (
    <div className="progress-stepper">
      {props.steps.map((step, index) => (
        <div key={step} className={index <= props.activeIndex ? "is-complete" : ""}>
          <span>{index <= props.activeIndex ? <CheckCircle2 aria-hidden="true" /> : index + 1}</span>
          <small>{step}</small>
        </div>
      ))}
    </div>
  );
}

export function MapPreview(props: { readonly compact?: boolean }) {
  return (
    <div className={`map-preview ${props.compact ? "is-compact" : ""}`} aria-label="Route preview">
      <span className="route-line" />
      <i className="map-pin start" />
      <i className="map-pin end" />
      <b className="vehicle-dot" />
    </div>
  );
}

export function InfoTile(props: { readonly icon: ReactNode; readonly title: string; readonly text: string }) {
  return (
    <article className="info-tile">
      <span>{props.icon}</span>
      <small>{props.title}</small>
      <strong>{props.text}</strong>
    </article>
  );
}

export function Timeline(props: { readonly items: readonly (readonly [string, string, boolean])[] }) {
  return (
    <section className="timeline-card">
      {props.items.map(([time, title, done]) => (
        <article key={`${time}-${title}`} className={done ? "is-done" : ""}>
          <span />
          <time>{time}</time>
          <strong>{title}</strong>
        </article>
      ))}
    </section>
  );
}

export function TransactionList(props: {
  readonly commissions: readonly PlatformRecord[];
  readonly currencyCode: string;
  readonly deposits: readonly PlatformRecord[];
  readonly settlements: readonly PlatformRecord[];
  readonly withdrawals: readonly PlatformRecord[];
}) {
  const rows = transactionRows(props).slice(0, 8);

  if (rows.length === 0) {
    return (
      <PolishedEmpty
        icon={<WalletCards />}
        title="No wallet activity returned"
        message="Ledger-backed deposits, withdrawals, settlements, and commissions will appear here."
      />
    );
  }

  return (
    <section className="transaction-list">
      {rows.map((row, index) => {
        const amount = transactionAmount(row);
        const status = getStatus(row, "recorded");

        return (
          <article key={recordKey(row, `transaction-${index}`)} className="transaction-row">
            <span className={`transaction-icon is-${statusTone(status)}`}>
              <WalletCards aria-hidden="true" />
            </span>
            <div>
              <strong>{transactionTitle(row)}</strong>
              <small>{transactionText(row)}</small>
            </div>
            <div className="transaction-amount">
              <b>{amount !== null ? formatMoney(amount, props.currencyCode) : "Awaiting amount"}</b>
              <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
            </div>
          </article>
        );
      })}
    </section>
  );
}

export function ProfileCard(props: {
  readonly context: SessionContext;
  readonly media?: ReactNode;
}) {
  const name = resolveProfileName(props.context);

  return (
    <section className="profile-card">
      <div className="avatar-large">{props.media ?? initials(name)}</div>
      <div>
        <h2>{name}</h2>
        <StatusChip tone={statusTone(props.context.profile?.status ?? "active")} label={formatStatus(props.context.profile?.status ?? "Verified")} />
        <p>{props.context.user.email ?? "Phone verified"}</p>
      </div>
      <ChevronRight aria-hidden="true" />
    </section>
  );
}

export function WalletMiniPanel(props: {
  readonly balance: number;
  readonly currencyCode: string;
  readonly onWallet: () => void;
  readonly onWithdraw: () => void;
}) {
  return (
    <section className="wallet-mini-panel">
      <div>
        <span>Skima Wallet</span>
        <small>Available Balance</small>
        <strong>{formatMoney(props.balance, props.currencyCode)}</strong>
        <div className="split-actions">
          <button type="button" className="primary-button" onClick={props.onWallet}>View Wallet</button>
          <button type="button" className="outline-button" onClick={props.onWithdraw}>Withdraw</button>
        </div>
      </div>
      <WalletArt />
    </section>
  );
}

export function QuickLinks(props: { readonly links: readonly (readonly [string, ReactNode, () => void])[] }) {
  return (
    <section className="quick-links">
      {props.links.map(([label, icon, onClick]) => (
        <button key={label} type="button" onClick={onClick}>
          <span>{icon}</span>
          <strong>{label}</strong>
        </button>
      ))}
    </section>
  );
}

export function SettingsPanel(props: {
  readonly currencyState: CurrencyPreferenceState;
  readonly hiddenCurrencyCodes: readonly string[];
  readonly theme: InterfaceTheme;
  readonly onHiddenCurrencyCodesChange: (codes: readonly string[]) => void;
  readonly onThemeChange: (theme: InterfaceTheme) => void;
}) {
  const hidden = new Set(props.hiddenCurrencyCodes.map((code) => code.toUpperCase()));

  function toggleCurrency(code: string) {
    const normalized = code.toUpperCase();
    const next = new Set(hidden);
    if (next.has(normalized)) next.delete(normalized);
    else next.add(normalized);
    props.onHiddenCurrencyCodesChange(Array.from(next));
  }

  return (
    <section className="settings-panel">
      <h2>Settings</h2>
      <div className="setting-group">
        <strong>Appearance</strong>
        <div className="toggle-grid">
          {(["system", "light", "dark"] as const).map((theme) => (
            <button
              key={theme}
              type="button"
              className={props.theme === theme ? "is-active" : ""}
              onClick={() => props.onThemeChange(theme)}
            >
              {normalizeStatusLabel(theme)}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-group">
        <strong>Currency visibility</strong>
        <p>Admin controls availability. You can hide currencies from your own app where allowed.</p>
        {props.currencyState.globallyEnabledCurrencies.map((currency) => (
          <button
            key={currency.code}
            type="button"
            className={`currency-row ${currency.hiddenByUser ? "is-muted" : ""}`}
            disabled={currency.lockedForProfile}
            onClick={() => toggleCurrency(currency.code)}
          >
            <span>{currency.symbol ?? currency.code}</span>
            <strong>{currency.displayName}</strong>
            <small>
              {currency.lockedForProfile
                ? "Unavailable for this account"
                : currency.hiddenByUser
                ? "Hidden"
                : "Visible"}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}

export function JobList(props: {
  readonly currencyCode: string;
  readonly jobs: readonly PlatformRecord[];
  readonly onAction: (action: LpgAction) => void;
  readonly detailed?: boolean;
}) {
  if (props.jobs.length === 0) {
    return (
      <PolishedEmpty
        icon={<ClipboardList />}
        title="No jobs returned"
        message="Approved jobs will appear here after dispatch assigns them to this workspace."
      />
    );
  }

  return (
    <div className="job-list">
      {props.jobs.map((job, index) => {
        const status = getStatus(job, "pending");
        const requestedKg = getFirstRecordNumber(job, ["requestedKg", "requested_kg"]);

        return (
          <article key={recordKey(job, `job-${index}`)} className="job-card">
            <span className="runtime-media-placeholder" aria-label="Cylinder image unavailable">
              <QrCode aria-hidden="true" />
            </span>
            <div>
              <h2>{requestedKg !== null ? `Refill ${requestedKg}kg Cylinder` : "LPG refill job"}</h2>
              <p><span /> Status<br />{formatStatus(status)}</p>
              <p><i /> Order<br />{displayReference(job)}</p>
            </div>
            <aside>
              <strong>{moneyFromRecord(job, ["driver_commission_amount", "station_amount", "total_amount"], props.currencyCode)}</strong>
              <small>{formatTimeValue(getFirstRecordString(job, ["updatedAt", "updated_at"]))}</small>
              <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
              <button type="button" className="primary-button" onClick={() => props.onAction("accept-job")}>
                Accept Job
              </button>
              {props.detailed ? <button type="button" className="outline-button">View Details</button> : null}
            </aside>
          </article>
        );
      })}
    </div>
  );
}

export function DriverStats(props: {
  readonly commissions: readonly PlatformRecord[];
  readonly currencyCode: string;
  readonly jobs: readonly PlatformRecord[];
}) {
  const completed = props.jobs.filter((job) => getStatus(job, "").includes("completed")).length;
  const earnings = props.commissions.reduce(
    (total, record) => total + (getFirstRecordNumber(record, ["amount"]) ?? 0),
    0,
  );

  return (
    <div className="metric-grid">
      <MetricCard icon={<ClipboardList />} value={String(completed)} label="Completed Jobs" />
      <MetricCard icon={<Calendar />} value="Policy" label="Online Time" />
      <MetricCard icon={<WalletCards />} value={formatMoney(earnings, props.currencyCode)} label="Earnings" />
      <MetricCard icon={<Star />} value="Backend" label="Rating" />
    </div>
  );
}

export function DriverMiniCard(props: { readonly order?: PlatformRecord | null; readonly compact?: boolean }) {
  const driverId = getFirstRecordString(props.order, ["driverProfileId", "driver_profile_id"]);

  return (
    <article className={`driver-mini-card ${props.compact ? "is-compact" : ""}`}>
      <div className="avatar-small">{driverId ? "DR" : "SK"}</div>
      <div>
        <strong>{driverId ? "Assigned driver" : "Driver pending"}</strong>
        <small>{getFirstRecordString(props.order, ["assignmentStatus", "assignment_status"]) ?? "Awaiting dispatch"}</small>
      </div>
    </article>
  );
}

export function StationOrderList(props: {
  readonly currencyCode: string;
  readonly orders: readonly PlatformRecord[];
  readonly onAction: (action: LpgAction) => void;
  readonly detailed?: boolean;
}) {
  if (props.orders.length === 0) {
    return (
      <PolishedEmpty
        icon={<ClipboardList />}
        title="No station jobs returned"
        message="Incoming refill jobs will appear after payment reservation and dispatch."
      />
    );
  }

  return (
    <div className="station-order-list">
      {props.orders.map((order, index) => {
        const requestedKg = getFirstRecordNumber(order, ["requestedKg", "requested_kg"]);
        const status = getStatus(order, "pending");

        return (
          <article key={recordKey(order, `station-order-${index}`)} className="station-order-card">
            <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
            <span className="runtime-media-placeholder" aria-label="Cylinder image unavailable">
              <QrCode aria-hidden="true" />
            </span>
            <div>
              <h2>{displayReference(order)}</h2>
              <p>{requestedKg !== null ? `${requestedKg}kg requested` : "Requested kg pending"}</p>
              <small>{formatTimeValue(getFirstRecordString(order, ["updatedAt", "updated_at"]))}</small>
            </div>
            <aside>
              <strong>{moneyFromRecord(order, ["station_amount", "lpg_amount", "total_amount"], props.currencyCode)}</strong>
              <button type="button" className={index === 0 ? "primary-button" : "outline-button"} onClick={() => props.onAction("scan-cylinder")}>
                Scan Cylinder
              </button>
            </aside>
            {props.detailed ? (
              <div className="station-order-detail">
                <InfoTile icon={<User />} title="Customer" text="Backend verified" />
                <InfoTile icon={<MapPin />} title="Order" text={displayReference(order)} />
                <InfoTile icon={<CreditCard />} title="Payment" text={formatStatus(getFirstRecordString(order, ["payment_status", "paymentStatus"]))} />
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export function MetricCard(props: {
  readonly icon: ReactNode;
  readonly value: string;
  readonly label: string;
  readonly action?: string;
  readonly trend?: string;
}) {
  return (
    <article className="metric-card">
      <span>{props.icon}</span>
      <strong>{props.value}</strong>
      <small>{props.label}</small>
      {props.action ? <b>{props.action}</b> : null}
      {props.trend ? <em>{props.trend}</em> : null}
    </article>
  );
}

export function TodaySummary(props: {
  readonly currencyCode: string;
  readonly jobs: readonly PlatformRecord[];
  readonly settlements: readonly PlatformRecord[];
}) {
  const completed = props.jobs.filter((job) => getStatus(job, "").includes("completed")).length;
  const inProgress = props.jobs.filter((job) => !getStatus(job, "").includes("completed")).length;
  const earned = props.settlements.reduce(
    (total, record) => total + (getFirstRecordNumber(record, ["net_amount", "gross_amount"]) ?? 0),
    0,
  );

  return (
    <section className="today-summary">
      <SectionHeader title="Today's Summary" action="View report" />
      <div className="metric-grid">
        <MetricCard icon={<CheckCircle2 />} value={String(completed)} label="Jobs Completed" />
        <MetricCard icon={<Calendar />} value={String(inProgress)} label="In Progress" />
        <MetricCard icon={<WalletCards />} value={formatMoney(earned, props.currencyCode)} label="Total Earned" />
        <MetricCard icon={<WalletCards />} value="Policy" label="Pending" />
      </div>
    </section>
  );
}

export function EarningsTrend() {
  return (
    <section className="trend-card">
      <SectionHeader title="Earnings Trend" action="Backend range" />
      <PolishedEmpty
        icon={<WalletCards />}
        title="No trend data returned"
        message="Ledger summaries can render here after the reporting API is enabled."
      />
    </section>
  );
}

export function CylinderInventoryRow(props: { readonly cylinder: PlatformRecord }) {
  const status = getStatus(props.cylinder, "available");

  return (
    <article className="inventory-row">
      <span className="runtime-media-placeholder" aria-label="Cylinder image unavailable">
        <QrCode aria-hidden="true" />
      </span>
      <div>
        <h2>{getPublicReference(props.cylinder) ?? getFirstRecordString(props.cylinder, ["cylinder_identifier"]) ?? "Reference pending"}</h2>
        <p>{formatCylinderTitle(props.cylinder)}</p>
        <small>{cylinderDescription(props.cylinder)}</small>
      </div>
      <StatusChip tone={statusTone(status)} label={formatStatus(status)} />
      <ChevronRight aria-hidden="true" />
    </article>
  );
}

export function PolishedEmpty(props: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly message: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}) {
  return (
    <section className="polished-empty">
      <span>{props.icon}</span>
      <h2>{props.title}</h2>
      <p>{props.message}</p>
      {props.actionLabel ? (
        <button type="button" className="primary-button" onClick={props.onAction}>
          {props.actionLabel}
        </button>
      ) : null}
    </section>
  );
}

export function MenuRow(props: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly text: string;
  readonly trailing?: ReactNode;
}) {
  return (
    <article className="menu-row">
      <span>{props.icon}</span>
      <div>
        <strong>{props.title}</strong>
        <small>{props.text}</small>
      </div>
      {props.trailing ?? <ChevronRight aria-hidden="true" />}
    </article>
  );
}

export function AdminQueue(props: { readonly title: string; readonly value: number; readonly text: string }) {
  return (
    <article className="admin-queue">
      <strong>{props.value}</strong>
      <div>
        <h2>{props.title}</h2>
        <p>{props.text}</p>
      </div>
      <ChevronRight aria-hidden="true" />
    </article>
  );
}

export function navIcon(tab: LpgTab): ReactNode {
  if (tab === "home" || tab === "dashboard") return <Home aria-hidden="true" />;
  if (tab === "cylinders" || tab === "scan") return <QrCode aria-hidden="true" />;
  if (tab === "orders" || tab === "jobs" || tab === "operations") {
    return <ClipboardList aria-hidden="true" />;
  }
  if (tab === "wallet" || tab === "earnings" || tab === "settlements" || tab === "finance") {
    return <WalletCards aria-hidden="true" />;
  }
  return <User aria-hidden="true" />;
}

export function initials(value: string): string {
  const parts = value.split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "S"}${parts[1]?.[0] ?? "K"}`.toUpperCase();
}

export function profileInitials(context: SessionContext): string {
  return initials(resolveProfileName(context));
}

export function walletBalanceLabel(
  records: readonly PlatformRecord[],
  currencyCode: string,
): string {
  return formatMoney(walletTotal(records, currencyCode), currencyCode);
}
