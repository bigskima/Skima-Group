import {
  Bell,
  BriefcaseBusiness,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  FileCheck2,
  Gift,
  Grid3X3,
  Home,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  QrCode,
  RefreshCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Truck,
  User,
  WalletCards,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { z } from "zod";

import {
  ApiGatewayError,
  createClientIdempotencyKey,
  formatMoney,
  hasPermission,
  type PermissionContext,
  type SessionContext,
} from "@skima/frontend-core";
import {
  type BusinessModuleVisualIdentity,
  mobileCurrencyPreferencePolicy,
  mobileInteractionTokens,
  type MobileInterfaceTheme,
  mobileInterfaceThemeOptions,
  type MobileTone,
} from "@skima/mobile-design";

import {
  phaseOneLpgExperience,
  type PhaseOneNavigationItem,
  type PhaseOneProductOption,
  type PhaseOneRoleExperience,
  resolvePhaseOneIdentity,
  resolvePhaseOneRoleExperience,
} from "./phase-one-lpg";
import { useMobileSession } from "./session";

type PlatformRecord = Readonly<Record<string, unknown>>;
type MobileRole = "customer" | "driver" | "partner" | "admin";
type MobileTab = "home" | "services" | "orders" | "wallet" | "messages" | "account";
type MobileActionKind =
  | "request"
  | "lpgCylinder"
  | "location"
  | "application"
  | "deposit"
  | "otp"
  | "tracking"
  | "verification";
type InterfaceTheme = MobileInterfaceTheme;

interface RoleOption {
  readonly key: MobileRole;
  readonly label: string;
  readonly title: string;
  readonly description: string;
}

interface MobileQueries {
  readonly applications: MobileQueryResult;
  readonly applicationTypes: MobileQueryResult;
  readonly assignments: MobileQueryResult;
  readonly branches: MobileQueryResult;
  readonly catalogItems: MobileQueryResult;
  readonly currencies: MobileQueryResult;
  readonly documents: MobileQueryResult;
  readonly drivers: MobileQueryResult;
  readonly lpgActiveOrders: MobileQueryResult;
  readonly lpgCylinders: MobileQueryResult;
  readonly lpgLocations: MobileQueryResult;
  readonly lpgOrders: MobileQueryResult;
  readonly lpgQuotes: MobileQueryResult;
  readonly messages: MobileQueryResult;
  readonly modules: MobileQueryResult;
  readonly orders: MobileQueryResult;
  readonly serviceRequests: MobileQueryResult;
  readonly vehicles: MobileQueryResult;
  readonly verificationDefinitions: MobileQueryResult;
  readonly walletBalances: MobileQueryResult;
}

interface MobileActionSubmission {
  readonly kind: MobileActionKind;
  readonly path: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

interface MobileActionSubmissionInput {
  readonly actionKind: MobileActionKind;
  readonly amountNgn: string;
  readonly applicationTypeKey: string;
  readonly cylinderBrand: string;
  readonly cylinderColour: string;
  readonly cylinderId: string;
  readonly cylinderIdentifier: string;
  readonly cylinderSizeKg: string;
  readonly currencyCode: string;
  readonly deliveryLocationId: string;
  readonly formattedAddress: string;
  readonly latitude: string;
  readonly locationLabel: string;
  readonly longitude: string;
  readonly maxCapacityKg: string;
  readonly moduleKey: string;
  readonly note: string;
  readonly pickupLocationId: string;
  readonly recipientAddress: string;
  readonly requestedKg: string;
  readonly serviceRequestId: string;
  readonly userEmail: string | null;
  readonly verificationDefinitionKey: string;
  readonly walletId: string;
}

const RecordArraySchema = z.array(z.record(z.unknown()));
const ModuleArraySchema = z.array(z.record(z.unknown()));
const ActionResponseSchema = z.union([z.string(), z.record(z.unknown())]);
type MobileQueryResult = UseQueryResult<PlatformRecord[], Error>;
type MobileActionResult = z.infer<typeof ActionResponseSchema>;

const themeStorageKey = "skima.mobile.theme";
const currencyStorageKey = "skima.mobile.currency";

const roleOptions: readonly RoleOption[] = [
  {
    key: "customer",
    label: "Customer",
    title: "LPG refill",
    description: "Register cylinders, request refill, track delivery, and verify safely.",
  },
  {
    key: "driver",
    label: "Driver",
    title: "Work on your terms",
    description: "See qualified jobs, manage vehicles, track trips, and receive earnings.",
  },
  {
    key: "partner",
    label: "Station",
    title: "Run station work",
    description: "Manage refill jobs, cylinder scans, capacity, staff, and settlement.",
  },
  {
    key: "admin",
    label: "Admin",
    title: "Platform command",
    description: "Review applications, monitor finance, manage users, and resolve issues.",
  },
];

const tabIcons: Readonly<Record<MobileTab, ReactNode>> = {
  account: <User aria-hidden="true" />,
  home: <Home aria-hidden="true" />,
  messages: <MessageCircle aria-hidden="true" />,
  orders: <ClipboardList aria-hidden="true" />,
  services: <Grid3X3 aria-hidden="true" />,
  wallet: <WalletCards aria-hidden="true" />,
};

export function MobileApp() {
  const session = useMobileSession();

  if (session.status === "loading") {
    return <ScreenState title="Loading Skima" message="Preparing your account." />;
  }

  if (session.status === "unauthenticated") {
    return <PublicEntry />;
  }

  if (session.status === "error" || !session.context) {
    return (
      <ScreenState
        title="Account unavailable"
        message={session.error ?? "We could not load your account."}
        actionLabel="Try again"
        onAction={session.refreshContext}
      />
    );
  }

  return <ConnectedMobileApp context={session.context} />;
}

function ConnectedMobileApp(props: { readonly context: SessionContext }) {
  const session = useMobileSession();
  const queryClient = useQueryClient();
  const availableRoles = useMemo(() => resolveAvailableRoles(props.context), [props.context]);
  const [activeRole, setActiveRole] = useState<MobileRole>(availableRoles[0]?.key ?? "customer");
  const [activeTab, setActiveTab] = useState<MobileTab>("home");
  const [activeAction, setActiveAction] = useState<MobileActionKind | null>(null);
  const [theme, setTheme] = useStoredPreference<InterfaceTheme>(
    themeStorageKey,
    "system",
    isInterfaceTheme,
  );
  const [preferredCurrency, setPreferredCurrency] = useStoredPreference<string>(
    currencyStorageKey,
    mobileCurrencyPreferencePolicy.clientFallbackCode,
    isNonEmptyString,
  );
  const permissionContext = useMemo(() => toPermissionContext(props.context), [props.context]);
  const resolvedTheme = useResolvedTheme(theme);
  const activeExperience = resolvePhaseOneRoleExperience(activeRole);

  useEffect(() => {
    if (!availableRoles.some((role) => role.key === activeRole)) {
      setActiveRole(availableRoles[0]?.key ?? "customer");
    }
  }, [activeRole, availableRoles]);

  const modules = useGatewayRecords("modules", "/modules", true);
  const currencies = useGatewayRecords("currencies", "/engines/currencies", true);
  const applicationTypes = useGatewayRecords(
    "application-types",
    "/runtime/application-types",
    true,
  );
  const verificationDefinitions = useGatewayRecords(
    "verification-definitions",
    "/engines/verification-definitions",
    true,
  );
  const walletBalances = useGatewayRecords("wallet-balances", "/runtime/wallet-balances", true);
  const orders = useGatewayRecords("orders", "/runtime/orders", true);
  const serviceRequests = useGatewayRecords(
    "service-requests",
    "/runtime/service-requests",
    true,
  );
  const assignments = useGatewayRecords(
    "assignments",
    "/runtime/orders/assignments",
    activeRole === "driver" || activeRole === "admin",
  );
  const drivers = useGatewayRecords(
    "drivers",
    "/runtime/drivers",
    activeRole === "driver" || activeRole === "admin",
  );
  const vehicles = useGatewayRecords(
    "vehicles",
    "/runtime/vehicles",
    activeRole === "driver" || activeRole === "admin",
  );
  const branches = useGatewayRecords(
    "branches",
    "/runtime/organization-branches",
    activeRole === "partner" || activeRole === "admin",
  );
  const catalogItems = useGatewayRecords(
    "catalog-items",
    "/runtime/catalog/items",
    activeRole === "partner" || activeRole === "admin",
  );
  const applications = useGatewayRecords(
    "applications",
    "/runtime/applications",
    activeRole === "admin",
  );
  const documents = useGatewayRecords("documents", "/runtime/documents", activeRole === "admin");
  const messages = useGatewayRecords("messages", "/runtime/communications/messages", true);
  const lpgCylinders = useGatewayRecords("lpg-cylinders", "/lpg/cylinders", true);
  const lpgLocations = useGatewayRecords("lpg-locations", "/lpg/locations", true);
  const lpgQuotes = useGatewayRecords("lpg-quotes", "/lpg/quotes", true);
  const lpgOrders = useGatewayRecords("lpg-orders", "/lpg/orders", true);
  const lpgActiveOrders = useGatewayRecords("lpg-active-orders", "/lpg/orders/active", true);

  useEffect(() => {
    const enabledCurrencies = resolveEnabledCurrencies(currencies.data ?? []);

    if (
      enabledCurrencies.length > 0 &&
      !enabledCurrencies.some((currency) => currency.code === preferredCurrency)
    ) {
      setPreferredCurrency(
        enabledCurrencies[0]?.code ?? mobileCurrencyPreferencePolicy.clientFallbackCode,
      );
    }
  }, [currencies.data, preferredCurrency, setPreferredCurrency]);

  const queries: MobileQueries = {
    applications,
    applicationTypes,
    assignments,
    branches,
    catalogItems,
    currencies,
    documents,
    drivers,
    lpgActiveOrders,
    lpgCylinders,
    lpgLocations,
    lpgOrders,
    lpgQuotes,
    messages,
    modules,
    orders,
    serviceRequests,
    vehicles,
    verificationDefinitions,
    walletBalances,
  };

  const refreshAll = () => void queryClient.invalidateQueries({ queryKey: ["mobile-gateway"] });

  return (
    <main
      className="mobile-app"
      data-theme={resolvedTheme}
      style={{
        "--mobile-touch-target": `${mobileInteractionTokens.touchTargetMin}px`,
      } as CSSProperties}
    >
      <section className="mobile-device" data-theme={resolvedTheme} aria-label="Skima mobile app">
        <HeaderBar
          context={props.context}
          activeRole={activeRole}
          experience={activeExperience}
          onRefresh={refreshAll}
          onSignOut={session.signOut}
        />

        <RoleRail roles={availableRoles} activeRole={activeRole} onChange={setActiveRole} />

        <div className="mobile-screen">
          {activeTab === "home"
            ? (
              <HomeScreen
                context={props.context}
                activeRole={activeRole}
                currencyCode={preferredCurrency}
                experience={activeExperience}
                permissionContext={permissionContext}
                queries={queries}
                onAction={setActiveAction}
                onTabChange={setActiveTab}
              />
            )
            : null}
          {activeTab === "services"
            ? (
              <ServicesScreen
                activeRole={activeRole}
                currencyCode={preferredCurrency}
                experience={activeExperience}
                queries={queries}
                onAction={setActiveAction}
              />
            )
            : null}
          {activeTab === "orders"
            ? (
              <OrdersScreen
                activeRole={activeRole}
                experience={activeExperience}
                queries={queries}
                onAction={setActiveAction}
              />
            )
            : null}
          {activeTab === "wallet"
            ? (
              <WalletScreen
                currencyCode={preferredCurrency}
                queries={queries}
                onAction={setActiveAction}
              />
            )
            : null}
          {activeTab === "messages" ? <MessagesScreen queries={queries} /> : null}
          {activeTab === "account"
            ? (
              <AccountScreen
                context={props.context}
                activeRole={activeRole}
                currencyCode={preferredCurrency}
                theme={theme}
                queries={queries}
                onAction={setActiveAction}
                onCurrencyChange={setPreferredCurrency}
                onSignOut={session.signOut}
                onThemeChange={setTheme}
              />
            )
            : null}
        </div>

        <BottomNavigation
          activeTab={activeTab}
          items={activeExperience.nav}
          onTabChange={setActiveTab}
        />

        {activeAction
          ? (
            <ActionSheet
              actionKind={activeAction}
              context={props.context}
              currencyCode={preferredCurrency}
              queries={queries}
              onClose={() => setActiveAction(null)}
              onCompleted={refreshAll}
            />
          )
          : null}
      </section>
    </main>
  );
}

function PublicEntry() {
  const session = useMobileSession();
  const [theme] = useStoredPreference<InterfaceTheme>(themeStorageKey, "system", isInterfaceTheme);
  const resolvedTheme = useResolvedTheme(theme);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isIntroExpanded, setIntroExpanded] = useState(true);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await session.signIn(email, password);
  }

  return (
    <main className="mobile-app mobile-public" data-theme={resolvedTheme}>
      <section className="mobile-device mobile-device--public" data-theme={resolvedTheme}>
        {isIntroExpanded
          ? (
            <section className="mobile-splash">
              <div className="skima-mark">S</div>
              <h1>Safe LPG refills, handled end to end.</h1>
              <p>Register your cylinder, pay securely, track pickup, and verify delivery.</p>
              <div className="mobile-splash-road" aria-hidden="true" />
              <button
                type="button"
                className="mobile-primary-action"
                onClick={() => setIntroExpanded(false)}
              >
                Get Started
              </button>
              <button
                type="button"
                className="mobile-secondary-action"
                onClick={() => setIntroExpanded(false)}
              >
                See how it works
              </button>
            </section>
          )
          : (
            <>
              <button type="button" className="mobile-skip" onClick={() => setIntroExpanded(true)}>
                Preview
              </button>
              <section className="mobile-onboarding-card">
                <h2>Your cylinder, tracked from pickup to delivery</h2>
                <p>Skima connects refill quote, escrow, station scan, driver route, and OTP.</p>
                <div className="mobile-illustration" aria-hidden="true">
                  <span />
                  <i />
                  <b />
                </div>
              </section>

              <form className="mobile-login-card" onSubmit={handleSubmit}>
                <div className="mobile-login-brand">
                  <div className="skima-mark">S</div>
                  <strong>SKIMA</strong>
                </div>
                <h1>Welcome back</h1>
                <p>Login to continue</p>

                <label>
                  Phone number or email
                  <input
                    autoComplete="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.currentTarget.value)}
                    required
                  />
                </label>
                <label>
                  Password
                  <input
                    autoComplete="current-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.currentTarget.value)}
                    required
                  />
                </label>

                {session.error ? <p className="mobile-form-error">{session.error}</p> : null}

                <button
                  type="submit"
                  className="mobile-primary-action"
                  disabled={session.status === "loading"}
                >
                  Login
                </button>
              </form>
            </>
          )}
      </section>
    </main>
  );
}

