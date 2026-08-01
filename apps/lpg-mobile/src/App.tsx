import {
  AlertTriangle,
  Bell,
  BriefcaseBusiness,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Eye,
  FileCheck2,
  Gift,
  Grid3X3,
  Headphones,
  Home,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  Plus,
  QrCode,
  Search,
  Settings,
  ShieldCheck,
  Star,
  Truck,
  Upload,
  User,
  WalletCards,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { z } from "zod";

import {
  ApiGatewayError,
  createClientIdempotencyKey,
  formatMoney,
  normalizeStatusLabel,
  type SessionContext,
} from "@skima/frontend-core";

import {
  type CurrencyRecord,
  customerOnboardingSteps,
  driverOnboardingSteps,
  getInitialTab,
  type InterfaceTheme,
  isWorkspaceTab,
  type LpgAction,
  type LpgTab,
  type LpgWorkspace,
  resolveAvailableWorkspaces,
  resolveEffectiveCurrencies,
  resolveProfileName,
  stationOnboardingSteps,
  workspaceConfigs,
} from "./lpg-experience";
import { useLpgSession } from "./session";

type PlatformRecord = Readonly<Record<string, unknown>>;
type ActionResult = string | PlatformRecord;

interface LpgQueries {
  readonly activeOrders: readonly PlatformRecord[];
  readonly applications: readonly PlatformRecord[];
  readonly currencies: readonly PlatformRecord[];
  readonly cylinders: readonly PlatformRecord[];
  readonly locations: readonly PlatformRecord[];
  readonly messages: readonly PlatformRecord[];
  readonly orders: readonly PlatformRecord[];
  readonly wallets: readonly PlatformRecord[];
}

interface ActionFormState {
  readonly address: string;
  readonly amount: string;
  readonly brand: string;
  readonly color: string;
  readonly cylinderId: string;
  readonly cylinderIdentifier: string;
  readonly label: string;
  readonly latitude: string;
  readonly longitude: string;
  readonly maxCapacityKg: string;
  readonly requestedKg: string;
  readonly sizeKg: string;
}

const RecordArraySchema = z.array(z.record(z.unknown()));
const ActionResponseSchema = z.union([z.string(), z.record(z.unknown())]);
const themeStorageKey = "skima.lpg.theme";
const hiddenCurrencyStorageKey = "skima.lpg.hidden-currencies";

export function LpgMobileApp() {
  const session = useLpgSession();

  if (session.status === "loading") {
    return <StateScreen title="Preparing Skima LPG" message="Loading your secure account." />;
  }

  if (session.status === "unauthenticated") {
    return <PublicExperience />;
  }

  if (session.status === "error" || !session.context) {
    return (
      <StateScreen
        title="Session unavailable"
        message={session.error ?? "Your account could not be loaded."}
        actionLabel="Retry"
        onAction={session.refreshContext}
      />
    );
  }

  return <AuthenticatedExperience context={session.context} />;
}

function PublicExperience() {
  const session = useLpgSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"welcome" | "onboarding" | "login">("welcome");
  const [stepIndex, setStepIndex] = useState(0);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await session.signIn(email, password);
  }

  if (mode === "welcome") {
    return (
      <main className="lpg-app-shell">
        <section className="phone-frame splash-screen">
          <PhoneStatus />
          <div className="splash-content">
            <BrandLockup size="large" />
            <div>
              <h1>One platform. Your LPG handled safely.</h1>
              <p>Register cylinders, request refills, track movement, and verify delivery.</p>
            </div>
            <div className="night-road" aria-hidden="true">
              <span />
              <i />
              <b />
            </div>
            <button type="button" className="primary-button" onClick={() => setMode("onboarding")}>
              Get Started
            </button>
            <button type="button" className="outline-on-dark" onClick={() => setMode("login")}>
              Login
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (mode === "onboarding") {
    const onboarding = [
      {
        art: <CylinderArt size="large" tone="red" />,
        title: "Everything you need, delivered smarter.",
        text: "Order LPG refill, track pickup, and pay through a secure wallet.",
      },
      {
        art: <StationArt />,
        title: "Stations receive and refill with confidence.",
        text: "Every refill is tied to cylinder scans, order status, and settlement.",
      },
      {
        art: <DriverArt />,
        title: "Drivers earn through verified delivery.",
        text: "Pickup, station refill, return route, delivery OTP, and commission all connect.",
      },
    ];
    const current = onboarding[stepIndex] ?? onboarding[0];

    return (
      <main className="lpg-app-shell">
        <section className="phone-frame onboarding-screen">
          <PhoneStatus />
          <button type="button" className="skip-button" onClick={() => setMode("login")}>
            Skip
          </button>
          <div className="onboarding-art">{current.art}</div>
          <h1>{current.title}</h1>
          <p>{current.text}</p>
          <div className="onboarding-footer">
            <StepDots total={onboarding.length} active={stepIndex} />
            <button
              type="button"
              className="round-next"
              onClick={() =>
                stepIndex >= onboarding.length - 1 ? setMode("login") : setStepIndex(stepIndex + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="lpg-app-shell">
      <section className="phone-frame login-screen">
        <PhoneStatus />
        <button type="button" className="back-button" onClick={() => setMode("welcome")}>
          Back
        </button>
        <BrandLockup />
        <h1>Welcome back</h1>
        <p>Login to continue</p>
        <form className="auth-form" onSubmit={handleLogin}>
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
          {session.error ? <p className="form-error">{session.error}</p> : null}
          <button type="submit" className="primary-button" disabled={session.status === "loading"}>
            Login
          </button>
        </form>
      </section>
    </main>
  );
}

function AuthenticatedExperience(props: { readonly context: SessionContext }) {
  const session = useLpgSession();
  const queryClient = useQueryClient();
  const availableWorkspaces = useMemo(() => resolveAvailableWorkspaces(props.context), [
    props.context,
  ]);
  const [workspace, setWorkspace] = useState<LpgWorkspace>(availableWorkspaces[0] ?? "customer");
  const [tab, setTab] = useState<LpgTab>(getInitialTab(workspace));
  const [action, setAction] = useState<LpgAction | null>(null);
  const [theme, setTheme] = useStoredPreference<InterfaceTheme>(
    themeStorageKey,
    "system",
    isInterfaceTheme,
  );
  const [hiddenCurrencyCodes, setHiddenCurrencyCodes] = useStoredStringListPreference(
    hiddenCurrencyStorageKey,
  );
  const resolvedTheme = useResolvedTheme(theme);

  useEffect(() => {
    if (!availableWorkspaces.includes(workspace)) {
      const nextWorkspace = availableWorkspaces[0] ?? "customer";
      setWorkspace(nextWorkspace);
      setTab(getInitialTab(nextWorkspace));
    }
  }, [availableWorkspaces, workspace]);

  useEffect(() => {
    if (!isWorkspaceTab(workspace, tab)) {
      setTab(getInitialTab(workspace));
    }
  }, [tab, workspace]);

  const wallets = useGatewayRecords("wallets", "/runtime/wallet-balances", true);
  const currencies = useGatewayRecords("currencies", "/engines/currencies", true);
  const cylinders = useGatewayRecords("cylinders", "/lpg/cylinders", true);
  const locations = useGatewayRecords("locations", "/lpg/locations", true);
  const orders = useGatewayRecords("orders", "/lpg/orders", true);
  const activeOrders = useGatewayRecords("active-orders", "/lpg/orders/active", true);
  const messages = useGatewayRecords("messages", "/runtime/communications/messages", true);
  const applications = useGatewayRecords(
    "applications",
    "/runtime/applications",
    workspace === "admin",
  );
  const currencyState = resolveEffectiveCurrencies({
    currencyRecords: currencies.data as readonly CurrencyRecord[] | undefined ?? [],
    profileMetadata: props.context.profile?.metadata ?? {},
    userHiddenCodes: hiddenCurrencyCodes,
  });
  const activeCurrency = currencyState.effectiveCurrencies[0]?.code ?? "NGN";
  const queries: LpgQueries = {
    activeOrders: activeOrders.data ?? [],
    applications: applications.data ?? [],
    currencies: currencies.data ?? [],
    cylinders: cylinders.data ?? [],
    locations: locations.data ?? [],
    messages: messages.data ?? [],
    orders: orders.data ?? [],
    wallets: wallets.data ?? [],
  };

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["lpg-mobile"] });

  return (
    <main className="lpg-app-shell" data-theme={resolvedTheme}>
      <section className="phone-frame app-screen" data-theme={resolvedTheme}>
        <PhoneStatus />
        <AppHeader
          context={props.context}
          workspace={workspace}
          availableWorkspaces={availableWorkspaces}
          onWorkspaceChange={(nextWorkspace) => {
            setWorkspace(nextWorkspace);
            setTab(getInitialTab(nextWorkspace));
          }}
          onSignOut={session.signOut}
        />
        <section className="screen-scroll">
          <ScreenRouter
            context={props.context}
            queries={queries}
            tab={tab}
            workspace={workspace}
            currencyCode={activeCurrency}
            theme={theme}
            currencyState={currencyState}
            hiddenCurrencyCodes={hiddenCurrencyCodes}
            onAction={setAction}
            onHiddenCurrencyCodesChange={setHiddenCurrencyCodes}
            onTabChange={setTab}
            onThemeChange={setTheme}
          />
        </section>
        <BottomNav workspace={workspace} tab={tab} onChange={setTab} />
        {action
          ? (
            <ActionSheet
              action={action}
              context={props.context}
              currencyCode={activeCurrency}
              queries={queries}
              onClose={() => setAction(null)}
              onCompleted={refresh}
            />
          )
          : null}
      </section>
    </main>
  );
}

function ScreenRouter(props: {
  readonly context: SessionContext;
  readonly queries: LpgQueries;
  readonly workspace: LpgWorkspace;
  readonly tab: LpgTab;
  readonly currencyCode: string;
  readonly theme: InterfaceTheme;
  readonly currencyState: ReturnType<typeof resolveEffectiveCurrencies>;
  readonly hiddenCurrencyCodes: readonly string[];
  readonly onAction: (action: LpgAction) => void;
  readonly onHiddenCurrencyCodesChange: (codes: readonly string[]) => void;
  readonly onTabChange: (tab: LpgTab) => void;
  readonly onThemeChange: (theme: InterfaceTheme) => void;
}) {
  if (props.workspace === "customer") {
    if (props.tab === "cylinders") return <CustomerCylinders {...props} />;
    if (props.tab === "orders") return <CustomerOrders {...props} />;
    if (props.tab === "wallet") return <WalletScreen {...props} title="Wallet" />;
    if (props.tab === "account") return <AccountScreen {...props} />;
    return <CustomerHome {...props} />;
  }

  if (props.workspace === "driver") {
    if (props.tab === "jobs") return <DriverJobs {...props} />;
    if (props.tab === "scan") return <ScanScreen {...props} />;
    if (props.tab === "earnings") return <DriverEarnings {...props} />;
    if (props.tab === "account") return <DriverAccount {...props} />;
    return <DriverHome {...props} />;
  }

  if (props.workspace === "station") {
    if (props.tab === "jobs") return <StationJobs {...props} />;
    if (props.tab === "scan") return <ScanScreen {...props} />;
    if (props.tab === "settlements") {
      return <StationSettlements {...props} title="Settlements" />;
    }
    if (props.tab === "account") return <StationAccount {...props} />;
    return <StationDashboard {...props} />;
  }

  if (props.tab === "finance") return <StationSettlements {...props} title="Finance" />;
  if (props.tab === "users") return <AdminUsers {...props} />;
  if (props.tab === "operations") return <AdminOperations {...props} />;
  if (props.tab === "account") return <AccountScreen {...props} />;
  return <AdminOverview {...props} />;
}

function CustomerHome(props: ScreenProps) {
  const name = resolveProfileName(props.context);
  const primaryCylinder = props.queries.cylinders[0] ?? null;
  const activeOrder = props.queries.activeOrders[0] ?? props.queries.orders[0] ?? null;
  const balance = walletTotal(props.queries.wallets, props.currencyCode);
  const address = props.queries.locations[0];

  return (
    <>
      <header className="page-title">
        <BrandLockup badge="LPG" />
        <div className="header-actions">
          <IconBubble label="Notifications" badge="3"><Bell aria-hidden="true" /></IconBubble>
          <IconBubble label="Support"><Headphones aria-hidden="true" /></IconBubble>
        </div>
      </header>
      <section className="greeting">
        <h1>Good evening, {name}</h1>
        <p>How can we help you today?</p>
      </section>
      <button type="button" className="address-pill" onClick={() => props.onAction("save-address")}>
        <MapPin aria-hidden="true" />
        <span>
          Delivering to
          <strong>{getRecordString(address, "label") ?? "Add delivery address"}</strong>
        </span>
        <ChevronRight aria-hidden="true" />
      </button>
      <section className="hero-refill-card">
        <div>
          <span>Refill a cylinder</span>
          <h2>{formatCylinderTitle(primaryCylinder)}</h2>
          <StatusChip tone="success" label={primaryCylinder ? "Ready for refill" : "Add cylinder"} />
          <p>{primaryCylinder ? `Last refill: ${formatDate(primaryCylinder, "last_refill_at")}` : "Register a cylinder to start your first refill."}</p>
          <strong>{formatMoney(1265000, props.currencyCode)}</strong>
          <button type="button" className="primary-button" onClick={() => props.onAction("refill")}>
            Refill Now
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
        <CylinderArt size="large" tone="red" />
      </section>
      <ActiveOrderCard order={activeOrder} onOpenOrders={() => props.onTabChange("orders")} />
      <QuickActions
        actions={[
          ["Refill Cylinder", "refill", <ClipboardList aria-hidden="true" />],
          ["Register Cylinder", "register-cylinder", <Plus aria-hidden="true" />],
          ["Top Up Wallet", "top-up", <WalletCards aria-hidden="true" />],
          ["Support", "support", <Headphones aria-hidden="true" />],
          ["Safety Tips", "support", <ShieldCheck aria-hidden="true" />],
        ]}
        onAction={props.onAction}
      />
      <SectionHeader title="My Cylinders" action="View all" onAction={() => props.onTabChange("cylinders")} />
      <HorizontalCards>
        {props.queries.cylinders.slice(0, 2).map((cylinder) => (
          <MiniCylinderCard key={recordKey(cylinder)} cylinder={cylinder} />
        ))}
        {props.queries.cylinders.length === 0 ? <EmptyMiniCard title="No cylinder yet" /> : null}
        <button type="button" className="add-mini-card" onClick={() => props.onAction("register-cylinder")}>
          <Plus aria-hidden="true" />
          Add Cylinder
        </button>
      </HorizontalCards>
      <section className="two-column">
        <article className="summary-card">
          <span>Wallet Balance</span>
          <strong>{formatMoney(balance, props.currencyCode)}</strong>
          <button type="button" onClick={() => props.onAction("top-up")}>Top Up</button>
        </article>
        <article className="summary-card">
          <span>Recent Refill</span>
          <strong>{activeOrder ? `Order ${formatShortId(getRecordString(activeOrder, "id"))}` : "No refill yet"}</strong>
          <small>{activeOrder ? normalizeStatusLabel(getRecordString(activeOrder, "status") ?? "in_progress") : "Start when ready"}</small>
        </article>
      </section>
    </>
  );
}

function CustomerCylinders(props: ScreenProps) {
  return (
    <>
      <PageHeading title="My Cylinders" subtitle="Manage your LPG cylinders" icon={<QrCode />} />
      <section className="register-banner">
        <div>
          <h2>Register a new cylinder</h2>
          <p>Add your cylinder to enjoy faster refill and track history.</p>
          <button type="button" className="primary-button" onClick={() => props.onAction("register-cylinder")}>
            <Plus aria-hidden="true" />
            Register Cylinder
          </button>
        </div>
        <CylinderArt size="large" tone="mixed" />
      </section>
      <SectionHeader title="Your Cylinders" action="View all" />
      <div className="stack">
        {props.queries.cylinders.map((cylinder) => (
          <CylinderCard key={recordKey(cylinder)} cylinder={cylinder} />
        ))}
        {props.queries.cylinders.length === 0 ? (
          <PolishedEmpty
            icon={<QrCode />}
            title="No cylinder registered"
            message="Register your first cylinder before placing a refill order."
            actionLabel="Register Cylinder"
            onAction={() => props.onAction("register-cylinder")}
          />
        ) : null}
      </div>
      <SafetyCard />
    </>
  );
}

function CustomerOrders(props: ScreenProps) {
  const activeOrder = props.queries.activeOrders[0] ?? props.queries.orders[0] ?? null;

  return (
    <>
      <PageHeading title="My Orders" subtitle="Track and manage your LPG orders" icon={<Bell />} />
      <Segmented labels={["Active", "Completed", "Cancelled"]} activeIndex={0} />
      {activeOrder ? (
        <section className="order-detail-card">
          <div className="order-heading-row">
            <span>Order {formatShortId(getRecordString(activeOrder, "id"))}</span>
            <StatusChip tone="danger" label="ETA 18 min" />
          </div>
          <h2>{orderHeadline(activeOrder)}</h2>
          <p>{orderSubtext(activeOrder)}</p>
          <ProgressStepper
            steps={["Confirmed", "Driver Assigned", "Picked Up", "At Station", "On the Way", "Delivered"]}
            activeIndex={3}
          />
          <MapPreview />
          <div className="driver-station-grid">
            <InfoTile icon={<Building2 />} title="Prime Gas Station" text="Lekki Phase 1, Lagos" />
            <InfoTile icon={<Truck />} title="John Okafor" text="Toyota Hiace · ABC 123 XY" />
          </div>
          <div className="cylinder-summary-strip">
            <CylinderArt size="small" tone="red" />
            <div>
              <strong>12.5kg Cylinder</strong>
              <span>ID: CYL-92841 · Verified</span>
            </div>
            <div>
              <small>Total Paid</small>
              <b>{formatMoney(getRecordNumber(activeOrder, "total_amount") ?? 1265000, props.currencyCode)}</b>
            </div>
          </div>
          <Timeline
            items={[
              ["10:52 AM", "Cylinder arrived at station", true],
              ["10:50 AM", "Cylinder picked up", true],
              ["10:34 AM", "Driver on the way to pickup", true],
              ["10:30 AM", "Order confirmed", true],
            ]}
          />
          <div className="split-actions">
            <button type="button" className="outline-button" onClick={() => props.onAction("support")}>
              Contact Support
            </button>
            <button type="button" className="primary-button">View Live Tracking</button>
          </div>
        </section>
      ) : (
        <PolishedEmpty
          icon={<ClipboardList />}
          title="No active refill"
          message="When you place an LPG refill order, live tracking appears here."
          actionLabel="Refill Cylinder"
          onAction={() => props.onAction("refill")}
        />
      )}
    </>
  );
}

function WalletScreen(props: ScreenProps & { readonly title: string }) {
  const balance = walletTotal(props.queries.wallets, props.currencyCode);

  return (
    <>
      <PageHeading title={props.title} subtitle="Manage your balance and transactions" icon={<Bell />} />
      <section className="wallet-hero">
        <div>
          <span>Available Balance</span>
          <strong>{formatMoney(balance, props.currencyCode)}</strong>
          <small>Pending Balance {formatMoney(215000, props.currencyCode)}</small>
          <div className="split-actions">
            <button type="button" className="light-button" onClick={() => props.onAction("top-up")}>
              <Plus aria-hidden="true" />
              Top Up
            </button>
            <button type="button" className="outline-on-red" onClick={() => props.onAction("withdraw")}>
              <Upload aria-hidden="true" />
              Withdraw
            </button>
          </div>
        </div>
        <WalletArt />
      </section>
      <section className="panel-card">
        <h2>Quick Top Up</h2>
        <div className="amount-grid">
          {[2000, 5000, 10000, 20000].map((amount) => (
            <button key={amount} type="button" onClick={() => props.onAction("top-up")}>
              {formatMoney(amount * 100, props.currencyCode)}
            </button>
          ))}
        </div>
        <button type="button" className="soft-red-row" onClick={() => props.onAction("top-up")}>
          <CreditCard aria-hidden="true" />
          Top up with card, bank, or transfer
          <ChevronRight aria-hidden="true" />
        </button>
      </section>
      <SectionHeader title="Recent Transactions" action="View all" />
      <TransactionList currencyCode={props.currencyCode} />
      <section className="panel-card">
        <SectionHeader title="Payment Methods" action="Manage" />
        <PaymentMethod brand="Visa" label="Visa •••• 4589" tag="Default" />
        <PaymentMethod brand="GT" label="GTBank •••• 1234" />
      </section>
    </>
  );
}

function AccountScreen(props: ScreenProps) {
  return (
    <>
      <PageHeading title="Account" icon={<Bell />} />
      <ProfileCard context={props.context} />
      <WalletMiniPanel
        balance={walletTotal(props.queries.wallets, props.currencyCode)}
        currencyCode={props.currencyCode}
        onWallet={() => props.onTabChange("wallet")}
        onWithdraw={() => props.onAction("withdraw")}
      />
      <QuickLinks
        links={[
          ["My Orders", <ClipboardList aria-hidden="true" />, () => props.onTabChange("orders")],
          ["My Cylinders", <QrCode aria-hidden="true" />, () => props.onTabChange("cylinders")],
          ["Payment Methods", <CreditCard aria-hidden="true" />, () => props.onTabChange("wallet")],
          ["Addresses", <MapPin aria-hidden="true" />, () => props.onAction("save-address")],
          ["Support", <Headphones aria-hidden="true" />, () => props.onAction("support")],
        ]}
      />
      <section className="partner-panel">
        <div className="partner-panel-header">
          <div>
            <h2>Become a Partner with Skima</h2>
            <p>Drive more income by partnering with us.</p>
          </div>
          <button type="button" className="outline-button">Learn More</button>
        </div>
        <div className="partner-cards">
          <button type="button" onClick={() => props.onAction("apply-station")}>
            <StationArt />
            <strong>Register Your Station</strong>
            <span>Own a gas station? Join Skima and grow your business.</span>
            <b>Apply Now</b>
          </button>
          <button type="button" onClick={() => props.onAction("apply-driver")}>
            <DriverArt compact />
            <strong>Register Your Vehicle</strong>
            <span>Have a vehicle? Join our network and start earning.</span>
            <b>Apply Now</b>
          </button>
        </div>
      </section>
      <SettingsPanel
        currencyState={props.currencyState}
        hiddenCurrencyCodes={props.hiddenCurrencyCodes}
        theme={props.theme}
        onHiddenCurrencyCodesChange={props.onHiddenCurrencyCodesChange}
        onThemeChange={props.onThemeChange}
      />
    </>
  );
}

function DriverHome(props: ScreenProps) {
  return (
    <>
      <section className="driver-hero">
        <div className="avatar-large">EO</div>
        <div>
          <span>Good morning,</span>
          <h1>{resolveProfileName(props.context)}</h1>
          <StatusChip tone="success" label="Verified" />
          <p><Star aria-hidden="true" /> 4.9 (128 trips)</p>
          <p><Truck aria-hidden="true" /> Toyota Hiace · ABC 123 XY</p>
        </div>
        <button type="button" className="online-toggle">Online</button>
      </section>
      <section className="earnings-hero">
        <div>
          <span>Today's Earnings</span>
          <strong>{formatMoney(1845000, props.currencyCode)}</strong>
          <small>6 trips completed · 5h 32m online</small>
        </div>
        <div>
          <span>Wallet Balance</span>
          <strong>{formatMoney(walletTotal(props.queries.wallets, props.currencyCode), props.currencyCode)}</strong>
          <button type="button" onClick={() => props.onAction("withdraw")}>Withdraw</button>
        </div>
      </section>
      <section className="availability-card">
        <ShieldCheck aria-hidden="true" />
        <div>
          <h2>You are available for jobs</h2>
          <p>You will receive jobs based on your location.</p>
        </div>
        <button type="button">View Zone</button>
      </section>
      <SectionHeader title="Available Jobs" action="View all" onAction={() => props.onTabChange("jobs")} />
      <JobList onAction={props.onAction} />
      <DriverStats currencyCode={props.currencyCode} />
    </>
  );
}

function DriverJobs(props: ScreenProps) {
  return (
    <>
      <PageHeading title="Job Details" subtitle="Review pickup, station, route, and earnings" icon={<Bell />} />
      <JobList onAction={props.onAction} detailed />
    </>
  );
}

function ScanScreen(props: ScreenProps) {
  return (
    <>
      <PageHeading title="Scan Cylinder" subtitle="Verify the QR code before the next step" icon={<Headphones />} />
      <section className="scan-instruction">
        <ClipboardList aria-hidden="true" />
        <div>
          <h2>Scan the customer’s cylinder QR code</h2>
          <p>Make sure the driver, station, and order match before confirming.</p>
        </div>
        <strong>Order #SKM-48291</strong>
      </section>
      <section className="scanner-card">
        <button type="button">Flash On</button>
        <div className="scan-frame">
          <CylinderArt size="scan" tone="gray" />
          <QrCode aria-hidden="true" />
          <span />
        </div>
        <p>Align QR code within the frame</p>
      </section>
      <section className="scan-result-card">
        <div className="scan-title-row">
          <h2>Cylinder Scan Result</h2>
          <StatusChip tone="success" label="Valid Cylinder" />
        </div>
        <div className="scan-result-body">
          <CylinderArt size="small" tone="gray" />
          <div>
            <h3>12.5kg Cylinder</h3>
            <p>ID: CYL-92841 · Status: Active</p>
            <StatusChip tone="success" label="Verified" />
          </div>
        </div>
        <div className="scan-mini-grid">
          <InfoTile icon={<User />} title="Customer" text="Emeka Okonkwo" />
          <InfoTile icon={<Calendar />} title="Last Refill" text="8 July 2024" />
          <InfoTile icon={<ShieldCheck />} title="Inspection" text="Pass" />
        </div>
        <div className="success-strip">
          <CheckCircle2 aria-hidden="true" />
          This cylinder matches the order and is ready for refill.
        </div>
      </section>
      <button type="button" className="primary-button sticky-action" onClick={() => props.onAction("scan-cylinder")}>
        Confirm Cylinder
      </button>
    </>
  );
}

function DriverEarnings(props: ScreenProps) {
  return (
    <WalletScreen {...props} title="Earnings" />
  );
}

function DriverAccount(props: ScreenProps) {
  return (
    <>
      <PageHeading title="Account" icon={<Bell />} />
      <ProfileCard context={props.context} />
      <section className="panel-card">
        <MenuRow icon={<Truck />} title="Vehicle" text="Toyota Hiace · ABC 123 XY" />
        <MenuRow icon={<FileCheck2 />} title="Documents" text="Driver licence, registration, insurance" />
        <MenuRow icon={<MapPin />} title="Service Zone" text="Awka, Anambra" />
        <MenuRow icon={<Settings />} title="Settings" text="Appearance, currency, and security" />
      </section>
    </>
  );
}

function StationDashboard(props: ScreenProps) {
  return (
    <>
      <header className="station-header">
        <BrandLockup badge="STATION" />
        <IconBubble label="Notifications" badge="5"><Bell aria-hidden="true" /></IconBubble>
      </header>
      <section className="station-title-card">
        <div>
          <h1>Prime Gas Station</h1>
          <p>Lekki Phase 1, Lagos</p>
          <StatusChip tone="success" label="Open" />
        </div>
        <button type="button" className="outline-button">Station Settings</button>
      </section>
      <div className="metric-grid">
        <MetricCard icon={<ClipboardList />} value="4" label="Incoming Jobs" action="View all" />
        <MetricCard icon={<Truck />} value="2" label="Drivers at Station" action="View" />
        <MetricCard icon={<WalletCards />} value={formatMoney(15245000, props.currencyCode)} label="Today's Settlement" action="View details" />
        <MetricCard icon={<CylinderIcon />} value={formatMoney(115000, props.currencyCode)} label="Current Price" action="Edit Price" />
      </div>
      <SectionHeader title="Incoming Refill Jobs" action="View all" onAction={() => props.onTabChange("jobs")} />
      <StationOrderList onAction={props.onAction} />
      <section className="price-prompt">
        <CylinderArt size="small" tone="red" />
        <div>
          <h2>Update your station price</h2>
          <p>Keep your price competitive and attract more orders.</p>
        </div>
        <button type="button" onClick={() => props.onAction("confirm-refill")}>Update Price</button>
      </section>
      <TodaySummary currencyCode={props.currencyCode} />
    </>
  );
}

function StationJobs(props: ScreenProps) {
  return (
    <>
      <PageHeading title="Incoming Job Details" subtitle="Driver is on the way to your station" icon={<Menu />} />
      <section className="notice-card">
        <Truck aria-hidden="true" />
        <div>
          <h2>Driver is on the way to your station</h2>
          <p>Please scan the cylinder when the driver arrives.</p>
        </div>
        <button type="button">Track Driver</button>
      </section>
      <StationOrderList onAction={props.onAction} detailed />
      <section className="panel-card">
        <h2>Driver Information</h2>
        <DriverMiniCard />
      </section>
      <section className="panel-card">
        <h2>Arrival Information</h2>
        <div className="arrival-grid">
          <InfoTile icon={<MapPin />} title="ETA" text="12 min · 2.4 km away" />
          <InfoTile icon={<Calendar />} title="Expected Arrival" text="9:22 AM" />
          <InfoTile icon={<CheckCircle2 />} title="Driver Status" text="On the way" />
        </div>
        <MapPreview compact />
      </section>
      <Timeline
        items={[
          ["9:05 AM", "Order received", true],
          ["9:07 AM", "Driver assigned", true],
          ["--:--", "Arrived at station", false],
          ["--:--", "Refill completed", false],
        ]}
      />
      <div className="split-actions">
        <button type="button" className="outline-button" onClick={() => props.onAction("scan-cylinder")}>
          Scan Cylinder
        </button>
        <button type="button" className="primary-button" onClick={() => props.onAction("support")}>
          Report Issue
        </button>
      </div>
    </>
  );
}

function StationSettlements(props: ScreenProps & { readonly title: string }) {
  return (
    <>
      <PageHeading title={props.title} icon={<Bell />} />
      <Segmented labels={["Overview", "Transactions", "Payouts", "Wallet"]} activeIndex={0} />
      <section className="settlement-hero">
        <div>
          <span>Station Wallet Balance</span>
          <strong>{formatMoney(15245000, props.currencyCode)}</strong>
          <small>Available for withdrawal {formatMoney(14200000, props.currencyCode)}</small>
          <div className="split-actions">
            <button type="button" className="light-button" onClick={() => props.onAction("withdraw")}>Withdraw</button>
            <button type="button" className="outline-on-red">Payout History</button>
          </div>
        </div>
        <WalletArt />
      </section>
      <div className="metric-grid">
        <MetricCard icon={<WalletCards />} value={formatMoney(15245000, props.currencyCode)} label="Total Earnings" trend="+18.5%" />
        <MetricCard icon={<ClipboardList />} value="32" label="Completed Jobs" trend="+12.5%" />
        <MetricCard icon={<CreditCard />} value={formatMoney(12000000, props.currencyCode)} label="Paid Out" trend="-5.3%" />
        <MetricCard icon={<WalletCards />} value={formatMoney(3245000, props.currencyCode)} label="Pending Payout" trend="+8.2%" />
      </div>
      <EarningsTrend currencyCode={props.currencyCode} />
      <TransactionList currencyCode={props.currencyCode} />
    </>
  );
}

function StationAccount(props: ScreenProps) {
  return (
    <>
      <PageHeading title="Inventory & Stock" icon={<Bell />} />
      <Segmented labels={["Cylinder Stock", "Gas Stock", "Accessories", "Orders"]} activeIndex={0} />
      <section className="panel-card">
        <h2>Cylinder Overview</h2>
        <div className="metric-grid">
          <MetricCard icon={<CylinderIcon />} value="320" label="Total Cylinders" />
          <MetricCard icon={<CheckCircle2 />} value="198" label="Available" />
          <MetricCard icon={<User />} value="112" label="In Use" />
          <MetricCard icon={<AlertTriangle />} value="10" label="Maintenance" />
        </div>
        <div className="search-row">
          <Search aria-hidden="true" />
          <span>Search by cylinder ID or customer...</span>
          <button type="button" onClick={() => props.onAction("register-cylinder")}>Add Cylinder</button>
        </div>
      </section>
      <div className="stack">
        {["CYL-92841", "CYL-77321", "CYL-55210", "CYL-11890"].map((id, index) => (
          <CylinderInventoryRow key={id} id={id} status={index === 2 ? "Maintenance" : index === 1 ? "In Use" : "Available"} />
        ))}
      </div>
      <section className="price-prompt">
        <CylinderArt size="small" tone="mixed" />
        <div>
          <h2>Stock running low?</h2>
          <p>Add new cylinders to your inventory and never run out of stock.</p>
        </div>
        <button type="button">Request Stock</button>
      </section>
    </>
  );
}

function AdminOverview(props: ScreenProps) {
  return (
    <>
      <PageHeading title="LPG Operations" subtitle="Monitor the launch service from one control point" icon={<Bell />} />
      <div className="metric-grid">
        <MetricCard icon={<ClipboardList />} value={String(props.queries.orders.length)} label="Orders" />
        <MetricCard icon={<FileCheck2 />} value={String(props.queries.applications.length)} label="Applications" />
        <MetricCard icon={<WalletCards />} value={formatMoney(walletTotal(props.queries.wallets, props.currencyCode), props.currencyCode)} label="Visible Wallets" />
        <MetricCard icon={<ShieldCheck />} value="Safe" label="Verification" />
      </div>
      <AdminOperations {...props} />
    </>
  );
}

function AdminOperations(props: ScreenProps) {
  return (
    <>
      <SectionHeader title="Operational queues" />
      <div className="stack">
        <AdminQueue title="Business applications" value={props.queries.applications.length} text="Review station, driver, and document submissions." />
        <AdminQueue title="LPG orders" value={props.queries.orders.length} text="Track funded, assigned, refilling, delivery, and disputed orders." />
        <AdminQueue title="Safety and verification" value={0} text="Watch failed scans, support cases, and manual overrides." />
      </div>
    </>
  );
}

function AdminUsers(props: ScreenProps) {
  return (
    <>
      <PageHeading title="People & Access" subtitle="Profiles, roles, restrictions, and workspace access" icon={<User />} />
      <section className="panel-card">
        <MenuRow icon={<User />} title="Customers" text="Profile status, wallets, cylinders, and safety records" />
        <MenuRow icon={<Truck />} title="Drivers" text="Approval, vehicles, capabilities, and suspensions" />
        <MenuRow icon={<Building2 />} title="Stations" text="Branches, staff roles, pricing, stock, and settlement visibility" />
        <MenuRow icon={<CreditCard />} title="Currency Controls" text="Global rails, profile restrictions, and user visibility preferences" />
      </section>
    </>
  );
}

interface ScreenProps {
  readonly context: SessionContext;
  readonly queries: LpgQueries;
  readonly workspace: LpgWorkspace;
  readonly tab: LpgTab;
  readonly currencyCode: string;
  readonly theme: InterfaceTheme;
  readonly currencyState: ReturnType<typeof resolveEffectiveCurrencies>;
  readonly hiddenCurrencyCodes: readonly string[];
  readonly onAction: (action: LpgAction) => void;
  readonly onHiddenCurrencyCodesChange: (codes: readonly string[]) => void;
  readonly onTabChange: (tab: LpgTab) => void;
  readonly onThemeChange: (theme: InterfaceTheme) => void;
}

function AppHeader(props: {
  readonly context: SessionContext;
  readonly workspace: LpgWorkspace;
  readonly availableWorkspaces: readonly LpgWorkspace[];
  readonly onWorkspaceChange: (workspace: LpgWorkspace) => void;
  readonly onSignOut: () => void;
}) {
  return (
    <header className="app-header">
      <button type="button" aria-label="Menu" className="icon-button">
        <Menu aria-hidden="true" />
      </button>
      <div>
        <strong>{workspaceConfigs[props.workspace].title}</strong>
        <span>{workspaceConfigs[props.workspace].subtitle}</span>
      </div>
      <button type="button" aria-label="Notifications" className="icon-button notification-dot">
        <Bell aria-hidden="true" />
      </button>
      <button type="button" aria-label="Sign out" className="icon-button" onClick={props.onSignOut}>
        <LogOut aria-hidden="true" />
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

function BottomNav(props: {
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

function ActionSheet(props: {
  readonly action: LpgAction;
  readonly context: SessionContext;
  readonly currencyCode: string;
  readonly queries: LpgQueries;
  readonly onClose: () => void;
  readonly onCompleted: () => void;
}) {
  const session = useLpgSession();
  const [form, setForm] = useState({
    address: "",
    amount: "5000",
    brand: "Skima",
    color: "Red",
    cylinderId: "",
    cylinderIdentifier: "",
    label: "Home",
    latitude: "6.5244",
    longitude: "3.3792",
    maxCapacityKg: "12.5",
    requestedKg: "10",
    sizeKg: "12.5",
  });
  const mutation = useMutation({
    mutationFn: async () => {
      const submission = buildSubmission({
        action: props.action,
        currencyCode: props.currencyCode,
        form,
        queries: props.queries,
        userEmail: props.context.user.email,
      });

      return await session.api.post(submission.path, submission.payload, ActionResponseSchema);
    },
    onSuccess: () => {
      props.onCompleted();
    },
  });

  function update(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="sheet-backdrop" role="presentation">
      <section className="action-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div className="sheet-handle" />
        <header>
          <div>
            <span>{workspaceConfigs.customer.badge}</span>
            <h2 id="sheet-title">{actionTitle(props.action)}</h2>
          </div>
          <button type="button" onClick={props.onClose}>Close</button>
        </header>
        <form
          className="sheet-form"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <ActionFields action={props.action} form={form} queries={props.queries} update={update} />
          {mutation.error ? <p className="form-error">{readError(mutation.error)}</p> : null}
          {mutation.data ? <ActionResultPanel result={mutation.data} /> : null}
          <button type="submit" className="primary-button" disabled={mutation.isPending}>
            {mutation.isPending ? "Processing..." : actionSubmitLabel(props.action)}
          </button>
        </form>
      </section>
    </div>
  );
}

function ActionFields(props: {
  readonly action: LpgAction;
  readonly form: ActionFormState;
  readonly queries: LpgQueries;
  readonly update: (key: keyof ActionFormState, value: string) => void;
}) {
  const update = props.update;

  if (props.action === "refill") {
    return (
      <>
        <label>
          Cylinder
          <select value={props.form.cylinderId} onChange={(event) => update("cylinderId", event.currentTarget.value)}>
            <option value="">Choose cylinder</option>
            {props.queries.cylinders.map((cylinder) => (
              <option key={recordKey(cylinder)} value={getRecordString(cylinder, "id") ?? ""}>
                {formatCylinderTitle(cylinder)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Delivery address
          <select value={props.form.address} onChange={(event) => update("address", event.currentTarget.value)}>
            <option value="">Choose address</option>
            {props.queries.locations.map((location) => (
              <option key={recordKey(location)} value={getRecordString(location, "id") ?? ""}>
                {getRecordString(location, "label") ?? getRecordString(location, "formatted_address") ?? "Saved address"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Requested kg
          <input inputMode="decimal" value={props.form.requestedKg} onChange={(event) => update("requestedKg", event.currentTarget.value)} />
        </label>
      </>
    );
  }

  if (props.action === "register-cylinder") {
    return (
      <>
        <label>
          Cylinder ID
          <input value={props.form.cylinderIdentifier} onChange={(event) => update("cylinderIdentifier", event.currentTarget.value)} placeholder="CYL-92841" />
        </label>
        <div className="form-grid">
          <label>
            Size kg
            <input inputMode="decimal" value={props.form.sizeKg} onChange={(event) => update("sizeKg", event.currentTarget.value)} />
          </label>
          <label>
            Capacity kg
            <input inputMode="decimal" value={props.form.maxCapacityKg} onChange={(event) => update("maxCapacityKg", event.currentTarget.value)} />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Brand
            <input value={props.form.brand} onChange={(event) => update("brand", event.currentTarget.value)} />
          </label>
          <label>
            Colour
            <input value={props.form.color} onChange={(event) => update("color", event.currentTarget.value)} />
          </label>
        </div>
      </>
    );
  }

  if (props.action === "save-address") {
    return (
      <>
        <label>
          Label
          <input value={props.form.label} onChange={(event) => update("label", event.currentTarget.value)} />
        </label>
        <label>
          Address
          <textarea value={props.form.address} onChange={(event) => update("address", event.currentTarget.value)} placeholder="Street, area, city" />
        </label>
        <div className="form-grid">
          <label>
            Latitude
            <input inputMode="decimal" value={props.form.latitude} onChange={(event) => update("latitude", event.currentTarget.value)} />
          </label>
          <label>
            Longitude
            <input inputMode="decimal" value={props.form.longitude} onChange={(event) => update("longitude", event.currentTarget.value)} />
          </label>
        </div>
      </>
    );
  }

  if (props.action === "top-up") {
    return (
      <label>
        Amount
        <input inputMode="decimal" value={props.form.amount} onChange={(event) => update("amount", event.currentTarget.value)} />
      </label>
    );
  }

  return (
    <section className="action-copy">
      <ShieldCheck aria-hidden="true" />
      <p>This request will be checked against your role, policy, and current order state.</p>
    </section>
  );
}

function buildSubmission(input: {
  readonly action: LpgAction;
  readonly currencyCode: string;
  readonly form: Readonly<Record<string, string>>;
  readonly queries: LpgQueries;
  readonly userEmail: string | null;
}): { readonly path: string; readonly payload: PlatformRecord } {
  const idempotencyScope = `lpg-mobile-${input.action}`;

  if (input.action === "register-cylinder") {
    const cylinderIdentifier = requireValue(input.form.cylinderIdentifier, "Enter the cylinder ID.");

    return {
      path: "/lpg/cylinders",
      payload: {
        brand: input.form.brand || null,
        colour: input.form.color || null,
        conditionStatus: "unknown",
        cylinderIdentifier,
        idempotencyKey: createClientIdempotencyKey(idempotencyScope, cylinderIdentifier),
        maxCapacityKg: parsePositiveNumber(input.form.maxCapacityKg, "Capacity"),
        metadata: { source: "lpg-mobile" },
        sizeKg: parsePositiveNumber(input.form.sizeKg, "Cylinder size"),
      },
    };
  }

  if (input.action === "save-address") {
    const formattedAddress = requireValue(input.form.address, "Enter the address.");

    return {
      path: "/lpg/locations",
      payload: {
        formattedAddress,
        idempotencyKey: createClientIdempotencyKey(idempotencyScope, formattedAddress),
        label: requireValue(input.form.label, "Enter the address label."),
        latitude: parseCoordinate(input.form.latitude, -90, 90, "Latitude"),
        longitude: parseCoordinate(input.form.longitude, -180, 180, "Longitude"),
        metadata: { source: "lpg-mobile" },
      },
    };
  }

  if (input.action === "refill") {
    const cylinderId = requireValue(
      input.form.cylinderId || getRecordString(input.queries.cylinders[0], "id") || "",
      "Register a cylinder first.",
    );
    const deliveryLocationId = requireValue(
      input.form.address || getRecordString(input.queries.locations[0], "id") || "",
      "Save a delivery address first.",
    );

    return {
      path: "/lpg/quotes",
      payload: {
        cylinderId,
        deliveryLocationId,
        idempotencyKey: createClientIdempotencyKey(idempotencyScope, cylinderId),
        metadata: { source: "lpg-mobile" },
        pickupLocationId: deliveryLocationId,
        requestedKg: parsePositiveNumber(input.form.requestedKg, "Requested kg"),
      },
    };
  }

  if (input.action === "top-up") {
    return {
      path: "/runtime/payments/deposits",
      payload: {
        amount: Math.round(parsePositiveNumber(input.form.amount, "Amount") * 100),
        currencyCode: input.currencyCode,
        idempotencyKey: createClientIdempotencyKey(idempotencyScope, input.userEmail ?? "customer"),
        metadata: { source: "lpg-mobile" },
      },
    };
  }

  return {
    path: "/runtime/communications/messages",
    payload: {
      body: `${actionTitle(input.action)} requested`,
      idempotencyKey: createClientIdempotencyKey(idempotencyScope, input.userEmail ?? "user"),
      metadata: { source: "lpg-mobile" },
      subject: actionTitle(input.action),
    },
  };
}

function useGatewayRecords(queryKey: string, path: string, enabled: boolean) {
  const session = useLpgSession();

  return useQuery({
    enabled: session.status === "authenticated" && enabled,
    queryFn: async () => await session.api.get(path, RecordArraySchema),
    queryKey: ["lpg-mobile", queryKey, path],
  });
}

function useStoredPreference<TValue extends string>(
  key: string,
  fallback: TValue,
  isValid: (value: string) => value is TValue,
): readonly [TValue, (value: TValue) => void] {
  const [value, setValue] = useState<TValue>(() => {
    if (typeof window === "undefined") return fallback;
    const stored = window.localStorage.getItem(key);
    return stored && isValid(stored) ? stored : fallback;
  });

  const update = (nextValue: TValue) => {
    setValue(nextValue);
    if (typeof window !== "undefined") window.localStorage.setItem(key, nextValue);
  };

  return [value, update];
}

function useStoredStringListPreference(
  key: string,
): readonly [readonly string[], (value: readonly string[]) => void] {
  const [value, setValue] = useState<readonly string[]>(() => {
    if (typeof window === "undefined") return [];
    const stored = window.localStorage.getItem(key);

    if (!stored) return [];

    try {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch (_error) {
      return [];
    }
  });

  const update = (nextValue: readonly string[]) => {
    setValue(nextValue);
    if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(nextValue));
  };

  return [value, update];
}

function useResolvedTheme(theme: InterfaceTheme): "light" | "dark" {
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(() => readSystemTheme());

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemTheme(query.matches ? "dark" : "light");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return theme === "system" ? systemTheme : theme;
}

function isInterfaceTheme(value: string): value is InterfaceTheme {
  return value === "system" || value === "light" || value === "dark";
}

function readSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function navIcon(tab: LpgTab): ReactNode {
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

function walletTotal(records: readonly PlatformRecord[], currencyCode: string): number {
  return records.reduce((total, record) => {
    const recordCurrency = getRecordString(record, "currency_code") ?? currencyCode;
    if (recordCurrency !== currencyCode) return total;
    return total + (getRecordNumber(record, "balance") ?? 0);
  }, 0);
}

function getRecordString(record: PlatformRecord | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getRecordNumber(record: PlatformRecord | null | undefined, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recordKey(record: PlatformRecord): string {
  return getRecordString(record, "id") ?? getRecordString(record, "key") ?? crypto.randomUUID();
}

function formatShortId(value: string | null): string {
  if (!value) return "#SKM-48291";
  return value.length > 10 ? `#${value.slice(0, 8).toUpperCase()}` : `#${value.toUpperCase()}`;
}

function formatDate(record: PlatformRecord | null, key: string): string {
  const value = getRecordString(record, key);
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(value));
}

function formatCylinderTitle(cylinder: PlatformRecord | null): string {
  if (!cylinder) return "12.5kg Cylinder";
  const size = getRecordNumber(cylinder, "size_kg") ?? getRecordNumber(cylinder, "sizeKg") ?? 12.5;
  return `${size}kg Cylinder`;
}

function orderHeadline(order: PlatformRecord): string {
  const status = getRecordString(order, "status") ?? "refill_in_progress";
  if (status.includes("delivered")) return "Delivered";
  if (status.includes("station")) return "Refill in progress";
  return normalizeStatusLabel(status);
}

function orderSubtext(order: PlatformRecord): string {
  const status = getRecordString(order, "status") ?? "";
  if (status.includes("station")) return "Your cylinder is being refilled at the station.";
  if (status.includes("delivery")) return "Your driver is on the way to deliver.";
  return "Track each verified step of your LPG refill.";
}

function requireValue(value: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

function parsePositiveNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
}

function parseCoordinate(value: string, min: number, max: number, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} is outside the allowed range.`);
  }
  return parsed;
}

function readError(error: unknown): string {
  if (error instanceof ApiGatewayError) return error.message;
  if (error instanceof Error) return error.message;
  return "The request could not be completed.";
}

function actionTitle(action: LpgAction): string {
  const titles: Record<LpgAction, string> = {
    "accept-job": "Accept Job",
    "apply-driver": "Apply as Driver",
    "apply-station": "Register Station",
    "confirm-refill": "Confirm Refill",
    "refill": "Refill Quote",
    "register-cylinder": "Register Cylinder",
    "save-address": "Save Address",
    "scan-cylinder": "Confirm Cylinder Scan",
    "support": "Contact Support",
    "top-up": "Top Up Wallet",
    "withdraw": "Withdraw Funds",
  };
  return titles[action];
}

function actionSubmitLabel(action: LpgAction): string {
  if (action === "refill") return "Get Quote";
  if (action === "register-cylinder") return "Save Cylinder";
  if (action === "save-address") return "Save Address";
  if (action === "top-up") return "Start Payment";
  return "Continue";
}

function ActionResultPanel(props: { readonly result: ActionResult }) {
  if (typeof props.result === "string") {
    return (
      <div className="action-result">
        <CheckCircle2 aria-hidden="true" />
        <strong>Request received</strong>
        <span>{formatShortId(props.result)}</span>
      </div>
    );
  }

  const code = getRecordString(props.result, "code");
  const checkoutUrl = getRecordString(props.result, "checkoutUrl");

  return (
    <div className="action-result">
      <CheckCircle2 aria-hidden="true" />
      <strong>{code ? "Secure code ready" : "Request received"}</strong>
      {code ? <b>{code}</b> : null}
      {checkoutUrl ? <a href={checkoutUrl} target="_blank" rel="noreferrer">Continue payment</a> : null}
    </div>
  );
}

function StateScreen(props: {
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

function PhoneStatus() {
  return (
    <div className="phone-status" aria-hidden="true">
      <span>9:41</span>
      <div><i /><i /><i /></div>
    </div>
  );
}

function BrandLockup(props: { readonly badge?: string; readonly size?: "large" }) {
  return (
    <div className={`brand-lockup ${props.size === "large" ? "is-large" : ""}`}>
      <div className="brand-mark">S</div>
      <strong>SKIMA</strong>
      {props.badge ? <span>{props.badge}</span> : null}
    </div>
  );
}

function StepDots(props: { readonly total: number; readonly active: number }) {
  return (
    <div className="step-dots" aria-hidden="true">
      {Array.from({ length: props.total }, (_, index) => (
        <span key={index} className={index === props.active ? "is-active" : ""} />
      ))}
    </div>
  );
}

function IconBubble(props: { readonly label: string; readonly badge?: string; readonly children: ReactNode }) {
  return (
    <button type="button" className="icon-bubble" aria-label={props.label}>
      {props.children}
      {props.badge ? <span>{props.badge}</span> : null}
    </button>
  );
}

function PageHeading(props: { readonly title: string; readonly subtitle?: string; readonly icon?: ReactNode }) {
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

function SectionHeader(props: {
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

function StatusChip(props: { readonly label: string; readonly tone: "success" | "warning" | "danger" | "info" }) {
  return <span className={`status-chip is-${props.tone}`}>{props.label}</span>;
}

function CylinderIcon() {
  return <QrCode aria-hidden="true" />;
}

function CylinderArt(props: { readonly size: "small" | "large" | "scan"; readonly tone: "red" | "gray" | "mixed" }) {
  return (
    <div className={`cylinder-art is-${props.size} is-${props.tone}`} aria-hidden="true">
      <span />
      <b>S</b>
      <i />
    </div>
  );
}

function WalletArt() {
  return (
    <div className="wallet-art" aria-hidden="true">
      <span>S</span>
      <i />
      <b />
    </div>
  );
}

function StationArt() {
  return (
    <div className="station-art" aria-hidden="true">
      <span />
      <i />
      <b>SKIMA</b>
    </div>
  );
}

function DriverArt(props: { readonly compact?: boolean }) {
  return (
    <div className={`driver-art ${props.compact ? "is-compact" : ""}`} aria-hidden="true">
      <span />
      <i />
      <b />
    </div>
  );
}

function ActiveOrderCard(props: { readonly order: PlatformRecord | null; readonly onOpenOrders: () => void }) {
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

  return (
    <section className="active-order-card">
      <div>
        <span>Active Order</span>
        <h2>Your cylinder is on the way back</h2>
        <p>Driver is 12 mins away</p>
        <DriverMiniCard compact />
      </div>
      <MapPreview compact />
      <button type="button" onClick={props.onOpenOrders}>Live Tracking</button>
    </section>
  );
}

function QuickActions(props: {
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

function HorizontalCards(props: { readonly children: ReactNode }) {
  return <div className="horizontal-cards">{props.children}</div>;
}

function EmptyMiniCard(props: { readonly title: string }) {
  return (
    <article className="mini-card empty-mini">
      <ShieldCheck aria-hidden="true" />
      <strong>{props.title}</strong>
    </article>
  );
}

function MiniCylinderCard(props: { readonly cylinder: PlatformRecord }) {
  return (
    <article className="mini-card">
      <CylinderArt size="small" tone="red" />
      <div>
        <strong>{formatCylinderTitle(props.cylinder)}</strong>
        <span>{normalizeStatusLabel(getRecordString(props.cylinder, "status") ?? "verified")}</span>
      </div>
      <ChevronRight aria-hidden="true" />
    </article>
  );
}

function CylinderCard(props: { readonly cylinder: PlatformRecord }) {
  const status = getRecordString(props.cylinder, "status") ?? "verified";

  return (
    <article className="cylinder-card">
      <CylinderArt size="large" tone={status.includes("maintenance") ? "gray" : "red"} />
      <div>
        <StatusChip tone={status.includes("inspection") ? "warning" : "success"} label={normalizeStatusLabel(status)} />
        <h2>{formatCylinderTitle(props.cylinder)}</h2>
        <p>ID: {getRecordString(props.cylinder, "cylinder_identifier") ?? "CYL-92841"} · {getRecordString(props.cylinder, "colour") ?? "Red"}</p>
        <div className="info-grid">
          <InfoTile icon={<Calendar />} title="Last refill" text={formatDate(props.cylinder, "last_refill_at")} />
          <InfoTile icon={<ShieldCheck />} title="Next inspection" text="8 Jan 2027" />
        </div>
      </div>
      <QrCode aria-hidden="true" />
    </article>
  );
}

function SafetyCard() {
  return (
    <section className="safety-card">
      <ShieldCheck aria-hidden="true" />
      <div>
        <h2>Cylinder safety is important</h2>
        <p>Always ensure your cylinder is in good condition before refill.</p>
      </div>
      <button type="button" className="outline-button">Safety Tips</button>
    </section>
  );
}

function Segmented(props: { readonly labels: readonly string[]; readonly activeIndex: number }) {
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

function ProgressStepper(props: { readonly steps: readonly string[]; readonly activeIndex: number }) {
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

function MapPreview(props: { readonly compact?: boolean }) {
  return (
    <div className={`map-preview ${props.compact ? "is-compact" : ""}`} aria-label="Route preview">
      <span className="route-line" />
      <i className="map-pin start" />
      <i className="map-pin end" />
      <b className="vehicle-dot" />
    </div>
  );
}

function InfoTile(props: { readonly icon: ReactNode; readonly title: string; readonly text: string }) {
  return (
    <article className="info-tile">
      <span>{props.icon}</span>
      <small>{props.title}</small>
      <strong>{props.text}</strong>
    </article>
  );
}

function Timeline(props: { readonly items: readonly (readonly [string, string, boolean])[] }) {
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

function TransactionList(props: { readonly currencyCode: string }) {
  const rows = [
    ["Top Up", "Card Payment", 1000000, "Successful", "success"],
    ["LPG Refill Payment", "Order #SKM-48291", -1265000, "Paid", "danger"],
    ["Refund", "Order #SKM-48102", 320000, "Successful", "success"],
    ["Withdrawal", "GTBank •••• 1234", -800000, "Processing", "warning"],
  ] as const;

  return (
    <section className="transaction-list">
      {rows.map(([title, text, amount, tag, tone]) => (
        <article key={title} className="transaction-row">
          <span className={`transaction-icon is-${tone}`}>
            <WalletCards aria-hidden="true" />
          </span>
          <div>
            <strong>{title}</strong>
            <small>{text}</small>
          </div>
          <div className="transaction-amount">
            <b>{formatMoney(amount, props.currencyCode)}</b>
            <StatusChip tone={tone === "danger" ? "danger" : tone === "warning" ? "warning" : "success"} label={tag} />
          </div>
        </article>
      ))}
    </section>
  );
}

function PaymentMethod(props: { readonly brand: string; readonly label: string; readonly tag?: string }) {
  return (
    <article className="payment-method">
      <span>{props.brand}</span>
      <strong>{props.label}</strong>
      {props.tag ? <StatusChip tone="success" label={props.tag} /> : null}
      <ChevronRight aria-hidden="true" />
    </article>
  );
}

function ProfileCard(props: { readonly context: SessionContext }) {
  const name = resolveProfileName(props.context);

  return (
    <section className="profile-card">
      <div className="avatar-large">{initials(name)}</div>
      <div>
        <h2>{name}</h2>
        <StatusChip tone="success" label="Verified" />
        <p>{props.context.user.email ?? "Phone verified"}</p>
      </div>
      <ChevronRight aria-hidden="true" />
    </section>
  );
}

function WalletMiniPanel(props: {
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

function QuickLinks(props: { readonly links: readonly (readonly [string, ReactNode, () => void])[] }) {
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

function SettingsPanel(props: {
  readonly currencyState: ReturnType<typeof resolveEffectiveCurrencies>;
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

function JobList(props: { readonly onAction: (action: LpgAction) => void; readonly detailed?: boolean }) {
  const jobs = [
    ["Refill 12.5kg Cylinder", "Okafor Family", "Ekwueme Street, Awka", "4.2 km", "28 mins", 345000],
    ["Refill 6kg Cylinder", "Chinedu Obi", "Amawbia Road, Awka", "3.1 km", "20 mins", 215000],
    ["Refill 12.5kg Cylinder", "John Okechukwu", "Fegge, Onitsha Road", "5.6 km", "35 mins", 370000],
  ] as const;

  return (
    <div className="job-list">
      {jobs.map(([title, pickup, delivery, distance, time, amount]) => (
        <article key={`${title}-${pickup}`} className="job-card">
          <CylinderArt size="small" tone="red" />
          <div>
            <h2>{title}</h2>
            <p><span /> Pickup<br />{pickup}</p>
            <p><i /> Deliver to<br />{delivery}</p>
          </div>
          <aside>
            <strong>{formatMoney(amount, "NGN")}</strong>
            <small>{distance}</small>
            <small>{time}</small>
            <button type="button" className="primary-button" onClick={() => props.onAction("accept-job")}>
              Accept Job
            </button>
            {props.detailed ? <button type="button" className="outline-button">View Details</button> : null}
          </aside>
        </article>
      ))}
    </div>
  );
}

function DriverStats(props: { readonly currencyCode: string }) {
  return (
    <div className="metric-grid">
      <MetricCard icon={<ClipboardList />} value="32" label="Completed Jobs" />
      <MetricCard icon={<Calendar />} value="18h 45m" label="Online Time" />
      <MetricCard icon={<WalletCards />} value={formatMoney(9645000, props.currencyCode)} label="Earnings" />
      <MetricCard icon={<Star />} value="4.9" label="Rating" />
    </div>
  );
}

function DriverMiniCard(props: { readonly compact?: boolean }) {
  return (
    <article className={`driver-mini-card ${props.compact ? "is-compact" : ""}`}>
      <div className="avatar-small">JO</div>
      <div>
        <strong>John Okafor</strong>
        <small><Star aria-hidden="true" /> 4.9 · Toyota Hiace</small>
      </div>
      {!props.compact ? <button type="button" className="icon-button"><MessageCircle aria-hidden="true" /></button> : null}
    </article>
  );
}

function StationOrderList(props: {
  readonly onAction: (action: LpgAction) => void;
  readonly detailed?: boolean;
}) {
  const orders = [
    ["#SKM-48291", "12.5kg Cylinder", "10kg requested", "John Okafor", 1150000],
    ["#SKM-48292", "6kg Cylinder", "5kg requested", "Emeka Nwosu", 575000],
    ["#SKM-48293", "12.5kg Cylinder", "12kg requested", "Chinedu Obi", 1380000],
  ] as const;

  return (
    <div className="station-order-list">
      {orders.map(([orderId, title, kg, driver, amount], index) => (
        <article key={orderId} className="station-order-card">
          <StatusChip tone={index === 0 ? "danger" : index === 1 ? "warning" : "info"} label="New" />
          <CylinderArt size="small" tone="gray" />
          <div>
            <h2>Order {orderId}</h2>
            <p>{title} · {kg}</p>
            <small>{driver} · ETA {12 + index * 6} min</small>
          </div>
          <aside>
            <strong>{formatMoney(amount, "NGN")}</strong>
            <button type="button" className={index === 0 ? "primary-button" : "outline-button"} onClick={() => props.onAction("scan-cylinder")}>
              Scan Cylinder
            </button>
          </aside>
          {props.detailed ? (
            <div className="station-order-detail">
              <InfoTile icon={<User />} title="Customer" text="Emeka Okonkwo" />
              <InfoTile icon={<MapPin />} title="Area" text="Lekki Phase 1" />
              <InfoTile icon={<CreditCard />} title="Payment" text="Paid" />
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function MetricCard(props: {
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

function TodaySummary(props: { readonly currencyCode: string }) {
  return (
    <section className="today-summary">
      <SectionHeader title="Today’s Summary" action="View report" />
      <div className="metric-grid">
        <MetricCard icon={<CheckCircle2 />} value="12" label="Jobs Completed" />
        <MetricCard icon={<Calendar />} value="2" label="In Progress" />
        <MetricCard icon={<WalletCards />} value={formatMoney(15245000, props.currencyCode)} label="Total Earned" />
        <MetricCard icon={<WalletCards />} value={formatMoney(2430000, props.currencyCode)} label="Pending" />
      </div>
    </section>
  );
}

function EarningsTrend(props: { readonly currencyCode: string }) {
  return (
    <section className="trend-card">
      <SectionHeader title="Earnings Trend" action="Last 7 Days" />
      <div className="chart-line" aria-label="Earnings trend">
        {[98, 112, 135, 98, 168, 142, 152].map((value, index) => (
          <span key={index} style={{ height: `${Math.max(20, value / 2)}px` }}>
            <b>{formatMoney(value * 100000, props.currencyCode)}</b>
          </span>
        ))}
      </div>
    </section>
  );
}

function CylinderInventoryRow(props: { readonly id: string; readonly status: string }) {
  const tone = props.status === "Maintenance" ? "warning" : props.status === "In Use" ? "info" : "success";

  return (
    <article className="inventory-row">
      <CylinderArt size="small" tone={tone === "success" ? "red" : "gray"} />
      <div>
        <h2>{props.id}</h2>
        <p>12.5kg Cylinder</p>
        <small>Customer: Emeka Okonkwo · Lekki Phase 1</small>
      </div>
      <StatusChip tone={tone} label={props.status} />
      <ChevronRight aria-hidden="true" />
    </article>
  );
}

function PolishedEmpty(props: {
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

function MenuRow(props: { readonly icon: ReactNode; readonly title: string; readonly text: string }) {
  return (
    <article className="menu-row">
      <span>{props.icon}</span>
      <div>
        <strong>{props.title}</strong>
        <small>{props.text}</small>
      </div>
      <ChevronRight aria-hidden="true" />
    </article>
  );
}

function AdminQueue(props: { readonly title: string; readonly value: number; readonly text: string }) {
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

function initials(value: string): string {
  const parts = value.split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "S"}${parts[1]?.[0] ?? "K"}`.toUpperCase();
}
