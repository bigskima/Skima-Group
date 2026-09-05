import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  Bell,
  Building2,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  MapPin,
  Navigation,
  PackageCheck,
  QrCode,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Truck,
  WalletCards,
} from "lucide-react-native";
import type { ComponentType, ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { domainQueries, useEntityMediaLinks } from "../api/domains";
import {
  displayStatus,
  displaySubtitle,
  displayTitle,
  firstNumber,
  firstString,
  recordId,
  type PlatformRecord,
} from "../api/records";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors } from "../theme/tokens";
import { BrandMark } from "./BrandMark";
import { PromotionBanner } from "./PromotionBanner";
import { RuntimeMediaImage } from "./RuntimeMediaImage";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { GuideTarget } from "../onboarding/InAppGuideProvider";

type Workspace = "customer" | "driver" | "station";
type IconType = ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;

export function CustomerDashboard() {
  const cylinders = domainQueries.cylinders();
  const active = domainQueries.activeOrders();
  const locations = domainQueries.locations();
  const wallets = domainQueries.wallets();
  const stations = domainQueries.stations();
  const sources = [cylinders, active, locations, wallets, stations];
  const pending = sources.every((source) => source.isPending);
  const failed = sources.every((source) => Boolean(source.error));
  const cylinder = cylinders.data?.[0];
  const order = active.data?.[0];
  const location = locations.data?.[0];
  const orderId = order ? recordId(order) : null;
  const balance = (wallets.data ?? []).reduce(
    (sum, item) => sum + (firstNumber(item, ["balance", "available_balance", "availableBalance"]) ?? 0),
    0,
  );
  const currency = firstString(wallets.data?.[0], ["currency_code", "currencyCode"]) ?? "NGN";
  const primary = order && orderId
    ? {
        eyebrow: humanStatus(displayStatus(order) ?? "active"),
        title: "Track your refill",
        body: "Follow your cylinder from pickup to your doorstep.",
        label: "View live order",
        href: `/(customer)/orders/${orderId}/tracking`,
        icon: Navigation,
      }
    : cylinder
      ? {
          eyebrow: "Ready when you are",
          title: "Refill a cylinder",
          body: "Choose a cylinder and arrange pickup in a few taps.",
          label: "Start refill",
          href: "/(customer)/orders/new",
          icon: PackageCheck,
        }
      : {
          eyebrow: "Let's get you started",
          title: "Add your first cylinder",
          body: "Register it once, then request refills whenever you need them.",
          label: "Add cylinder",
          href: "/(customer)/cylinder/register",
          icon: QrCode,
        };

  return (
    <MobileHome workspace="customer" context="Refill and delivery">
      <GuideTarget targetKey="customer.location">
        <CustomerLocation location={location} />
      </GuideTarget>
      {pending ? (
        <ScreenSkeleton cards={3} />
      ) : failed ? (
        <LoadError
          onRetry={() => void Promise.all([
            cylinders.refetch(),
            active.refetch(),
            locations.refetch(),
            wallets.refetch(),
            stations.refetch(),
          ])}
        />
      ) : (
        <>
          <GuideTarget targetKey="customer.primary-action">
            <CustomerPrimaryAction {...primary} />
          </GuideTarget>

          {order && orderId ? (
            <ActiveOrder record={order} href={`/(customer)/orders/${orderId}`} />
          ) : null}

          <PromotionBanner audience="customer" />

          <HomeSection
            title="Your cylinders"
            action={cylinder ? "See all" : "Add one"}
            href={cylinder ? "/(customer)/cylinders" : "/(customer)/cylinder/register"}
          >
            <CustomerCylinderRecords
              records={cylinders.data ?? []}
              empty="Your cylinders will appear here after you add the first one."
              limit={2}
            />
          </HomeSection>

          <View style={styles.customerUtilities}>
            <UtilityLink
              icon={WalletCards}
              label="Wallet"
              value={formatMoney(balance, currency)}
              href="/(customer)/wallet"
            />
            <UtilityLink
              icon={Building2}
              label="Nearby stations"
              value={`${stations.data?.length ?? 0} available`}
              href="/(customer)/stations"
            />
          </View>
        </>
      )}
    </MobileHome>
  );
}