function HeaderBar(props: {
  readonly context: SessionContext;
  readonly activeRole: MobileRole;
  readonly experience: PhaseOneRoleExperience;
  readonly onRefresh: () => void;
  readonly onSignOut: () => void;
}) {
  const name = profileName(props.context);

  return (
    <header className="mobile-header">
      <button type="button" aria-label="Menu">
        <Menu aria-hidden="true" />
      </button>
      <div>
        <strong>Hello, {name}</strong>
        <span>{props.experience.eyebrow}</span>
      </div>
      <button type="button" aria-label="Refresh" onClick={props.onRefresh}>
        <RefreshCcw aria-hidden="true" />
      </button>
      <button type="button" aria-label="Sign out" onClick={props.onSignOut}>
        <LogOut aria-hidden="true" />
      </button>
    </header>
  );
}

function RoleRail(props: {
  readonly roles: readonly RoleOption[];
  readonly activeRole: MobileRole;
  readonly onChange: (role: MobileRole) => void;
}) {
  if (props.roles.length <= 1) {
    return null;
  }

  return (
    <div className="mobile-role-rail" aria-label="Account mode">
      {props.roles.map((role) => (
        <button
          key={role.key}
          type="button"
          className={role.key === props.activeRole ? "is-active" : ""}
          onClick={() => props.onChange(role.key)}
        >
          {role.label}
        </button>
      ))}
    </div>
  );
}