export function DriverDashboard() {
  const { palette } = useAppTheme();
  const jobs = domainQueries.driverJobs();
  const commissions = domainQueries.commissions();
  const vehicles = domainQueries.vehicles();
  const sources = [jobs, commissions, vehicles];
  const pending = sources.every((source) => source.isPending);
  const failed = sources.every((source) => Boolean(source.error));
  const active = jobs.data?.find((item) => !["completed", "cancelled"].includes(normalizedStatus(displayStatus(item) ?? "")));
  const activeId = active ? recordId(active) : null;
  const earnings = (commissions.data ?? []).reduce(
    (sum, item) => sum + (firstNumber(item, ["amount", "commission_amount", "net_amount"]) ?? 0),
    0,
  );
  const currency = firstString(commissions.data?.[0], ["currency_code", "currencyCode"]) ?? "NGN";

  return (
    <MobileHome workspace="driver" context="Driver workspace">
      {pending ? (
        <ScreenSkeleton cards={3} />
      ) : failed ? (
        <LoadError onRetry={() => void Promise.all([jobs.refetch(), commissions.refetch(), vehicles.refetch()])} />
      ) : (
        <>
          <DriverCockpit record={active} />

          <GuideTarget targetKey="driver.operations" style={styles.driverActions}>
            <OperationalAction
              icon={ScanLine}
              label="Scan cylinder"
              hint="Verify a pickup or handover"
              href="/(driver)/scan"
            />
            <OperationalAction
              icon={Navigation}
              label="Availability"
              hint="Update your live status"
              href="/(driver)/availability"
            />
          </GuideTarget>

          <View style={styles.driverMetrics}>
            <MetricLink
              label="Available earnings"
              value={formatMoney(earnings, currency)}
              href="/(driver)/earnings"
            />
            <View style={[styles.metricDivider, { backgroundColor: palette.border }]} />
            <MetricLink
              label="Delivery vehicle"
              value={`${vehicles.data?.length ?? 0} registered`}
              href="/(driver)/vehicles"
            />
          </View>

          <HomeSection title="Next assignments" action="All jobs" href="/(driver)/jobs">
            <NaturalRecords
              records={activeId ? (jobs.data ?? []).filter((item) => recordId(item) !== activeId) : (jobs.data ?? [])}
              empty="No additional jobs are waiting."
              detailBase="/(driver)/job"
              icon={Truck}
              limit={3}
            />
          </HomeSection>

          <SupportLine href="/(driver)/support" label="Driver support" />
        </>
      )}
    </MobileHome>
  );
}

export function StationDashboard() {
  const { palette } = useAppTheme();
  const jobs = domainQueries.stationJobs();
  const settlements = domainQueries.settlements();
  const sources = [jobs, settlements];
  const pending = sources.every((source) => source.isPending);
  const failed = sources.every((source) => Boolean(source.error));
  const records = jobs.data ?? [];
  const current = records.find((item) => isStationProcessing(displayStatus(item)))
    ?? records.find((item) => !["completed", "cancelled"].includes(normalizedStatus(displayStatus(item) ?? "")));
  const currentId = current ? recordId(current) : null;
  const waiting = records.filter((item) => isWaitingAtStation(displayStatus(item))).length;
  const processing = records.filter((item) => isStationProcessing(displayStatus(item))).length;
  const settled = (settlements.data ?? []).reduce(
    (sum, item) => sum + (firstNumber(item, ["net_amount", "netAmount", "amount"]) ?? 0),
    0,
  );
  const currency = firstString(settlements.data?.[0], ["currency_code", "currencyCode"]) ?? "NGN";

  return (
    <MobileHome workspace="station" context="Station reception">
      {pending ? (
        <ScreenSkeleton cards={3} />
      ) : failed ? (
        <LoadError onRetry={() => void Promise.all([jobs.refetch(), settlements.refetch()])} />
      ) : (
        <>
          <View style={styles.receptionHeading}>
            <View>
              <Text style={styles.receptionEyebrow}>TODAY AT RECEPTION</Text>
              <Text style={[styles.receptionTitle, { color: palette.ink }]}>Keep cylinders moving safely.</Text>
            </View>
            <View style={styles.queueCount}>
              <Text style={styles.queueNumber}>{records.length}</Text>
              <Text style={[styles.queueLabel, { color: palette.muted }]}>in queue</Text>
            </View>
          </View>

          <View style={styles.stationActions}>
            <StationAction
              primary
              icon={ScanLine}
              step="01"
              title="Scan & Accept"
              body="Verify the driver and cylinders at reception."
              href="/(station)/scan"
            />
            <StationAction
              icon={CircleCheck}
              step="02"
              title="Confirm & Release"
              body="Record the actual fill and return to the driver."
              href={currentId ? `/(station)/job/${currentId}` : "/(station)/jobs"}
            />
          </View>

          <View style={styles.receptionStatus}>
            <ReceptionMetric value={waiting} label="Awaiting acceptance" />
            <ReceptionMetric value={processing} label="Being processed" />
          </View>

          <HomeSection title="Reception queue" action="Open queue" href="/(station)/jobs">
            <ReceptionQueue records={records} />
          </HomeSection>

          <UtilityLink
            icon={WalletCards}
            label="Station earnings"
            value={formatMoney(settled, currency)}
            href="/(station)/settlements"
          />
          <SupportLine href="/(station)/support" label="Station support" />
        </>
      )}
    </MobileHome>
  );
}

function MobileHome({ workspace, context, children }: {
  workspace: Workspace;
  context: string;
  children: ReactNode;
}) {
  const session = useSession();
  const { palette } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const firstName = session.context?.profile?.display_name?.trim().split(/\s+/)[0];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.canvas }}
      contentContainerStyle={[styles.page, { paddingTop: Math.max(insets.top, 12) }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.mobileFrame, { maxWidth: width >= 900 ? 760 : 640 }]}>
        <View style={styles.appHeader}>
          <View style={styles.identity}>
            <BrandMark compact />
            <View style={styles.identityCopy}>
              <Text style={[styles.context, { color: palette.muted }]}>{context.toUpperCase()}</Text>
              <Text numberOfLines={1} style={[styles.greeting, { color: palette.ink }]}>
                {firstName ? `Hello, ${firstName}` : "Welcome to SKIMA"}
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityLabel="Open notifications"
            onPress={() => router.push(`/${`(${workspace})`}/notifications` as never)}
            style={[styles.notification, { backgroundColor: palette.surface, borderColor: palette.border }]}
          >
            <Bell color={palette.ink} size={19} />
            <View style={styles.notificationDot} />
          </Pressable>
        </View>

        <GuideTarget targetKey="common.workspace-switcher" style={styles.workspaceSwitcher}>
          <WorkspaceSwitcher current={workspace} />
        </GuideTarget>

        <View style={styles.homeContent}>{children}</View>
      </View>
    </ScrollView>
  );
}

function CustomerLocation({ location }: { location?: PlatformRecord }) {
  const { palette } = useAppTheme();
  const title = location ? displayTitle(location) : "Choose a delivery location";
  const detail = location
    ? firstString(location, ["formatted_address", "formattedAddress", "address", "street_address", "streetAddress"])
    : "We will use this for pickup and return";

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push("/(customer)/locations")}
      style={styles.locationRow}
    >
      <View style={[styles.locationIcon, { backgroundColor: palette.brandSoft }]}>
        <MapPin color={colors.brand} size={19} />
      </View>
      <View style={styles.locationCopy}>
        <Text style={[styles.locationLabel, { color: palette.muted }]}>DELIVERING TO</Text>
        <Text numberOfLines={1} style={[styles.locationTitle, { color: palette.ink }]}>{title}</Text>
        {detail && detail !== title ? (
          <Text numberOfLines={1} style={[styles.locationDetail, { color: palette.muted }]}>{detail}</Text>
        ) : null}
      </View>
      <Text style={styles.changeText}>Change</Text>
    </Pressable>
  );
}

function CustomerPrimaryAction({ eyebrow, title, body, label, href, icon: Icon }: {
  eyebrow: string;
  title: string;
  body: string;
  label: string;
  href: string;
  icon: IconType;
}) {
  return (
    <Pressable onPress={() => router.push(href as never)} style={styles.customerAction}>
      <LinearGradient
        colors={["#F3283A", "#B40B1B"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.actionOrb} />
      <View style={styles.customerActionCopy}>
        <Text style={styles.customerActionEyebrow}>{eyebrow.toUpperCase()}</Text>
        <Text style={styles.customerActionTitle}>{title}</Text>
        <Text numberOfLines={2} style={styles.customerActionBody}>{body}</Text>
        <View style={styles.customerActionButton}>
          <Text style={styles.customerActionButtonText}>{label}</Text>
          <ChevronRight color={colors.brandDark} size={17} strokeWidth={2.8} />
        </View>
      </View>
      <View style={styles.customerActionIcon}>
        <Icon color="white" size={31} strokeWidth={1.7} />
      </View>
    </Pressable>
  );
}

function ActiveOrder({ record, href }: { record: PlatformRecord; href: string }) {
  const { palette } = useAppTheme();
  const status = displayStatus(record) ?? "active";
  const progress = orderProgress(status);
  const steps = ["Collected", "At station", "Returning", "Delivered"];

  return (
    <Pressable
      onPress={() => router.push(href as never)}
      style={[styles.activeOrder, { backgroundColor: palette.surface, borderColor: palette.border }]}
    >
      <View style={styles.activeOrderHead}>
        <View>
          <Text style={styles.liveEyebrow}>LIVE REFILL</Text>
          <Text style={[styles.activeOrderTitle, { color: palette.ink }]}>{humanStatus(status)}</Text>
        </View>
        <View style={[styles.trackButton, { backgroundColor: palette.successSoft }]}>
          <Navigation color={colors.success} size={17} />
          <Text style={styles.trackButtonText}>Track</Text>
        </View>
      </View>
      <View style={styles.progressRow}>
        {steps.map((step, index) => {
          const reached = index <= progress;
          return (
            <View key={step} style={styles.progressStep}>
              <View style={styles.progressTop}>
                {index > 0 ? <View style={[styles.progressLine, reached && styles.progressLineActive]} /> : <View style={styles.progressLineSpacer} />}
                <View style={[styles.progressDot, reached && styles.progressDotActive]} />
                {index < steps.length - 1 ? <View style={[styles.progressLine, index < progress && styles.progressLineActive]} /> : <View style={styles.progressLineSpacer} />}
              </View>
              <Text numberOfLines={1} style={[styles.progressLabel, { color: reached ? palette.ink : palette.muted }]}>{step}</Text>
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}

function DriverCockpit({ record }: { record?: PlatformRecord }) {
  const { palette } = useAppTheme();
  const id = record ? recordId(record) : null;
  if (!record || !id) {
    return (
      <View style={[styles.driverEmpty, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={[styles.driverEmptyIcon, { backgroundColor: palette.successSoft }]}>
          <Truck color={colors.success} size={27} />
        </View>
        <View style={styles.driverEmptyCopy}>
          <Text style={[styles.driverEmptyTitle, { color: palette.ink }]}>You are clear for now.</Text>
          <Text style={[styles.driverEmptyBody, { color: palette.muted }]}>Go online when you are ready for nearby delivery work.</Text>
        </View>
        <Pressable onPress={() => router.push("/(driver)/availability")} style={styles.goOnlineButton}>
          <Text style={styles.goOnlineText}>Go online</Text>
          <ChevronRight color="white" size={17} />
        </Pressable>
      </View>
    );
  }

  const status = displayStatus(record) ?? "active";
  const pickup = firstString(record, ["pickup_address", "pickupAddress", "customer_address", "customerAddress"])
    ?? "Customer pickup";
  const station = firstString(record, ["station_name", "stationName", "partner_name", "partnerName"])
    ?? "Refill station";
  const destination = firstString(record, ["delivery_address", "deliveryAddress", "dropoff_address", "dropoffAddress"])
    ?? "Customer return";
  const activeStop = driverRouteStep(status);

  return (
    <View style={styles.driverCockpit}>
      <LinearGradient
        colors={["#173D2D", "#0E1713"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.driverCockpitHead}>
        <View>
          <Text style={styles.driverLive}>CURRENT ROUTE</Text>
          <Text numberOfLines={1} style={styles.driverJobTitle}>{displayTitle(record)}</Text>
        </View>
        <View style={styles.driverStatusPill}>
          <View style={styles.driverLiveDot} />
          <Text numberOfLines={1} style={styles.driverStatusText}>{humanStatus(status)}</Text>
        </View>
      </View>

      <View style={styles.routeMap}>
        <RouteStop label="Pickup" value={pickup} active={activeStop === 0} complete={activeStop > 0} />
        <RouteStop label="Refill" value={station} active={activeStop === 1} complete={activeStop > 1} />
        <RouteStop label="Return" value={destination} active={activeStop === 2} complete={activeStop > 2} last />
      </View>

      <Pressable onPress={() => router.push(`/(driver)/job/${id}` as never)} style={styles.continueRoute}>
        <Navigation color="#173D2D" size={18} />
        <Text style={styles.continueRouteText}>Continue this job</Text>
        <ChevronRight color="#173D2D" size={18} />
      </Pressable>
    </View>
  );
}

function RouteStop({ label, value, active, complete, last = false }: {
  label: string;
  value: string;
  active: boolean;
  complete: boolean;
  last?: boolean;
}) {
  return (
    <View style={styles.routeStop}>
      <View style={styles.routeMarkerColumn}>
        <View style={[styles.routeMarker, (active || complete) && styles.routeMarkerActive]}>
          {complete ? <CircleCheck color="white" size={12} /> : <View style={[styles.routeMarkerCore, active && styles.routeMarkerCoreActive]} />}
        </View>
        {!last ? <View style={[styles.routeConnector, complete && styles.routeConnectorActive]} /> : null}
      </View>
      <View style={styles.routeCopy}>
        <Text style={styles.routeLabel}>{label.toUpperCase()}</Text>
        <Text numberOfLines={1} style={[styles.routeValue, active && styles.routeValueActive]}>{value}</Text>
      </View>
    </View>
  );
}

function OperationalAction({ icon: Icon, label, hint, href }: {
  icon: IconType;
  label: string;
  hint: string;
  href: string;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable onPress={() => router.push(href as never)} style={[styles.operationalAction, { borderColor: palette.border }]}>
      <View style={[styles.operationalIcon, { backgroundColor: palette.successSoft }]}>
        <Icon color={colors.success} size={19} />
      </View>
      <View style={styles.operationalCopy}>
        <Text style={[styles.operationalLabel, { color: palette.ink }]}>{label}</Text>
        <Text numberOfLines={1} style={[styles.operationalHint, { color: palette.muted }]}>{hint}</Text>
      </View>
      <ChevronRight color={palette.muted} size={17} />
    </Pressable>
  );
}

function MetricLink({ label, value, href }: { label: string; value: string; href: string }) {
  const { palette } = useAppTheme();
  return (
    <Pressable onPress={() => router.push(href as never)} style={styles.metricLink}>
      <Text style={[styles.metricLabel, { color: palette.muted }]}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.metricValue, { color: palette.ink }]}>{value}</Text>
    </Pressable>
  );
}

function StationAction({ primary = false, icon: Icon, step, title, body, href }: {
  primary?: boolean;
  icon: IconType;
  step: string;
  title: string;
  body: string;
  href: string;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      onPress={() => router.push(href as never)}
      style={[
        styles.stationAction,
        { backgroundColor: primary ? colors.brand : palette.surface, borderColor: primary ? colors.brand : palette.border },
      ]}
    >
      <View style={styles.stationActionTop}>
        <Text style={[styles.stationStep, { color: primary ? "rgba(255,255,255,.65)" : palette.muted }]}>{step}</Text>
        <View style={[styles.stationActionIcon, { backgroundColor: primary ? "rgba(255,255,255,.16)" : palette.brandSoft }]}>
          <Icon color={primary ? "white" : colors.brand} size={22} />
        </View>
      </View>
      <View style={styles.stationActionCopy}>
        <Text style={[styles.stationActionTitle, { color: primary ? "white" : palette.ink }]}>{title}</Text>
        <Text style={[styles.stationActionBody, { color: primary ? "rgba(255,255,255,.72)" : palette.muted }]}>{body}</Text>
      </View>
      <View style={[styles.stationActionArrow, { backgroundColor: primary ? "white" : palette.soft }]}>
        <ChevronRight color={primary ? colors.brand : palette.ink} size={17} />
      </View>
    </Pressable>
  );
}

function ReceptionMetric({ value, label }: { value: number; label: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.receptionMetric}>
      <Text style={[styles.receptionMetricValue, { color: palette.ink }]}>{value}</Text>
      <Text style={[styles.receptionMetricLabel, { color: palette.muted }]}>{label}</Text>
    </View>
  );
}

function ReceptionQueue({ records }: { records: PlatformRecord[] }) {
  const { palette } = useAppTheme();
  if (!records.length) {
    return (
      <View style={styles.queueEmpty}>
        <View style={[styles.queueEmptyIcon, { backgroundColor: palette.successSoft }]}>
          <ShieldCheck color={colors.success} size={23} />
        </View>
        <View style={styles.recordCopy}>
          <Text style={[styles.recordTitle, { color: palette.ink }]}>Reception is clear</Text>
          <Text style={[styles.recordMeta, { color: palette.muted }]}>New assigned arrivals will appear here.</Text>
        </View>
      </View>
    );
  }

  return (
    <View>
      {records.slice(0, 5).map((record, index) => {
        const id = recordId(record) ?? String(index);
        const status = humanStatus(displayStatus(record) ?? "pending");
        return (
          <Pressable
            key={id}
            onPress={() => router.push(`/(station)/job/${id}` as never)}
            style={[styles.queueRow, index > 0 && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }]}
          >
            <View style={[styles.queueSequence, { backgroundColor: palette.soft }]}>
              <Text style={[styles.queueSequenceText, { color: palette.ink }]}>{String(index + 1).padStart(2, "0")}</Text>
            </View>
            <View style={styles.recordCopy}>
              <Text numberOfLines={1} style={[styles.recordTitle, { color: palette.ink }]}>{displayTitle(record)}</Text>
              <Text numberOfLines={1} style={[styles.recordMeta, { color: palette.muted }]}>{displaySubtitle(record) ?? "Assigned refill"}</Text>
            </View>
            <View style={[styles.queueStatus, { backgroundColor: palette.warningSoft }]}>
              <Text numberOfLines={1} style={styles.queueStatusText}>{status}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function HomeSection({ title, action, href, children }: {
  title: string;
  action: string;
  href: string;
  children: ReactNode;
}) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, { color: palette.ink }]}>{title}</Text>
        <Pressable onPress={() => router.push(href as never)} style={styles.sectionAction}>
          <Text style={styles.sectionActionText}>{action}</Text>
          <ChevronRight color={colors.brand} size={15} />
        </Pressable>
      </View>
      {children}
    </View>
  );
}

function NaturalRecords({ records, empty, detailBase, icon: Icon, limit = 4 }: {
  records: PlatformRecord[];
  empty: string;
  detailBase: string;
  icon: IconType;
  limit?: number;
}) {
  const { palette } = useAppTheme();
  if (!records.length) {
    return (
      <View style={styles.naturalEmpty}>
        <View style={[styles.recordIcon, { backgroundColor: palette.soft }]}>
          <Icon color={colors.brand} size={19} />
        </View>
        <Text style={[styles.emptyText, { color: palette.muted }]}>{empty}</Text>
      </View>
    );
  }

  return (
    <View>
      {records.slice(0, limit).map((record, index) => {
        const id = recordId(record) ?? String(index);
        return (
          <Pressable
            key={id}
            onPress={() => router.push(`${detailBase}/${id}` as never)}
            style={[styles.recordRow, index > 0 && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }]}
          >
            <View style={[styles.recordIcon, { backgroundColor: palette.soft }]}>
              <Icon color={colors.brand} size={19} />
            </View>
            <View style={styles.recordCopy}>
              <Text numberOfLines={1} style={[styles.recordTitle, { color: palette.ink }]}>{displayTitle(record)}</Text>
              <Text numberOfLines={1} style={[styles.recordMeta, { color: palette.muted }]}>
                {humanStatus(displayStatus(record) ?? displaySubtitle(record) ?? "available")}
              </Text>
            </View>
            <ChevronRight color={palette.muted} size={18} />
          </Pressable>
        );
      })}
    </View>
  );
}

function CustomerCylinderRecords({ records, empty, limit = 2 }: {
  records: PlatformRecord[];
  empty: string;
  limit?: number;
}) {
  const { palette } = useAppTheme();
  if (!records.length) {
    return (
      <View style={styles.naturalEmpty}>
        <View style={[styles.recordIcon, { backgroundColor: palette.soft }]}>
          <PackageCheck color={colors.brand} size={19} />
        </View>
        <Text style={[styles.emptyText, { color: palette.muted }]}>{empty}</Text>
      </View>
    );
  }

  return (
    <View>
      {records.slice(0, limit).map((record, index) => (
        <CustomerCylinderRow
          cylinder={record}
          index={index}
          key={recordId(record) ?? String(index)}
        />
      ))}
    </View>
  );
}

function CustomerCylinderRow({ cylinder, index }: { cylinder: PlatformRecord; index: number }) {
  const { palette } = useAppTheme();
  const id = recordId(cylinder);
  const links = useEntityMediaLinks("lpg_cylinder", id);
  const presentation = (links.data ?? []).find((item) =>
    (firstString(item, ["media_role", "mediaRole"]) ?? "").includes("presentation"),
  );
  const presentationId = firstString(presentation, ["media_asset_id", "mediaAssetId"]);
  const originalId = firstAssetId(cylinder.image_asset_ids ?? cylinder.imageAssetIds);
  const status = displayStatus(cylinder) ?? "registered";

  return (
    <Pressable
      disabled={!id}
      onPress={() => router.push(`/(customer)/cylinder/${id}` as never)}
      style={[
        styles.recordRow,
        styles.cylinderRecordRow,
        index > 0 && { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <RuntimeMediaImage
        assetId={presentationId ?? originalId}
        label={`${displayTitle(cylinder)} cylinder`}
        variant="thumbnail"
      />
      <View style={styles.recordCopy}>
        <View style={styles.cylinderTitleRow}>
          <Text numberOfLines={1} style={[styles.recordTitle, { color: palette.ink }]}>
            {displayTitle(cylinder)}
          </Text>
          {presentationId ? (
            <View style={styles.enhancedBadge}>
              <Sparkles color="#6B35D3" size={10} />
              <Text style={styles.enhancedBadgeText}>AI</Text>
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={[styles.recordMeta, { color: palette.muted }]}>
          {firstNumber(cylinder, ["size_kg", "sizeKg"]) ?? "Configured"} kg · {friendlyCylinderStatus(status)}
        </Text>
      </View>
      <ChevronRight color={palette.muted} size={18} />
    </Pressable>
  );
}

function firstAssetId(value: unknown) {
  return Array.isArray(value)
    ? value.find((item): item is string => typeof item === "string") ?? null
    : null;
}

function friendlyCylinderStatus(value: string) {
  const normalized = value.toLowerCase().replace(/[-\s]+/g, "_");
  const labels: Record<string, string> = {
    active: "Ready",
    registered: "Ready",
    damaged: "Needs attention",
    unsafe: "Not safe",
    expired: "Inspection needed",
  };
  return labels[normalized] ?? humanStatus(value);
}

function UtilityLink({ icon: Icon, label, value, href }: {
  icon: IconType;
  label: string;
  value: string;
  href: string;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable onPress={() => router.push(href as never)} style={[styles.utilityLink, { borderColor: palette.border }]}>
      <View style={[styles.utilityIcon, { backgroundColor: palette.soft }]}>
        <Icon color={colors.brand} size={19} />
      </View>
      <View style={styles.recordCopy}>
        <Text style={[styles.utilityLabel, { color: palette.muted }]}>{label}</Text>
        <Text numberOfLines={1} style={[styles.utilityValue, { color: palette.ink }]}>{value}</Text>
      </View>
      <ChevronRight color={palette.muted} size={17} />
    </Pressable>
  );
}

function SupportLine({ href, label }: { href: string; label: string }) {
  const { palette } = useAppTheme();
  return (
    <Pressable onPress={() => router.push(href as never)} style={styles.support}>
      <CircleHelp color={palette.muted} size={18} />
      <Text style={[styles.supportText, { color: palette.muted }]}>Need help on the job?</Text>
      <Text style={styles.supportLink}>{label}</Text>
    </Pressable>
  );
}

function LoadError({ onRetry }: { onRetry(): void }) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.error, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <CircleHelp color={colors.brand} size={24} />
      <View style={styles.recordCopy}>
        <Text style={[styles.recordTitle, { color: palette.ink }]}>We could not refresh this screen</Text>
        <Text style={[styles.recordMeta, { color: palette.muted }]}>Your saved information is safe.</Text>
      </View>
      <Pressable onPress={onRetry}><Text style={styles.supportLink}>Try again</Text></Pressable>
    </View>
  );
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
}

function orderProgress(value: string) {
  const key = normalizedStatus(value);
  if (["delivered", "completed"].includes(key)) return 3;
  if (["return_en_route", "delivery_verification_pending"].includes(key)) return 2;
  if (["station_en_route", "station_verified", "refill_in_progress", "refill_confirmed"].includes(key)) return 1;
  if (["pickup_verified"].includes(key)) return 0;
  return -1;
}

function driverRouteStep(value: string) {
  const key = normalizedStatus(value);
  if (["delivered", "completed"].includes(key)) return 3;
  if (["return_en_route", "delivery_verification_pending"].includes(key)) return 2;
  if (["station_en_route", "station_verified", "refill_in_progress", "refill_confirmed"].includes(key)) return 1;
  return 0;
}

function isWaitingAtStation(value?: string | null) {
  return ["driver_accepted", "pickup_en_route", "pickup_verified", "station_en_route"].includes(normalizedStatus(value ?? ""));
}

function isStationProcessing(value?: string | null) {
  return ["station_verified", "refill_in_progress", "refill_confirmed"].includes(normalizedStatus(value ?? ""));
}

function normalizedStatus(value: string) {
  return value.toLowerCase().replace(/[\s-]+/g, "_");
}

function humanStatus(value: string) {
  const key = normalizedStatus(value);
  const labels: Record<string, string> = {
    active: "Ready",
    available: "Ready",
    pending: "In progress",
    awaiting_payment: "Awaiting payment",
    payment_reserved: "Payment confirmed",
    matching_station: "Finding a station",
    matching_driver: "Finding a driver",
    driver_offered: "Driver notified",
    driver_accepted: "Driver assigned",
    pickup_en_route: "Heading to pickup",
    pickup_verified: "Cylinder collected",
    station_en_route: "Heading to station",
    station_verified: "At the refill station",
    refill_in_progress: "Refill underway",
    refill_confirmed: "Refill complete",
    return_en_route: "Returning to you",
    delivery_verification_pending: "Ready for handover",
    delivered: "Delivered",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return labels[key] ?? key.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase());
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, paddingBottom: 112 },
  mobileFrame: { width: "100%", alignSelf: "center", paddingHorizontal: 18 },
  appHeader: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  identity: { flex: 1, flexDirection: "row", alignItems: "center", gap: 11 },
  identityCopy: { flex: 1, gap: 2 },
  context: { fontSize: 8, fontWeight: "900", letterSpacing: 1.25 },
  greeting: { fontSize: 18, lineHeight: 22, fontWeight: "900", letterSpacing: -0.35 },
  notification: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 21, borderWidth: StyleSheet.hairlineWidth },
  notificationDot: { position: "absolute", top: 9, right: 9, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brand },
  workspaceSwitcher: { minHeight: 8, marginTop: 9 },
  homeContent: { gap: 22, paddingTop: 18 },

  locationRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 11 },
  locationIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  locationCopy: { flex: 1, gap: 1 },
  locationLabel: { fontSize: 8, fontWeight: "900", letterSpacing: 1.1 },
  locationTitle: { fontSize: 14, lineHeight: 18, fontWeight: "900" },
  locationDetail: { fontSize: 10, lineHeight: 14 },
  changeText: { color: colors.brand, fontSize: 11, fontWeight: "900" },

  customerAction: { minHeight: 184, overflow: "hidden", flexDirection: "row", alignItems: "center", padding: 19, borderRadius: 28 },
  actionOrb: { position: "absolute", width: 190, height: 190, right: -78, top: -82, borderRadius: 95, backgroundColor: "rgba(255,255,255,.09)" },
  customerActionCopy: { flex: 1, alignItems: "flex-start", gap: 5, zIndex: 1 },
  customerActionEyebrow: { color: "rgba(255,255,255,.68)", fontSize: 8, fontWeight: "900", letterSpacing: 1.1 },
  customerActionTitle: { color: "white", fontSize: 25, lineHeight: 29, fontWeight: "900", letterSpacing: -0.65 },
  customerActionBody: { maxWidth: 310, color: "rgba(255,255,255,.76)", fontSize: 12, lineHeight: 17 },
  customerActionButton: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, paddingHorizontal: 13, borderRadius: 13, backgroundColor: "white" },
  customerActionButtonText: { color: colors.brandDark, fontSize: 12, fontWeight: "900" },
  customerActionIcon: { width: 64, height: 64, alignItems: "center", justifyContent: "center", marginLeft: 8, borderRadius: 32, backgroundColor: "rgba(255,255,255,.14)" },

  activeOrder: { minHeight: 132, gap: 17, padding: 16, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth },
  activeOrderHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  liveEyebrow: { color: colors.success, fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  activeOrderTitle: { fontSize: 18, lineHeight: 23, fontWeight: "900", marginTop: 3 },
  trackButton: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, borderRadius: 12 },
  trackButtonText: { color: colors.success, fontSize: 11, fontWeight: "900" },
  progressRow: { flexDirection: "row", alignItems: "flex-start" },
  progressStep: { flex: 1, alignItems: "center", gap: 6 },
  progressTop: { width: "100%", flexDirection: "row", alignItems: "center" },
  progressLine: { flex: 1, height: 2, backgroundColor: "#DDE5DF" },
  progressLineActive: { backgroundColor: colors.success },
  progressLineSpacer: { flex: 1, height: 2, backgroundColor: "transparent" },
  progressDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#DDE5DF" },
  progressDotActive: { backgroundColor: colors.success },
  progressLabel: { maxWidth: 70, fontSize: 8, fontWeight: "800", textAlign: "center" },

  section: { gap: 9 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 19, lineHeight: 24, fontWeight: "900", letterSpacing: -0.35 },
  sectionAction: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 32 },
  sectionActionText: { color: colors.brand, fontSize: 11, fontWeight: "900" },
  naturalEmpty: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 11 },
  emptyText: { flex: 1, fontSize: 12, lineHeight: 17 },
  recordRow: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 11 },
  cylinderRecordRow: { minHeight: 72 },
  recordIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 13 },
  recordCopy: { flex: 1, gap: 3 },
  cylinderTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  enhancedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "#F0E9FF",
  },
  enhancedBadgeText: { color: "#5A2AB5", fontSize: 9, fontWeight: "900" },
  recordTitle: { fontSize: 13, lineHeight: 17, fontWeight: "900" },
  recordMeta: { fontSize: 11, lineHeight: 15 },
  customerUtilities: { gap: 0 },
  utilityLink: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 11, borderTopWidth: StyleSheet.hairlineWidth },
  utilityIcon: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 13 },
  utilityLabel: { fontSize: 9, fontWeight: "800" },
  utilityValue: { fontSize: 13, fontWeight: "900", marginTop: 1 },

  driverCockpit: { minHeight: 344, overflow: "hidden", gap: 19, padding: 18, borderRadius: 28 },
  driverCockpitHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  driverLive: { color: "rgba(255,255,255,.55)", fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  driverJobTitle: { maxWidth: 235, color: "white", fontSize: 20, lineHeight: 25, fontWeight: "900", marginTop: 4 },
  driverStatusPill: { maxWidth: 138, minHeight: 30, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, borderRadius: 15, backgroundColor: "rgba(255,255,255,.10)" },
  driverLiveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#5BE28D" },
  driverStatusText: { flexShrink: 1, color: "white", fontSize: 9, fontWeight: "900" },
  routeMap: { flex: 1, paddingHorizontal: 2 },
  routeStop: { minHeight: 62, flexDirection: "row", gap: 12 },
  routeMarkerColumn: { width: 20, alignItems: "center" },
  routeMarker: { width: 18, height: 18, alignItems: "center", justifyContent: "center", borderRadius: 9, borderWidth: 1, borderColor: "rgba(255,255,255,.26)" },
  routeMarkerActive: { borderColor: "#5BE28D", backgroundColor: "#2A8E51" },
  routeMarkerCore: { width: 5, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,.32)" },
  routeMarkerCoreActive: { backgroundColor: "white" },
  routeConnector: { flex: 1, width: 1, backgroundColor: "rgba(255,255,255,.20)" },
  routeConnectorActive: { backgroundColor: "#2A8E51" },
  routeCopy: { flex: 1, gap: 2, paddingBottom: 15 },
  routeLabel: { color: "rgba(255,255,255,.46)", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  routeValue: { color: "rgba(255,255,255,.66)", fontSize: 13, fontWeight: "800" },
  routeValueActive: { color: "white" },
  continueRoute: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderRadius: 14, backgroundColor: "white" },
  continueRouteText: { flex: 1, color: "#173D2D", fontSize: 12, fontWeight: "900" },
  driverEmpty: { minHeight: 224, alignItems: "flex-start", gap: 13, padding: 19, borderRadius: 26, borderWidth: StyleSheet.hairlineWidth },
  driverEmptyIcon: { width: 50, height: 50, alignItems: "center", justifyContent: "center", borderRadius: 18 },
  driverEmptyCopy: { gap: 5 },
  driverEmptyTitle: { fontSize: 22, lineHeight: 27, fontWeight: "900", letterSpacing: -0.45 },
  driverEmptyBody: { maxWidth: 340, fontSize: 12, lineHeight: 18 },
  goOnlineButton: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.success },
  goOnlineText: { color: "white", fontSize: 12, fontWeight: "900" },
  driverActions: { gap: 0 },
  operationalAction: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  operationalIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  operationalCopy: { flex: 1, gap: 2 },
  operationalLabel: { fontSize: 13, fontWeight: "900" },
  operationalHint: { fontSize: 10 },
  driverMetrics: { minHeight: 70, flexDirection: "row", alignItems: "stretch" },
  metricLink: { flex: 1, justifyContent: "center", gap: 3 },
  metricDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  metricLabel: { fontSize: 9, fontWeight: "800" },
  metricValue: { fontSize: 17, fontWeight: "900" },

  receptionHeading: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 },
  receptionEyebrow: { color: colors.brand, fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  receptionTitle: { maxWidth: 280, fontSize: 23, lineHeight: 28, fontWeight: "900", letterSpacing: -0.55, marginTop: 5 },
  queueCount: { alignItems: "flex-end" },
  queueNumber: { color: colors.brand, fontSize: 27, lineHeight: 29, fontWeight: "900" },
  queueLabel: { fontSize: 9, fontWeight: "800" },
  stationActions: { flexDirection: "row", alignItems: "stretch", gap: 10 },
  stationAction: { flex: 1, minHeight: 210, justifyContent: "space-between", padding: 14, borderRadius: 23, borderWidth: StyleSheet.hairlineWidth },
  stationActionTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stationStep: { fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  stationActionIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  stationActionCopy: { gap: 5 },
  stationActionTitle: { fontSize: 17, lineHeight: 21, fontWeight: "900", letterSpacing: -0.3 },
  stationActionBody: { fontSize: 10, lineHeight: 15 },
  stationActionArrow: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  receptionStatus: { minHeight: 62, flexDirection: "row", alignItems: "center" },
  receptionMetric: { flex: 1, gap: 2 },
  receptionMetricValue: { fontSize: 19, fontWeight: "900" },
  receptionMetricLabel: { fontSize: 9, fontWeight: "800" },
  queueEmpty: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 11 },
  queueEmptyIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  queueRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 11 },
  queueSequence: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  queueSequenceText: { fontSize: 11, fontWeight: "900" },
  queueStatus: { maxWidth: 112, minHeight: 27, justifyContent: "center", paddingHorizontal: 8, borderRadius: 10 },
  queueStatusText: { color: "#9A6412", fontSize: 8, fontWeight: "900" },

  support: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 8 },
  supportText: { flex: 1, fontSize: 11 },
  supportLink: { color: colors.brand, fontSize: 11, fontWeight: "900" },
  error: { minHeight: 82, flexDirection: "row", alignItems: "center", gap: 11, padding: 14, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
});