function HomeScreen(props: {
  readonly context: SessionContext;
  readonly activeRole: MobileRole;
  readonly currencyCode: string;
  readonly experience: PhaseOneRoleExperience;
  readonly permissionContext: PermissionContext;
  readonly queries: MobileQueries;
  readonly onAction: (action: MobileActionKind) => void;
  readonly onTabChange: (tab: MobileTab) => void;
}) {
  const balance = walletTotal(props.queries.walletBalances.data ?? [], props.currencyCode);
  const lpgOrders = props.queries.lpgActiveOrders.data ?? props.queries.lpgOrders.data ?? [];
  const lpgCylinders = props.queries.lpgCylinders.data ?? [];
  const activeRequest = lpgOrders[0] ?? null;
  const identities = (props.queries.modules.data ?? []).map((record) =>
    resolveModuleIdentity(record)
  );
  const lpgIdentity = resolvePhaseOneIdentity(identities);
  const hasAdmin = hasPermission(props.permissionContext, "platform.admin.read") ||
    Boolean(props.context.platformAdmin);

  return (
    <>
      <section className="wallet-card">
        <div>
          <span>Wallet Balance</span>
          <strong>{formatMoney(balance, props.currencyCode)}</strong>
        </div>
        <button type="button" onClick={() => props.onAction("deposit")}>Top Up</button>
      </section>

      <section className="quick-grid" aria-label="Quick actions">
        {props.experience.quickActions.map((quickAction) => (
          <QuickAction
            key={quickAction.label}
            icon={quickActionIcon(quickAction.action, quickAction.tab)}
            label={quickAction.label}
            onClick={() =>
              quickAction.action
                ? props.onAction(quickAction.action)
                : props.onTabChange(quickAction.tab ?? "home")}
          />
        ))}
      </section>

      <section className="lpg-hero-card">
        <div>
          <span>{props.experience.eyebrow}</span>
          <h1>{props.experience.title}</h1>
          <p>{props.experience.subtitle}</p>
        </div>
        <ModuleLogo module={lpgIdentity} />
      </section>

      <section className="refer-card">
        <div>
          <strong>{activeRequest ? "Skima is handling it" : "Ready when you are"}</strong>
          <span>
            {activeRequest
              ? "Escrow, station assignment, driver route, refill, tracking, and verification stay connected."
              : "Register your cylinder, save your address, and start a refill quote."}
          </span>
        </div>
        <Gift aria-hidden="true" />
      </section>

      <SectionHeader
        title="LPG journey"
        action={props.activeRole === "customer" ? "Refill" : "Open"}
        onAction={() => props.onTabChange("services")}
      />
      <WorkflowPreview
        steps={props.experience.primaryTimeline}
        activeRecord={activeRequest}
        completedCount={activeRequest ? 2 : 0}
      />

      <section className="live-card">
        <div className="live-map" aria-hidden="true">
          <span className="pin pin-a" />
          <span className="pin pin-b" />
          <i />
        </div>
        <div className="live-card__content">
          <span>Live LPG order</span>
          <strong>
            {activeRequest
              ? normalizeLabel(getRecordString(activeRequest, "status") ?? "In progress")
              : lpgCylinders.length > 0
              ? `${lpgCylinders.length} cylinder${lpgCylinders.length === 1 ? "" : "s"} ready`
              : "Register your first cylinder"}
          </strong>
          <p>
            {activeRequest
              ? "Driver, station, refill, and verification updates will appear as the workflow moves."
              : "Cylinder history, pickup scans, station refill, and delivery verification are tracked from here."}
          </p>
          <button
            type="button"
            onClick={() => props.onAction(activeRequest ? "tracking" : "lpgCylinder")}
          >
            {activeRequest ? "Track order" : "Register cylinder"}
          </button>
        </div>
      </section>

      {hasAdmin
        ? (
          <section className="admin-snapshot">
            <Metric
              label="Applications"
              value={String(props.queries.applications.data?.length ?? 0)}
            />
            <Metric label="Documents" value={String(props.queries.documents.data?.length ?? 0)} />
            <Metric label="Drivers" value={String(props.queries.drivers.data?.length ?? 0)} />
          </section>
        )
        : null}
    </>
  );
}

function ServicesScreen(props: {
  readonly activeRole: MobileRole;
  readonly currencyCode: string;
  readonly experience: PhaseOneRoleExperience;
  readonly queries: MobileQueries;
  readonly onAction: (action: MobileActionKind) => void;
}) {
  const catalogItems = props.queries.catalogItems.data ?? [];
  const branches = props.queries.branches.data ?? [];
  const serviceRequests = props.queries.serviceRequests.data ?? [];
  const assignments = props.queries.assignments.data ?? [];
  const drivers = props.queries.drivers.data ?? [];
  const cylinders = props.queries.lpgCylinders.data ?? [];
  const locations = props.queries.lpgLocations.data ?? [];

  return (
    <>
      <ScreenTitle
        title={servicesTitle(props.activeRole)}
        subtitle={servicesSubtitle(props.activeRole)}
      />
      {props.activeRole === "customer"
        ? (
          <>
            <section className="lpg-order-panel">
              <div>
                <span>{phaseOneLpgExperience.identity.label}</span>
                <h2>Your cylinder registry</h2>
                <p>
                  Every refill starts from a registered cylinder, a saved pickup address, and a
                  backend quote that Skima can verify.
                </p>
              </div>
              <button type="button" onClick={() => props.onAction("lpgCylinder")}>Register</button>
            </section>
            <section className="quick-grid quick-grid--compact" aria-label="LPG setup">
              <QuickAction
                icon={<QrCode aria-hidden="true" />}
                label="Register cylinder"
                onClick={() => props.onAction("lpgCylinder")}
              />
              <QuickAction
                icon={<MapPin aria-hidden="true" />}
                label="Save address"
                onClick={() => props.onAction("location")}
              />
              <QuickAction
                icon={<Send aria-hidden="true" />}
                label="Refill quote"
                onClick={() => props.onAction("request")}
              />
              <QuickAction
                icon={<ShieldCheck aria-hidden="true" />}
                label="Report safety"
                onClick={() => props.onAction("verification")}
              />
            </section>
            <SectionHeader title="Saved cylinders" />
            <LiveRecordList
              emptyTitle="No cylinders registered"
              emptyMessage="Register your first LPG cylinder before placing a refill order."
              records={cylinders}
              primaryField="cylinder_identifier"
              secondaryField="condition_status"
              onAction={() => props.onAction("request")}
            />
            <SectionHeader title="Saved addresses" />
            <LiveRecordList
              emptyTitle="No saved address"
              emptyMessage="Save a pickup or delivery address so Skima can match station and driver."
              records={locations}
              primaryField="label"
              secondaryField="verification_status"
              onAction={() => props.onAction("location")}
            />
            {catalogItems.length > 0 || branches.length > 0
              ? (
                <>
                  <SectionHeader title="Station readiness" />
                  <OperationsWorkspace
                    cards={[
                      [
                        "Approved stations",
                        String(branches.length),
                        "Operational branches available for LPG matching.",
                      ],
                      [
                        "Refill products",
                        String(catalogItems.length),
                        "Backend-configured cylinder sizes and LPG prices.",
                      ],
                    ]}
                    primaryAction="Create quote"
                    onPrimaryAction={() => props.onAction("request")}
                  />
                </>
              )
              : null}
          </>
        )
        : null}
      {props.activeRole === "driver"
        ? (
          <OperationsWorkspace
            cards={[
              [
                "Available jobs",
                String(assignments.length),
                "Matched LPG jobs for your approved vehicles.",
              ],
              [
                "Active route",
                serviceRequests[0] ? "Ready" : "None",
                "Pickup, station, return, and delivery steps.",
              ],
              ["Verification", "Required", "Cylinder, station, and customer checks must pass."],
            ]}
            primaryAction="Scan now"
            onPrimaryAction={() => props.onAction("verification")}
          />
        )
        : null}
      {props.activeRole === "partner"
        ? (
          <OperationsWorkspace
            cards={[
              ["Incoming refills", String(serviceRequests.length), "Jobs awaiting station action."],
              [
                "Branches",
                String(branches.length),
                "Approved station branches and operating status.",
              ],
              [
                "Catalog",
                String(catalogItems.length),
                "Refill sizes, prices, capacity, and availability.",
              ],
            ]}
            primaryAction="Confirm refill"
            onPrimaryAction={() => props.onAction("verification")}
          />
        )
        : null}
      {props.activeRole === "admin"
        ? (
          <OperationsWorkspace
            cards={[
              ["Orders", String(serviceRequests.length), "Funded LPG orders and workflow state."],
              [
                "Drivers",
                String(drivers.length),
                "Qualification, availability, and active assignments.",
              ],
              [
                "Stations",
                String(branches.length),
                "Partner operations, documents, and settlement readiness.",
              ],
            ]}
            primaryAction="Review applications"
            onPrimaryAction={() => props.onAction("application")}
          />
        )
        : null}
    </>
  );
}

function OrdersScreen(props: {
  readonly activeRole: MobileRole;
  readonly experience: PhaseOneRoleExperience;
  readonly queries: MobileQueries;
  readonly onAction: (action: MobileActionKind) => void;
}) {
  const lpgOrders = props.queries.lpgActiveOrders.data ?? props.queries.lpgOrders.data ?? [];
  const active = lpgOrders[0] ?? null;

  return (
    <>
      <ScreenTitle
        title={ordersTitle(props.activeRole)}
        subtitle={active
          ? formatShortId(getRecordString(active, "id"))
          : ordersEmptySubtitle(props.activeRole)}
      />
      <section className="tracking-map">
        <span className="pin pin-a" />
        <span className="pin pin-b" />
        <i />
      </section>
      <section className="driver-card">
        <div className="avatar">{active ? "SK" : "S"}</div>
        <div>
          <strong>{active ? "LPG workflow in progress" : "No active LPG order"}</strong>
          <span>{normalizeLabel(getRecordString(active, "status") ?? "Ready")}</span>
        </div>
        <button type="button" onClick={() => props.onAction("tracking")}>
          <MapPin aria-hidden="true" />
        </button>
        <button type="button" onClick={() => props.onAction("verification")}>
          <QrCode aria-hidden="true" />
        </button>
      </section>
      <Timeline
        steps={props.experience.primaryTimeline.map((step, index) =>
          [
            step,
            Boolean(active) && index < (props.queries.assignments.data ?? []).length + 1,
          ] as const
        )}
      />
    </>
  );
}

function WalletScreen(props: {
  readonly currencyCode: string;
  readonly queries: MobileQueries;
  readonly onAction: (action: MobileActionKind) => void;
}) {
  const balances = props.queries.walletBalances.data ?? [];
  const total = walletTotal(balances, props.currencyCode);
  const orders = props.queries.lpgOrders.data ?? props.queries.orders.data ?? [];

  return (
    <>
      <ScreenTitle title="Wallet" subtitle="Manage payments, holds, and payouts securely." />
      <section className="wallet-card wallet-card--large">
        <div>
          <span>Available Balance</span>
          <strong>{formatMoney(total, props.currencyCode)}</strong>
        </div>
        <div className="wallet-actions">
          <button type="button" onClick={() => props.onAction("deposit")}>Top Up</button>
          <button type="button" onClick={() => props.onAction("request")}>Refill</button>
          <button type="button" onClick={() => props.onAction("otp")}>Secure</button>
        </div>
      </section>
      <SectionHeader title="Recent Transactions" />
      <div className="transaction-list">
        {balances.slice(0, 4).map((balance, index) => (
          <TransactionRow
            key={getRecordString(balance, "wallet_id") ?? String(index)}
            title={`${getRecordString(balance, "currency_code") ?? props.currencyCode} Wallet`}
            subtitle={formatShortId(getRecordString(balance, "wallet_id"))}
            amount={formatMoney(
              getRecordNumber(balance, "balance") ?? 0,
              getRecordString(balance, "currency_code") ?? props.currencyCode,
            )}
            tone="success"
          />
        ))}
        {orders.slice(0, 3).map((order, index) => (
          <TransactionRow
            key={getRecordString(order, "id") ?? String(index)}
            title="LPG refill payment"
            subtitle={normalizeLabel(getRecordString(order, "status") ?? "Pending")}
            amount={formatMoney(
              getRecordNumber(order, "calculated_amount") ?? 0,
              getRecordString(order, "currency_code") ?? props.currencyCode,
            )}
            tone="danger"
          />
        ))}
        {balances.length === 0 && orders.length === 0
          ? (
            <EmptyState
              title="No wallet activity"
              message="Deposits and payments will appear here."
            />
          )
          : null}
      </div>
    </>
  );
}

function MessagesScreen(props: { readonly queries: MobileQueries }) {
  const messages = props.queries.messages.data ?? [];

  return (
    <>
      <ScreenTitle title="Notifications" subtitle="Updates, secure codes, and service messages." />
      <div className="notification-list">
        {messages.slice(0, 8).map((message, index) => (
          <NotificationRow
            key={getRecordString(message, "id") ?? String(index)}
            title={normalizeLabel(getRecordString(message, "purpose") ?? "Skima update")}
            subtitle={normalizeLabel(getRecordString(message, "channel") ?? "In app")}
            time={normalizeLabel(getRecordString(message, "status") ?? "Queued")}
          />
        ))}
        {messages.length === 0
          ? (
            <EmptyState
              title="No notifications"
              message="Important updates and secure codes will appear here."
            />
          )
          : null}
      </div>
    </>
  );
}

function AccountScreen(props: {
  readonly context: SessionContext;
  readonly activeRole: MobileRole;
  readonly currencyCode: string;
  readonly theme: InterfaceTheme;
  readonly queries: MobileQueries;
  readonly onAction: (action: MobileActionKind) => void;
  readonly onCurrencyChange: (currencyCode: string) => void;
  readonly onSignOut: () => void;
  readonly onThemeChange: (theme: InterfaceTheme) => void;
}) {
  const applications = props.queries.applications.data ?? [];
  const enabledCurrencies = resolveEnabledCurrencies(props.queries.currencies.data ?? []);

  return (
    <>
      <section className="profile-hero">
        <button type="button" aria-label="Notifications">
          <Bell aria-hidden="true" />
        </button>
        <div className="profile-avatar">{initials(profileName(props.context))}</div>
        <h1>{profileName(props.context)}</h1>
        <span>{props.context.user.email ?? "Skima account"}</span>
        <StatusPill tone={props.context.profile?.status === "active" ? "success" : "warning"}>
          {normalizeLabel(props.context.profile?.status ?? "Verified")}
        </StatusPill>
      </section>
      <div className="account-menu">
        <MenuRow
          icon={<FileCheck2 />}
          label="Applications"
          value={String(applications.length)}
          onClick={() => props.onAction("application")}
        />
        <MenuRow
          icon={<ShieldCheck />}
          label="Security"
          value={roleTitle(props.activeRole)}
          onClick={() => props.onAction("otp")}
        />
        <MenuRow
          icon={<BriefcaseBusiness />}
          label="Business profile"
          value={String(props.queries.branches.data?.length ?? 0)}
          onClick={() => props.onAction("application")}
        />
        <MenuRow
          icon={<Truck />}
          label="Driver and fleet"
          value={String(props.queries.vehicles.data?.length ?? 0)}
          onClick={() => props.onAction("application")}
        />
        <MenuRow
          icon={<CreditCard />}
          label="Payment methods"
          value={props.currencyCode}
          onClick={() => props.onAction("deposit")}
        />
        <MenuRow
          icon={<Settings />}
          label="Interface"
          value={themeLabel(props.theme)}
          onClick={() => props.onThemeChange(nextTheme(props.theme))}
        />
        <MenuRow icon={<LogOut />} label="Log Out" value="" onClick={props.onSignOut} danger />
      </div>
      <section className="settings-panel">
        <SectionHeader title="Settings" />
        <PreferenceGroup
          label="Appearance"
          options={mobileInterfaceThemeOptions.map((option) =>
            [option.value, option.label] as const
          )}
          value={props.theme}
          onChange={(value) => props.onThemeChange(value as InterfaceTheme)}
        />
        <PreferenceGroup
          label="Display currency"
          options={enabledCurrencies.map((currency) => [currency.code, currency.code] as const)}
          value={props.currencyCode}
          onChange={props.onCurrencyChange}
        />
      </section>
    </>
  );
}

function ActionSheet(props: {
  readonly actionKind: MobileActionKind;
  readonly context: SessionContext;
  readonly currencyCode: string;
  readonly queries: MobileQueries;
  readonly onClose: () => void;
  readonly onCompleted: () => void;
}) {
  const session = useMobileSession();
  const [applicationTypeKey, setApplicationTypeKey] = useState("");
  const [moduleKey, setModuleKey] = useState("");
  const [walletId, setWalletId] = useState("");
  const [serviceRequestId, setServiceRequestId] = useState("");
  const [verificationDefinitionKey, setVerificationDefinitionKey] = useState("");
  const [amountNgn, setAmountNgn] = useState("1000");
  const [recipientAddress, setRecipientAddress] = useState(props.context.user.email ?? "");
  const [cylinderId, setCylinderId] = useState("");
  const [pickupLocationId, setPickupLocationId] = useState("");
  const [deliveryLocationId, setDeliveryLocationId] = useState("");
  const [requestedKg, setRequestedKg] = useState("6");
  const [cylinderIdentifier, setCylinderIdentifier] = useState("");
  const [cylinderSizeKg, setCylinderSizeKg] = useState("12.5");
  const [maxCapacityKg, setMaxCapacityKg] = useState("12.5");
  const [cylinderBrand, setCylinderBrand] = useState("");
  const [cylinderColour, setCylinderColour] = useState("");
  const [locationLabel, setLocationLabel] = useState("Home");
  const [formattedAddress, setFormattedAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<MobileActionResult | null>(null);

  const applicationTypes = props.queries.applicationTypes.data ?? [];
  const modules = props.queries.modules.data ?? [];
  const serviceRequests = props.queries.serviceRequests.data ?? [];
  const verificationDefinitions = props.queries.verificationDefinitions.data ?? [];
  const walletBalances = props.queries.walletBalances.data ?? [];
  const cylinders = props.queries.lpgCylinders.data ?? [];
  const locations = props.queries.lpgLocations.data ?? [];

  useEffect(() => setModuleKey((current) => current || resolveDefaultModuleKey(modules)), [
    modules,
  ]);
  useEffect(
    () =>
      setApplicationTypeKey((current) =>
        current || getRecordString(applicationTypes[0], "key") || ""
      ),
    [applicationTypes],
  );
  useEffect(
    () =>
      setWalletId((current) => current || getRecordString(walletBalances[0], "wallet_id") || ""),
    [walletBalances],
  );
  useEffect(
    () =>
      setServiceRequestId((current) => current || getRecordString(serviceRequests[0], "id") || ""),
    [serviceRequests],
  );
  useEffect(
    () => setCylinderId((current) => current || getRecordString(cylinders[0], "id") || ""),
    [cylinders],
  );
  useEffect(
    () =>
      setPickupLocationId((current) => current || getRecordString(locations[0], "id") || ""),
    [locations],
  );
  useEffect(
    () =>
      setDeliveryLocationId((current) => current || getRecordString(locations[0], "id") || ""),
    [locations],
  );
  useEffect(
    () =>
      setVerificationDefinitionKey((current) =>
        current || getRecordString(verificationDefinitions[0], "key") || ""
      ),
    [verificationDefinitions],
  );

  const mutation = useMutation<MobileActionResult, Error, MobileActionSubmission>({
    mutationFn: async (submission) => {
      const result = await session.api.post(
        submission.path,
        submission.payload,
        ActionResponseSchema,
      );

      if (submission.kind !== "otp") {
        return result;
      }

      const challengeId = readActionId(result);
      const delivery = await session.api.post(
        "/runtime/otp/delivery",
        {
          challengeId,
          idempotencyKey: createClientIdempotencyKey("mobile-otp-delivery", challengeId),
          metadata: { deliveredFrom: "mobile" },
        },
        ActionResponseSchema,
      );

      return { challengeId, delivery };
    },
    onSuccess: (result) => {
      setLastResult(result);
      props.onCompleted();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    setLastResult(null);

    try {
      mutation.mutate(
        buildMobileActionSubmission({
          actionKind: props.actionKind,
          amountNgn,
          applicationTypeKey,
          cylinderBrand,
          cylinderColour,
          cylinderId,
          cylinderIdentifier,
          cylinderSizeKg,
          currencyCode: props.currencyCode,
          deliveryLocationId,
          formattedAddress,
          latitude,
          locationLabel,
          longitude,
          maxCapacityKg,
          moduleKey,
          note,
          pickupLocationId,
          recipientAddress,
          requestedKg,
          serviceRequestId,
          userEmail: props.context.user.email,
          verificationDefinitionKey,
          walletId,
        }),
      );
    } catch (error) {
      setLocalError(readErrorMessage(error));
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={props.onClose}>
      <section
        className="action-sheet"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <header>
          <div>
            <span>Secure LPG action</span>
            <h2>{actionTitle(props.actionKind)}</h2>
          </div>
          <button type="button" onClick={props.onClose}>Close</button>
        </header>
        <form className="sheet-form" onSubmit={submit}>
          {props.actionKind === "request"
            ? (
              <>
                <IdSelectField
                  label="Cylinder"
                  value={cylinderId}
                  onChange={setCylinderId}
                  records={cylinders}
                  primaryField="cylinder_identifier"
                  secondaryField="condition_status"
                  fallback="Choose cylinder"
                />
                <IdSelectField
                  label="Pickup address"
                  value={pickupLocationId}
                  onChange={setPickupLocationId}
                  records={locations}
                  primaryField="label"
                  secondaryField="verification_status"
                  fallback="Choose pickup address"
                />
                <IdSelectField
                  label="Delivery address"
                  value={deliveryLocationId}
                  onChange={setDeliveryLocationId}
                  records={locations}
                  primaryField="label"
                  secondaryField="verification_status"
                  fallback="Choose delivery address"
                />
                <label>
                  Requested kilograms
                  <input
                    inputMode="decimal"
                    min="1"
                    step="0.5"
                    type="number"
                    value={requestedKg}
                    onChange={(event) => setRequestedKg(event.currentTarget.value)}
                  />
                </label>
              </>
            )
            : null}
          {props.actionKind === "lpgCylinder"
            ? (
              <>
                <label>
                  Cylinder identifier
                  <input
                    value={cylinderIdentifier}
                    placeholder="Example: SK-LPG-12KG-001"
                    onChange={(event) => setCylinderIdentifier(event.currentTarget.value)}
                  />
                </label>
                <label>
                  Size (kg)
                  <input
                    inputMode="decimal"
                    min="1"
                    step="0.5"
                    type="number"
                    value={cylinderSizeKg}
                    onChange={(event) => setCylinderSizeKg(event.currentTarget.value)}
                  />
                </label>
                <label>
                  Maximum capacity (kg)
                  <input
                    inputMode="decimal"
                    min="1"
                    step="0.5"
                    type="number"
                    value={maxCapacityKg}
                    onChange={(event) => setMaxCapacityKg(event.currentTarget.value)}
                  />
                </label>
                <label>
                  Brand
                  <input
                    value={cylinderBrand}
                    placeholder="Optional"
                    onChange={(event) => setCylinderBrand(event.currentTarget.value)}
                  />
                </label>
                <label>
                  Colour
                  <input
                    value={cylinderColour}
                    placeholder="Optional"
                    onChange={(event) => setCylinderColour(event.currentTarget.value)}
                  />
                </label>
              </>
            )
            : null}
          {props.actionKind === "location"
            ? (
              <>
                <label>
                  Label
                  <input
                    value={locationLabel}
                    placeholder="Home, Office, Shop"
                    onChange={(event) => setLocationLabel(event.currentTarget.value)}
                  />
                </label>
                <label>
                  Address
                  <textarea
                    rows={3}
                    value={formattedAddress}
                    placeholder="Enter the full pickup or delivery address"
                    onChange={(event) => setFormattedAddress(event.currentTarget.value)}
                  />
                </label>
                <label>
                  Latitude
                  <input
                    inputMode="decimal"
                    value={latitude}
                    placeholder="Example: 6.5244"
                    onChange={(event) => setLatitude(event.currentTarget.value)}
                  />
                </label>
                <label>
                  Longitude
                  <input
                    inputMode="decimal"
                    value={longitude}
                    placeholder="Example: 3.3792"
                    onChange={(event) => setLongitude(event.currentTarget.value)}
                  />
                </label>
              </>
            )
            : null}
          {props.actionKind === "application"
            ? (
              <SelectField
                label="Application type"
                value={applicationTypeKey}
                onChange={setApplicationTypeKey}
                records={applicationTypes}
                fallback="Choose application"
              />
            )
            : null}
          {props.actionKind === "deposit"
            ? (
              <>
                <label>
                  Wallet
                  <select
                    value={walletId}
                    onChange={(event) => setWalletId(event.currentTarget.value)}
                  >
                    <option value="">Default wallet</option>
                    {walletBalances.map((wallet, index) => (
                      <option
                        key={getRecordString(wallet, "wallet_id") ?? String(index)}
                        value={getRecordString(wallet, "wallet_id") ?? ""}
                      >
                        {formatShortId(getRecordString(wallet, "wallet_id"))}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Amount ({props.currencyCode})
                  <input
                    inputMode="decimal"
                    min="100"
                    type="number"
                    value={amountNgn}
                    onChange={(event) => setAmountNgn(event.currentTarget.value)}
                  />
                </label>
              </>
            )
            : null}
          {props.actionKind === "otp"
            ? (
              <label>
                Delivery address
                <input
                  autoComplete="email"
                  type="email"
                  value={recipientAddress}
                  onChange={(event) => setRecipientAddress(event.currentTarget.value)}
                />
              </label>
            )
            : null}
          {props.actionKind === "tracking" || props.actionKind === "verification"
            ? (
              <label>
                Request
                <select
                  value={serviceRequestId}
                  onChange={(event) => setServiceRequestId(event.currentTarget.value)}
                >
                  <option value="">Choose request</option>
                  {serviceRequests.map((request, index) => (
                    <option
                      key={getRecordString(request, "id") ?? String(index)}
                      value={getRecordString(request, "id") ?? ""}
                    >
                      {formatShortId(getRecordString(request, "id"))}
                    </option>
                  ))}
                </select>
              </label>
            )
            : null}
          {props.actionKind === "verification"
            ? (
              <SelectField
                label="Verification type"
                value={verificationDefinitionKey}
                onChange={setVerificationDefinitionKey}
                records={verificationDefinitions}
                fallback="Choose check"
              />
            )
            : null}
          <label>
            Note
            <textarea
              rows={3}
              value={note}
              placeholder="Add details for history"
              onChange={(event) => setNote(event.currentTarget.value)}
            />
          </label>

          {localError || mutation.error
            ? <p className="mobile-form-error">{localError ?? readErrorMessage(mutation.error)}</p>
            : null}
          {lastResult ? <ActionResultPanel result={lastResult} /> : null}

          <button type="submit" className="mobile-primary-action" disabled={mutation.isPending}>
            {mutation.isPending ? "Sending" : actionButtonLabel(props.actionKind)}
          </button>
        </form>
      </section>
    </div>
  );
}

function SelectField(props: {
  readonly label: string;
  readonly value: string;
  readonly records: readonly PlatformRecord[];
  readonly fallback: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label>
      {props.label}
      <select value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)}>
        <option value="">{props.fallback}</option>
        {props.records.map((record, index) => (
          <option
            key={getRecordString(record, "id") ?? getRecordString(record, "key") ?? String(index)}
            value={getRecordString(record, "key") ?? ""}
          >
            {getRecordString(record, "display_name") ??
              normalizeLabel(getRecordString(record, "key") ?? props.fallback)}
          </option>
        ))}
      </select>
    </label>
  );
}

function IdSelectField(props: {
  readonly label: string;
  readonly value: string;
  readonly records: readonly PlatformRecord[];
  readonly primaryField: string;
  readonly secondaryField: string;
  readonly fallback: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label>
      {props.label}
      <select value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)}>
        <option value="">{props.fallback}</option>
        {props.records.map((record, index) => {
          const id = getRecordString(record, "id") ?? "";
          const label = getRecordString(record, props.primaryField) ??
            getRecordString(record, "display_name") ??
            props.fallback;
          const secondary = getRecordString(record, props.secondaryField);

          return (
            <option key={id || String(index)} value={id}>
              {secondary ? `${label} - ${normalizeLabel(secondary)}` : label}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function BottomNavigation(props: {
  readonly activeTab: MobileTab;
  readonly items: readonly PhaseOneNavigationItem[];
  readonly onTabChange: (tab: MobileTab) => void;
}) {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {props.items.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={props.activeTab === tab.key ? "is-active" : ""}
          onClick={() => props.onTabChange(tab.key)}
        >
          {tabIcons[tab.key]}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

function QuickAction(
  props: { readonly icon: ReactNode; readonly label: string; readonly onClick: () => void },
) {
  return (
    <button type="button" onClick={props.onClick}>
      <span>{props.icon}</span>
      <strong>{props.label}</strong>
    </button>
  );
}

function WorkflowPreview(props: {
  readonly steps: readonly string[];
  readonly activeRecord: PlatformRecord | null;
  readonly completedCount: number;
}) {
  return (
    <section className="workflow-preview">
      {props.steps.map((step, index) => (
        <article
          key={step}
          className={index < props.completedCount
            ? "is-complete"
            : props.activeRecord
            ? ""
            : "is-next"}
        >
          <span>{index + 1}</span>
          <strong>{step}</strong>
        </article>
      ))}
    </section>
  );
}

function ProductOptionCard(props: {
  readonly option: PhaseOneProductOption;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`product-option is-${props.option.tone}`}
      onClick={props.onClick}
    >
      <span>{props.option.label}</span>
      <strong>{props.option.description}</strong>
      <ChevronRight aria-hidden="true" />
    </button>
  );
}

function OperationsWorkspace(props: {
  readonly cards: readonly (readonly [string, string, string])[];
  readonly primaryAction: string;
  readonly onPrimaryAction: () => void;
}) {
  return (
    <>
      <section className="operations-grid">
        {props.cards.map(([label, value, description]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <p>{description}</p>
          </article>
        ))}
      </section>
      <button type="button" className="mobile-primary-action" onClick={props.onPrimaryAction}>
        {props.primaryAction}
      </button>
    </>
  );
}

function LiveRecordList(props: {
  readonly records: readonly PlatformRecord[];
  readonly primaryField: string;
  readonly secondaryField: string;
  readonly emptyTitle: string;
  readonly emptyMessage: string;
  readonly onAction: () => void;
}) {
  if (props.records.length === 0) {
    return <EmptyState title={props.emptyTitle} message={props.emptyMessage} />;
  }

  return (
    <div className="service-list">
      {props.records.slice(0, 6).map((record, index) => (
        <button
          key={getRecordString(record, "id") ?? getRecordString(record, "key") ?? String(index)}
          type="button"
          onClick={props.onAction}
        >
          <ModuleLogo module={phaseOneLpgExperience.identity} />
          <div>
            <strong>
              {getRecordString(record, props.primaryField) ??
                normalizeLabel(getRecordString(record, "key") ?? "LPG item")}
            </strong>
            <span>
              {normalizeLabel(getRecordString(record, props.secondaryField) ?? "Available")}
            </span>
          </div>
          <ChevronRight aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function ServiceStrip(props: { readonly modules: readonly PlatformRecord[] }) {
  const identities = props.modules.slice(0, 4).map((record) => resolveModuleIdentity(record));

  if (identities.length === 0) {
    return (
      <EmptyState
        title="LPG options coming online"
        message="Available refill options will appear here."
      />
    );
  }

  return (
    <div className="service-grid">
      {identities.map((identity) => (
        <article key={identity.moduleKey}>
          <ModuleLogo module={identity} />
          <strong>{identity.shortLabel}</strong>
        </article>
      ))}
    </div>
  );
}

function ModuleLogo(props: { readonly module: BusinessModuleVisualIdentity }) {
  if (props.module.logoUrl) {
    return (
      <img className="module-logo" src={props.module.logoUrl} alt={`${props.module.label} logo`} />
    );
  }

  return (
    <span className={`module-logo is-${props.module.tone}`}>{props.module.fallbackInitials}</span>
  );
}

function SectionHeader(
  props: { readonly title: string; readonly action?: string; readonly onAction?: () => void },
) {
  return (
    <header className="section-heading">
      <h2>{props.title}</h2>
      {props.action ? <button type="button" onClick={props.onAction}>{props.action}</button> : null}
    </header>
  );
}

function ScreenTitle(props: { readonly title: string; readonly subtitle: string }) {
  return (
    <header className="screen-title">
      <h1>{props.title}</h1>
      <p>{props.subtitle}</p>
    </header>
  );
}

function Metric(props: { readonly label: string; readonly value: string }) {
  return (
    <article>
      <strong>{props.value}</strong>
      <span>{props.label}</span>
    </article>
  );
}

function StatusPill(props: { readonly tone: MobileTone; readonly children: ReactNode }) {
  return <span className={`status-pill is-${props.tone}`}>{props.children}</span>;
}

function TransactionRow(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly amount: string;
  readonly tone: "success" | "danger";
}) {
  return (
    <article className="transaction-row">
      <span className={`transaction-icon is-${props.tone}`}>
        <CircleDollarSign aria-hidden="true" />
      </span>
      <div>
        <strong>{props.title}</strong>
        <small>{props.subtitle}</small>
      </div>
      <b>{props.amount}</b>
    </article>
  );
}

function NotificationRow(
  props: { readonly title: string; readonly subtitle: string; readonly time: string },
) {
  return (
    <article className="notification-row">
      <span>
        <Bell aria-hidden="true" />
      </span>
      <div>
        <strong>{props.title}</strong>
        <small>{props.subtitle}</small>
      </div>
      <time>{props.time}</time>
    </article>
  );
}

function MenuRow(props: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly onClick: () => void;
  readonly danger?: boolean;
}) {
  return (
    <button type="button" className={props.danger ? "is-danger" : ""} onClick={props.onClick}>
      <span>{props.icon}</span>
      <strong>{props.label}</strong>
      <small>{props.value}</small>
      <ChevronRight aria-hidden="true" />
    </button>
  );
}

function PreferenceGroup(props: {
  readonly label: string;
  readonly options: readonly (readonly [string, string])[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  if (props.options.length === 0) {
    return (
      <div className="preference-group">
        <strong>{props.label}</strong>
        <span>No options available</span>
      </div>
    );
  }

  return (
    <div className="preference-group">
      <strong>{props.label}</strong>
      <div>
        {props.options.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={props.value === value ? "is-active" : ""}
            onClick={() => props.onChange(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Timeline(props: { readonly steps: readonly [string, boolean][] }) {
  return (
    <section className="timeline">
      {props.steps.map(([label, done], index) => (
        <article key={label} className={done ? "is-done" : ""}>
          <span>{index + 1}</span>
          <strong>{label}</strong>
        </article>
      ))}
    </section>
  );
}

function EmptyState(props: { readonly title: string; readonly message: string }) {
  return (
    <section className="empty-state">
      <ShieldCheck aria-hidden="true" />
      <strong>{props.title}</strong>
      <span>{props.message}</span>
    </section>
  );
}

function ScreenState(props: {
  readonly title: string;
  readonly message: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
}) {
  const [theme] = useStoredPreference<InterfaceTheme>(themeStorageKey, "system", isInterfaceTheme);
  const resolvedTheme = useResolvedTheme(theme);

  return (
    <main className="mobile-app" data-theme={resolvedTheme}>
      <section className="mobile-device state-device" data-theme={resolvedTheme}>
        <div className="skima-mark">S</div>
        <h1>{props.title}</h1>
        <p>{props.message}</p>
        {props.actionLabel
          ? (
            <button type="button" className="mobile-primary-action" onClick={props.onAction}>
              {props.actionLabel}
            </button>
          )
          : null}
      </section>
    </main>
  );
}

function ActionResultPanel(props: { readonly result: MobileActionResult }) {
  if (typeof props.result === "string") {
    return (
      <div className="action-result">
        <strong>Action received</strong>
        <span>Reference {formatShortId(props.result)}</span>
      </div>
    );
  }

  const delivery = readNestedRecord(props.result, "delivery");
  const code = getRecordString(delivery, "code") ?? getRecordString(props.result, "code");
  const checkoutUrl = getRecordString(props.result, "checkoutUrl");
  const reference = getRecordString(props.result, "depositRequestId") ??
    getRecordString(props.result, "providerReference") ??
    getRecordString(props.result, "challengeId");

  return (
    <div className="action-result">
      <strong>{code ? "Secure code ready" : "Action received"}</strong>
      {code ? <b>{code}</b> : null}
      {reference ? <span>Reference {formatShortId(reference)}</span> : null}
      {checkoutUrl
        ? <a href={checkoutUrl} target="_blank" rel="noreferrer">Continue payment</a>
        : null}
    </div>
  );
}

function useGatewayRecords(queryKey: string, path: string, enabled: boolean): MobileQueryResult {
  const session = useMobileSession();

  return useQuery({
    queryKey: ["mobile-gateway", queryKey, path],
    queryFn: async () =>
      session.api.get(path, queryKey === "modules" ? ModuleArraySchema : RecordArraySchema),
    enabled: session.status === "authenticated" && enabled,
  });
}

function useStoredPreference<TValue extends string>(
  storageKey: string,
  fallback: TValue,
  isValid: (value: string) => value is TValue,
): readonly [TValue, (value: TValue) => void] {
  const [value, setValue] = useState<TValue>(() => {
    if (typeof window === "undefined") {
      return fallback;
    }

    const storedValue = window.localStorage.getItem(storageKey);

    return storedValue && isValid(storedValue) ? storedValue : fallback;
  });

  const updateValue = (nextValue: TValue) => {
    setValue(nextValue);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, nextValue);
    }
  };

  return [value, updateValue];
}

function useResolvedTheme(theme: InterfaceTheme): "light" | "dark" {
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() => readSystemTheme());

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => setSystemTheme(query.matches ? "dark" : "light");
    updateTheme();
    query.addEventListener("change", updateTheme);

    return () => query.removeEventListener("change", updateTheme);
  }, []);

  return theme === "system" ? systemTheme : theme;
}

function readSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveEnabledCurrencies(
  records: readonly PlatformRecord[],
): readonly { readonly code: string; readonly displayName: string }[] {
  const enabled = records
    .filter((record) =>
      (getRecordString(record, "status") ?? mobileCurrencyPreferencePolicy.enabledStatus) ===
        mobileCurrencyPreferencePolicy.enabledStatus
    )
    .map((record) => ({
      code: getRecordString(record, "code") ?? "",
      displayName: getRecordString(record, "display_name") ?? getRecordString(record, "code") ??
        "",
    }))
    .filter((currency) => currency.code.length > 0);

  return enabled.length > 0 ? enabled : [{
    code: mobileCurrencyPreferencePolicy.clientFallbackCode,
    displayName: mobileCurrencyPreferencePolicy.clientFallbackCode,
  }];
}

function isInterfaceTheme(value: string): value is InterfaceTheme {
  return value === "system" || value === "light" || value === "dark";
}

function isNonEmptyString(value: string): value is string {
  return value.trim().length > 0;
}

function themeLabel(theme: InterfaceTheme): string {
  if (theme === "system") return "System";
  if (theme === "light") return "Light";
  return "Dark";
}

function nextTheme(theme: InterfaceTheme): InterfaceTheme {
  if (theme === "system") return "light";
  if (theme === "light") return "dark";
  return "system";
}

function buildMobileActionSubmission(input: MobileActionSubmissionInput): MobileActionSubmission {
  const note = input.note.trim();
  const metadata = {
    note: note || null,
    submittedFrom: "mobile",
  };

  if (input.actionKind === "request") {
    const cylinderId = requireActionValue(input.cylinderId, "Choose a registered cylinder.");
    const pickupLocationId = requireActionValue(
      input.pickupLocationId,
      "Choose a pickup address.",
    );
    const deliveryLocationId = requireActionValue(
      input.deliveryLocationId,
      "Choose a delivery address.",
    );

    return {
      kind: input.actionKind,
      path: "/lpg/quotes",
      payload: {
        cylinderId,
        deliveryLocationId,
        idempotencyKey: createClientIdempotencyKey("mobile-lpg-quote", cylinderId),
        metadata,
        pickupLocationId,
        requestedKg: parseQuantity(input.requestedKg, "Requested kilograms"),
        source: "skima.mobile.lpg",
      },
    };
  }

  if (input.actionKind === "lpgCylinder") {
    const cylinderIdentifier = requireActionValue(
      input.cylinderIdentifier,
      "Enter a cylinder identifier.",
    );

    return {
      kind: input.actionKind,
      path: "/lpg/cylinders",
      payload: {
        brand: input.cylinderBrand.trim() || null,
        colour: input.cylinderColour.trim() || null,
        conditionStatus: "unknown",
        cylinderIdentifier,
        idempotencyKey: createClientIdempotencyKey("mobile-lpg-cylinder", cylinderIdentifier),
        maxCapacityKg: parseQuantity(input.maxCapacityKg, "Maximum capacity"),
        metadata,
        sizeKg: parseQuantity(input.cylinderSizeKg, "Cylinder size"),
        source: "skima.mobile.lpg",
      },
    };
  }

  if (input.actionKind === "location") {
    const locationLabel = requireActionValue(input.locationLabel, "Enter an address label.");
    const formattedAddress = requireActionValue(input.formattedAddress, "Enter the full address.");

    return {
      kind: input.actionKind,
      path: "/lpg/locations",
      payload: {
        formattedAddress,
        idempotencyKey: createClientIdempotencyKey("mobile-lpg-location", formattedAddress),
        label: locationLabel,
        latitude: parseLatitude(input.latitude),
        longitude: parseLongitude(input.longitude),
        metadata,
        source: "skima.mobile.lpg",
      },
    };
  }

  if (input.actionKind === "application") {
    const applicationTypeKey = requireActionValue(
      input.applicationTypeKey,
      "Choose an application type.",
    );

    return {
      kind: input.actionKind,
      path: "/runtime/applications",
      payload: {
        applicationTypeKey,
        idempotencyKey: createClientIdempotencyKey("mobile-application", applicationTypeKey),
        metadata,
        payload: {
          contact: { email: input.userEmail },
          note: note || "Mobile application started",
          submittedAt: new Date().toISOString(),
        },
        source: "skima.mobile",
      },
    };
  }

  if (input.actionKind === "deposit") {
    return {
      kind: input.actionKind,
      path: "/runtime/payments/deposits",
      payload: {
        amount: parseMoneyMinor(input.amountNgn),
        currencyCode: input.currencyCode,
        idempotencyKey: createClientIdempotencyKey("mobile-wallet-deposit", input.walletId),
        metadata,
        source: "skima.mobile",
        ...(input.walletId ? { walletId: input.walletId } : {}),
      },
    };
  }

  if (input.actionKind === "otp") {
    const recipientAddress = requireActionValue(
      input.recipientAddress,
      "Enter where the secure code should be delivered.",
    );

    return {
      kind: input.actionKind,
      path: "/runtime/otp/challenges",
      payload: {
        channel: "in_app",
        idempotencyKey: createClientIdempotencyKey("mobile-otp", recipientAddress),
        maxAttempts: 5,
        metadata,
        purpose: "account.access",
        recipientAddress,
        source: "skima.mobile",
        ttlSeconds: 600,
      },
    };
  }

  if (input.actionKind === "tracking") {
    const serviceRequestId = requireActionValue(input.serviceRequestId, "Choose a request.");

    return {
      kind: input.actionKind,
      path: "/runtime/tracking/sessions",
      payload: {
        idempotencyKey: createClientIdempotencyKey("mobile-tracking", serviceRequestId),
        metadata,
        source: "skima.mobile",
        subjectId: serviceRequestId,
        subjectType: "service_request",
      },
    };
  }

  const serviceRequestId = requireActionValue(input.serviceRequestId, "Choose a request.");
  const definitionKey = requireActionValue(
    input.verificationDefinitionKey,
    "Choose a verification type.",
  );

  return {
    kind: input.actionKind,
    path: "/runtime/verifications",
    payload: {
      definitionKey,
      idempotencyKey: createClientIdempotencyKey("mobile-verification", serviceRequestId),
      location: {},
      metadata,
      payload: { note: note || null },
      purpose: "mobile.secure_check",
      result: "passed",
      scannedEntityId: serviceRequestId,
      scannedEntityType: "service_request",
      serviceRequestId,
      source: "skima.mobile",
    },
  };
}

function resolveAvailableRoles(context: SessionContext): readonly RoleOption[] {
  const permissionContext = toPermissionContext(context);
  const isAdmin = Boolean(context.platformAdmin);
  const hasOrganization = context.organizations.some((organization) =>
    organization.status === "active"
  );
  const hasDriverAccess = hasPermission(permissionContext, "platform.driver.read") || isAdmin;
  const hasPartnerAccess = hasOrganization ||
    hasPermission(permissionContext, "platform.organizations.read") ||
    isAdmin;

  return roleOptions.filter((role) => {
    if (role.key === "customer") return true;
    if (role.key === "driver") return hasDriverAccess;
    if (role.key === "partner") return hasPartnerAccess;
    return isAdmin;
  });
}

function resolveModuleIdentity(record: PlatformRecord): BusinessModuleVisualIdentity {
  const moduleKey = getRecordString(record, "key") ?? "service";
  const metadata = readNestedRecord(record, "metadata");
  const visual = readNestedRecord(metadata, "visual");
  const displayName = getRecordString(record, "display_name") ?? normalizeLabel(moduleKey);
  const category = getRecordString(visual, "category") ??
    getRecordString(metadata, "category") ??
    "Service line";
  const tone = normalizeTone(getRecordString(visual, "tone"));

  return {
    moduleKey,
    label: displayName,
    shortLabel: displayName.length > 10 ? displayName.slice(0, 10) : displayName,
    category,
    tone,
    fallbackInitials: initials(displayName),
    fallbackIcon: normalizeFallbackIcon(getRecordString(visual, "icon")),
  };
}

function resolveDefaultModuleKey(records: readonly PlatformRecord[]): string {
  const moduleKeys = records
    .map((record) => getRecordString(record, "key"))
    .filter((key): key is string => Boolean(key));

  return moduleKeys.find((key) =>
    (phaseOneLpgExperience.moduleKeys as readonly string[]).includes(key.toLowerCase())
  ) ??
    moduleKeys[0] ??
    phaseOneLpgExperience.identity.moduleKey;
}

function resolveServiceCategories(
  identities: readonly BusinessModuleVisualIdentity[],
): readonly string[] {
  const categories = identities
    .map((identity) => identity.category)
    .filter((category) => category.trim().length > 0);

  return ["All", ...Array.from(new Set(categories)).slice(0, 4)];
}

function normalizeTone(value: string | null): MobileTone {
  if (
    value === "success" ||
    value === "warning" ||
    value === "danger" ||
    value === "info" ||
    value === "accent" ||
    value === "neutral"
  ) {
    return value;
  }

  return "neutral";
}

function normalizeFallbackIcon(
  value: string | null,
): BusinessModuleVisualIdentity["fallbackIcon"] {
  if (
    value === "building" ||
    value === "meal" ||
    value === "medical" ||
    value === "basket" ||
    value === "parcel" ||
    value === "vehicle" ||
    value === "laundry" ||
    value === "water" ||
    value === "materials"
  ) {
    return value;
  }

  return "building";
}

function toPermissionContext(context: SessionContext): PermissionContext {
  return {
    permissions: context.permissions,
  };
}

function walletTotal(records: readonly PlatformRecord[], currencyCode: string): number {
  return records.reduce((total, record) => {
    if ((getRecordString(record, "currency_code") ?? currencyCode) !== currencyCode) {
      return total;
    }

    return total + (getRecordNumber(record, "balance") ?? 0);
  }, 0);
}

function profileName(context: SessionContext): string {
  return context.profile?.display_name ?? context.user.email?.split("@")[0] ?? "there";
}

function roleTitle(role: MobileRole): string {
  return roleOptions.find((option) => option.key === role)?.description ??
    "What would you like to do today?";
}

function quickActionIcon(
  action: MobileActionKind | undefined,
  tab: MobileTab | undefined,
): ReactNode {
  if (action === "request") return <Send aria-hidden="true" />;
  if (action === "lpgCylinder") return <QrCode aria-hidden="true" />;
  if (action === "location") return <MapPin aria-hidden="true" />;
  if (action === "deposit") return <WalletCards aria-hidden="true" />;
  if (action === "tracking") return <MapPin aria-hidden="true" />;
  if (action === "verification") return <QrCode aria-hidden="true" />;
  if (action === "application") return <FileCheck2 aria-hidden="true" />;
  if (tab === "wallet") return <WalletCards aria-hidden="true" />;
  if (tab === "orders") return <MapPin aria-hidden="true" />;
  if (tab === "services") return <Grid3X3 aria-hidden="true" />;

  return <ClipboardList aria-hidden="true" />;
}

function servicesTitle(role: MobileRole): string {
  if (role === "customer") return "Cylinders";
  if (role === "driver") return "Active delivery";
  if (role === "partner") return "Refill station";
  return "LPG operations";
}

function servicesSubtitle(role: MobileRole): string {
  if (role === "customer") return "Register cylinders, save addresses, and request refill quotes.";
  if (role === "driver") return "Follow the pickup, station, and delivery checkpoints.";
  if (role === "partner") {
    return "Manage incoming cylinders, refill confirmation, and availability.";
  }
  return "Monitor orders, stations, drivers, verification, and exceptions.";
}

function ordersTitle(role: MobileRole): string {
  if (role === "customer") return "Orders";
  if (role === "driver") return "Pickup and delivery checks";
  if (role === "partner") return "Cylinder verification";
  return "Driver and station control";
}

function ordersEmptySubtitle(role: MobileRole): string {
  if (role === "customer") return "No active LPG delivery";
  if (role === "driver") return "No active assignment";
  if (role === "partner") return "No cylinder awaiting station scan";
  return "No active exception";
}

function actionTitle(actionKind: MobileActionKind): string {
  if (actionKind === "request") return "Refill quote";
  if (actionKind === "lpgCylinder") return "Register cylinder";
  if (actionKind === "location") return "Save address";
  if (actionKind === "application") return "Start application";
  if (actionKind === "deposit") return "Fund wallet";
  if (actionKind === "otp") return "Get secure code";
  if (actionKind === "tracking") return "Start tracking";
  return "Record verification";
}

function actionButtonLabel(actionKind: MobileActionKind): string {
  if (actionKind === "request") return "Create quote";
  if (actionKind === "lpgCylinder") return "Save cylinder";
  if (actionKind === "location") return "Save address";
  if (actionKind === "application") return "Start application";
  if (actionKind === "deposit") return "Start payment";
  if (actionKind === "otp") return "Get code";
  if (actionKind === "tracking") return "Start tracking";
  return "Record check";
}

function parseMoneyMinor(value: string): number {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Enter a valid amount.");
  }

  return Math.round(amount * 100);
}

function parseQuantity(value: string, label: string): number {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }

  return amount;
}

function parseLatitude(value: string): number {
  const latitude = Number(value);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("Latitude must be between -90 and 90.");
  }

  return latitude;
}

function parseLongitude(value: string): number {
  const longitude = Number(value);

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("Longitude must be between -180 and 180.");
  }

  return longitude;
}

function requireActionValue(value: string, message: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}

function getRecordString(record: PlatformRecord | null | undefined, key: string): string | null {
  const value = record?.[key];

  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getRecordNumber(record: PlatformRecord | null | undefined, key: string): number | null {
  const value = record?.[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNestedRecord(
  record: PlatformRecord | null | undefined,
  key: string,
): PlatformRecord | null {
  const value = record?.[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? value as PlatformRecord
    : null;
}

function readActionId(result: MobileActionResult): string {
  if (typeof result === "string") {
    if (result.trim().length > 0) {
      return result;
    }

    throw new Error("The action completed without a readable reference.");
  }

  const id = getRecordString(result, "id") ??
    getRecordString(result, "challengeId") ??
    getRecordString(result, "depositRequestId");

  if (!id) {
    throw new Error("The action completed without a readable reference.");
  }

  return id;
}

function normalizeLabel(value: string): string {
  return value
    .split(/[_:-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatShortId(value: string | null): string {
  if (!value) {
    return "Reference";
  }

  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function initials(value: string): string {
  const normalized = value
    .split(/[\s_.:-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return normalized.length >= 2 ? normalized : "SK";
}

function readErrorMessage(error: unknown): string {
  if (error instanceof ApiGatewayError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "The request could not be completed.";
}
