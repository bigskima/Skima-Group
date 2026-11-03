import { createClientIdempotencyKey } from "@skima/frontend-core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDownUp, Building2, CheckCircle2, MapPin, Plus, ShieldCheck, Truck, WalletCards, XCircle } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { asNumber, asString, useLogisticsQuery } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { AppField } from "../ui/AppField";
import { Card } from "../ui/Card";
import { GeographyPicker } from "../ui/GeographyPicker";
import { LogisticsMediaPicker } from "../ui/LogisticsMediaPicker";
import { LogisticsCompanyApplicationPanel } from "../ui/LogisticsCompanyApplicationPanel";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { SectionHeader } from "../ui/SectionHeader";
import { StatePanel } from "../ui/StatePanel";
import { StatusPill } from "../ui/StatusPill";

function serviceSlug(category: string, name: string) {
  const suffix = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 48) || "standard";
  return `${category}.${suffix}`.slice(0, 120);
}
type Place = Record<string, unknown>;

export function ProviderCompanyScreen() {
  const { palette } = useAppTheme();
  const { api } = useSession();
  const client = useQueryClient();
  const companies = useLogisticsQuery(["company"], "/runtime/logistics/company", true, 45_000);
  const categoriesQuery = useLogisticsQuery(["categories"], "/runtime/logistics/categories");
  const company = companies.data?.[0] ?? null;
  const organizationId = asString(company, "organization_id");
  const services = useLogisticsQuery(
    ["provider-services", organizationId ?? "none"],
    `/runtime/logistics/company/services?organizationId=${encodeURIComponent(organizationId ?? "")}`,
    Boolean(organizationId),
  );
  const coverage = useLogisticsQuery(
    ["provider-coverage", organizationId ?? "none"],
    `/runtime/logistics/company/coverage?organizationId=${encodeURIComponent(organizationId ?? "")}`,
    Boolean(organizationId),
  );

  const [companyRegistrationKey] = useState(() => createClientIdempotencyKey("logistics.company.register"));
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [showCoverageForm, setShowCoverageForm] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [serviceCategory, setServiceCategory] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [serviceWeight, setServiceWeight] = useState("");
  const [coverageServiceKey, setCoverageServiceKey] = useState("");
  const [coverageSearch, setCoverageSearch] = useState("");
  const [coveragePlace, setCoveragePlace] = useState<Place | null>(null);
  const [coverageMode, setCoverageMode] = useState<"both" | "route">("both");
  const [destinationSearch, setDestinationSearch] = useState("");
  const [destinationPlace, setDestinationPlace] = useState<Place | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeCategories = (categoriesQuery.data ?? []).filter((item) => asString(item, "status") === "active");
  const organization = nested(company, "organization");
  const availableServices = services.data ?? [];
  const serviceKey = useMemo(() => serviceCategory && serviceName ? serviceSlug(serviceCategory, serviceName) : "", [serviceCategory, serviceName]);
  const refresh = () => Promise.all([companies.refetch(), categoriesQuery.refetch(), services.refetch(), coverage.refetch()]);

  const registerCompany = useMutation({
    mutationFn: () => api.post("/runtime/logistics/company", {
      displayName: companyName.trim(),
      legalName: legalName.trim() || null,
      idempotencyKey: companyRegistrationKey,
      metadata: { registration_source: "skima.logistics.mobile" },
    }, z.string().uuid()),
    onSuccess: async () => {
      setCompanyName(""); setLegalName("");
      await client.invalidateQueries({ queryKey: ["skima-logistics", "company"] });
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Company registration could not be completed."),
  });

  const addService = useMutation({
    mutationFn: () => {
      if (!organizationId) throw new Error("Register your company first.");
      if (!serviceCategory || !serviceName.trim()) throw new Error("Choose a service category and enter a service name.");
      const maxWeight = serviceWeight.trim() ? Number(serviceWeight) : null;
      if (maxWeight !== null && (!Number.isFinite(maxWeight) || maxWeight <= 0)) throw new Error("Maximum weight must be a positive number.");
      return api.post("/runtime/logistics/company/services", {
        organizationId,
        categoryKey: serviceCategory,
        serviceKey: serviceKey,
        displayName: serviceName.trim(),
        description: serviceDescription.trim() || null,
        pricingMode: "quote_required",
        capabilityKeys: [],
        cargoTypeKeys: [],
        vehicleTypeKeys: [],
        maximumWeightKg: maxWeight,
        maximumVolumeM3: null,
        availabilityEnabled: true,
        idempotencyKey: createClientIdempotencyKey("logistics.provider.service", serviceKey),
        metadata: { source: "skima.logistics.provider.workspace" },
      }, z.string().uuid());
    },
    onSuccess: async () => {
      setServiceName(""); setServiceDescription(""); setServiceWeight("");
      setShowServiceForm(false);
      await Promise.all([services.refetch(), coverage.refetch()]);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Service could not be saved."),
  });

  const addCoverage = useMutation({
    mutationFn: () => {
      if (!organizationId || !coverageServiceKey || !coveragePlace) throw new Error("Choose a service and an origin coverage location.");
      const geographyId = asString(coveragePlace, "id");
      const destinationGeographyId = coverageMode === "route" ? asString(destinationPlace, "id") : null;
      if (!geographyId) throw new Error("The selected origin location is missing its identifier.");
      if (coverageMode === "route" && !destinationGeographyId) throw new Error("Choose a destination for this route coverage.");
      return api.post("/runtime/logistics/company/coverage", {
        organizationId,
        serviceKey: coverageServiceKey,
        coverageMode: coverageMode === "route" ? "route" : "both",
        geographyId,
        destinationGeographyId: coverageMode === "route" ? asString(destinationPlace, "id") : null,
        idempotencyKey: createClientIdempotencyKey("logistics.provider.coverage", `${coverageServiceKey}:${coverageMode}:${geographyId}:${destinationGeographyId ?? "all"}`),
        metadata: { source: "skima.logistics.provider.workspace" },
      }, z.string().uuid());
    },
    onSuccess: async () => {
      setCoverageSearch(""); setCoveragePlace(null); setDestinationSearch(""); setDestinationPlace(null);
      setShowCoverageForm(false);
      await coverage.refetch();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Coverage could not be saved."),
  });

  return (
    <Screen eyebrow="COMPANY PROFILE" title="Company & services" subtitle="Register your provider organisation, describe your services and set the locations you can serve."
      refreshControl={<RefreshControl refreshing={companies.isRefetching || categoriesQuery.isRefetching || services.isRefetching || coverage.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}>
      {companies.isPending || categoriesQuery.isPending ? <ScreenSkeleton cards={3} /> : companies.error || categoriesQuery.error ? (
        <StatePanel title="Company setup could not load" description="Refresh to reconnect to the Logistics provider service." retry={() => void refresh()} />
      ) : (
        <View style={styles.content}>
          {!company ? (
            <Card padding="lg">
              <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><Building2 color={palette.brand} size={22} /></View>
              <Text style={[styles.sectionTitle, { color: palette.ink }]}>Register your company</Text>
              <Text style={[styles.sectionBody, { color: palette.muted }]}>Create your separate logistics provider organisation. It will start in pending verification until SKIMA reviews it.</Text>
              <AppField label="Company display name" value={companyName} onChangeText={setCompanyName} placeholder="e.g. Eastern Star Logistics" />
              <AppField label="Legal name" value={legalName} onChangeText={setLegalName} placeholder="Registered legal name" optional />
              <AppButton label="Register company" fullWidth loading={registerCompany.isPending} disabled={companyName.trim().length < 2} onPress={() => { setError(null); registerCompany.mutate(); }} />
            </Card>
          ) : (
            <>
              <Card variant="brandSoft" padding="lg">
                <View style={styles.companyRow}>
                  <View style={[styles.companyIcon, { backgroundColor: palette.surface }]}><Building2 color={palette.brand} size={21} /></View>
                  <View style={styles.companyCopy}>
                    <Text style={[styles.companyEyebrow, { color: palette.brand }]}>REGISTERED ORGANISATION</Text>
                    <Text style={[styles.companyName, { color: palette.ink }]}>{asString(company, "public_name") ?? "Logistics provider"}</Text>
                    <Text style={[styles.companyMeta, { color: palette.muted }]}>{asString(organization, "legal_name") ?? "Legal name not supplied"}</Text>
                  </View>
                  <StatusPill status={asString(company, "verification_status") ?? "pending"} />
                </View>
                <View style={[styles.notice, { backgroundColor: palette.warningSoft }]}>
                  <ShieldCheck color={palette.warning} size={15} />
                  <Text style={[styles.noticeText, { color: palette.ink }]}>SKIMA verification controls when your services become visible to customers and eligible for matching.</Text>
                </View>
              </Card>

              <View style={styles.section}>
                <SectionHeader title="Public company identity" description="These verified business images help customers recognise the company they are booking." />
                <LogisticsMediaPicker
                  entityType="logistics_company"
                  entityId={organizationId ?? ""}
                  organizationId={organizationId}
                  mediaRole="logistics.company.logo.public"
                  title="Company logo"
                  description="A clear square logo used across company cards and booking summaries."
                  compact
                />
                <LogisticsMediaPicker
                  entityType="logistics_company"
                  entityId={organizationId ?? ""}
                  organizationId={organizationId}
                  mediaRole="logistics.company.photo.public"
                  title="Company public photo"
                  description="Show customers your fleet, depot, team or business premises."
                  compact
                />
              </View>

              <LogisticsCompanyApplicationPanel
                organizationId={organizationId ?? ""}
                displayName={asString(company, "public_name") ?? ""}
                legalName={asString(organization, "legal_name")}
              />

              <ProviderWalletFundingPanel organizationId={organizationId ?? ""} />

              <View style={styles.section}>
                <SectionHeader title="Your services" description="Choose service categories you can fulfil and state your capacity." />
                {services.isPending ? <ScreenSkeleton cards={1} /> : services.error ? <StatePanel title="Services unavailable" description="Your service list could not be loaded." retry={() => void services.refetch()} /> : availableServices.length ? (
                  <View style={styles.serviceList}>
                    {availableServices.map((service) => (
                      <View key={String(service.id)} style={[styles.serviceCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                        <View style={[styles.smallIcon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={17} /></View>
                        <View style={styles.serviceCopy}>
                          <Text style={[styles.serviceTitle, { color: palette.ink }]}>{asString(service, "display_name") ?? "Logistics service"}</Text>
                          <Text style={[styles.serviceMeta, { color: palette.muted }]}>{asString(service, "service_key")?.replace(/[._]/g, " ") ?? ""} · {asString(service, "pricing_mode")?.replace(/_/g, " ") ?? "Quote required"}</Text>
                        </View>
                        <StatusPill status={asString(service, "status") ?? "draft"} />
                      </View>
                    ))}
                  </View>
                ) : <StatePanel title="No services configured" description="Add at least one service to tell SKIMA what your company can handle." />}
                {showServiceForm ? (
                <Card padding="lg">
                  <View style={styles.sectionLead}><Plus color={palette.brand} size={18} /><Text style={[styles.formTitle, { color: palette.ink }]}>Add a service</Text></View>
                  <AppField label="Service name" value={serviceName} onChangeText={setServiceName} placeholder="e.g. Furniture and home delivery" />
                  <Text style={[styles.fieldLabel, { color: palette.ink }]}>Service category</Text>
                  <View style={styles.choiceGrid}>
                    {activeCategories.map((category) => {
                      const key = asString(category, "key") ?? "";
                      const active = key === serviceCategory;
                      return <TextButton key={key} label={asString(category, "display_name") ?? key} active={active} onPress={() => setServiceCategory(key)} />;
                    })}
                  </View>
                  <AppField label="Service description" value={serviceDescription} onChangeText={setServiceDescription} placeholder="What is included in this service?" optional multiline />
                  <AppField label="Maximum cargo weight (kg)" value={serviceWeight} onChangeText={setServiceWeight} keyboardType="decimal-pad" placeholder="Leave blank if not limited" optional />
                  <View style={styles.quoteHint}><ShieldCheck color={palette.success} size={14} /><Text style={[styles.quoteHintText, { color: palette.muted }]}>Offers are quoted per customer request. No lead unlock fee is charged.</Text></View>
                  <View style={styles.actions}>
                    <AppButton label="Cancel" variant="secondary" onPress={() => setShowServiceForm(false)} />
                    <AppButton label="Save service" fullWidth loading={addService.isPending} disabled={!serviceCategory || serviceName.trim().length < 2} onPress={() => { setError(null); addService.mutate(); }} />
                  </View>
                </Card>
                ) : (
                  <AppButton label="Add a service" fullWidth variant="secondary" icon={<Plus color={palette.brand} size={15} />} onPress={() => setShowServiceForm(true)} />
                )}
              </View>

              <View style={styles.section}>
                <SectionHeader title="Operating coverage" description="Set the locations where your company can pick up and deliver." />
                {coverage.isPending ? <ScreenSkeleton cards={1} /> : coverage.error ? <StatePanel title="Coverage unavailable" description="Your service coverage could not be loaded." retry={() => void coverage.refetch()} /> : coverage.data?.length ? (
                  <View style={styles.coverageList}>
                    {coverage.data.map((item) => (
                      <View key={String(item.id)} style={[styles.coverageCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                        <View style={[styles.smallIcon, { backgroundColor: palette.successSoft }]}><MapPin color={palette.success} size={17} /></View>
                        <View style={styles.serviceCopy}>
                          <Text style={[styles.serviceTitle, { color: palette.ink }]}>{asString(nested(item, "service"), "display_name") ?? "Service coverage"}</Text>
                          <Text style={[styles.serviceMeta, { color: palette.muted }]}>{asString(item, "coverage_mode") === "route"
                            ? `${asString(nested(item, "geography"), "canonical_name") ?? "Origin"} → ${asString(nested(item, "destination"), "canonical_name") ?? "Destination"}`
                            : `${asString(nested(item, "geography"), "canonical_name") ?? "Selected area"} · pickup & delivery`}</Text>
                        </View>
                        <StatusPill status={asString(item, "status") ?? "active"} />
                      </View>
                    ))}
                  </View>
                ) : <StatePanel title="No coverage configured" description="Add your service area so SKIMA can match you with relevant customer requests." />}
                {availableServices.length ? (
                  showCoverageForm ? (
                  <Card padding="lg">
                    <View style={styles.sectionLead}><MapPin color={palette.brand} size={18} /><Text style={[styles.formTitle, { color: palette.ink }]}>Add operating area</Text></View>
                    <Text style={[styles.fieldLabel, { color: palette.ink }]}>Service</Text>
                    <View style={styles.choiceGrid}>
                      {availableServices.map((service) => {
                        const key = asString(service, "service_key") ?? "";
                        const active = key === coverageServiceKey;
                        return <TextButton key={key} label={asString(service, "display_name") ?? key} active={active} onPress={() => setCoverageServiceKey(key)} />;
                      })}
                    </View>
                    <View style={styles.choiceGrid}>
                      <AppButton size="sm" variant={coverageMode === "both" ? "primary" : "secondary"} label="Pickup & delivery area" onPress={() => { setCoverageMode("both"); setDestinationPlace(null); }} />
                      <AppButton size="sm" variant={coverageMode === "route" ? "primary" : "secondary"} label="Specific route" onPress={() => setCoverageMode("route")} />
                    </View>
                    <GeographyPicker mode="service_area" label={coverageMode === "route" ? "Route origin" : "Operating location"} value={coverageSearch} selected={coveragePlace} onChange={(value) => { setCoverageSearch(value); setCoveragePlace(null); }} onSelect={(place) => { setCoveragePlace(place); setCoverageSearch(asString(place, "canonical_name") ?? ""); }} />
                    {coverageMode === "route" ? <GeographyPicker mode="service_area" label="Route destination" value={destinationSearch} selected={destinationPlace} onChange={(value) => { setDestinationSearch(value); setDestinationPlace(null); }} onSelect={(place) => { setDestinationPlace(place); setDestinationSearch(asString(place, "canonical_name") ?? ""); }} /> : null}
                    <Text style={[styles.coverageHint, { color: palette.muted }]}>{coverageMode === "route" ? "Only matching requests on this origin-to-destination corridor will be routed to the service." : "This setting covers both pickup and delivery within the selected geographic area."}</Text>
                    <View style={styles.actions}>
                      <AppButton label="Cancel" variant="secondary" onPress={() => setShowCoverageForm(false)} />
                      <AppButton label="Save operating coverage" fullWidth loading={addCoverage.isPending} disabled={!coverageServiceKey || !coveragePlace || (coverageMode === "route" && !destinationPlace)} onPress={() => { setError(null); addCoverage.mutate(); }} />
                    </View>
                  </Card>
                  ) : (
                    <AppButton label="Add operating area" fullWidth variant="secondary" icon={<Plus color={palette.brand} size={15} />} onPress={() => setShowCoverageForm(true)} />
                  )
                ) : null}
              </View>
            </>
          )}
          {error ? <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}><XCircle color={palette.danger} size={15} /><Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text></View> : null}
        </View>
      )}
    </Screen>
  );
}

function ProviderWalletFundingPanel({ organizationId }: { organizationId: string }) {
  const { palette } = useAppTheme();
  const { api, session } = useSession();
  const queryClient = useQueryClient();
  const wallets = useLogisticsQuery(["wallets"], "/runtime/wallets", Boolean(organizationId), 30_000);
  const balances = useLogisticsQuery(["wallet-balances"], "/runtime/wallet-balances", Boolean(organizationId), 30_000);
  const currencies = useLogisticsQuery(["currencies"], "/engines/currencies", Boolean(organizationId), 60_000);
  const personalWallets = useMemo(() => (wallets.data ?? []).filter((wallet) =>
    asString(wallet, "wallet_type") === "customer" &&
    asString(wallet, "owner_entity_type") === "user" &&
    asString(wallet, "owner_entity_id") === session?.user.id &&
    asString(wallet, "status") === "active"
  ), [wallets.data, session?.user.id]);
  const providerWallets = useMemo(() => (wallets.data ?? []).filter((wallet) =>
    asString(wallet, "wallet_type") === "partner" &&
    asString(wallet, "owner_entity_type") === "organization" &&
    asString(wallet, "owner_entity_id") === organizationId &&
    asString(wallet, "status") === "active"
  ), [wallets.data, organizationId]);
  const [sourceWalletId, setSourceWalletId] = useState("");
  const [amount, setAmount] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [fundError, setFundError] = useState<string | null>(null);
  const selectedWallet = personalWallets.find((wallet) => asString(wallet, "id") === sourceWalletId)
    ?? personalWallets.find((wallet) => asString(wallet, "currency_code") === "NGN")
    ?? personalWallets[0]
    ?? null;
  const currency = asString(selectedWallet, "currency_code") ?? "NGN";
  const providerWallet = providerWallets.find((wallet) => asString(wallet, "currency_code") === currency) ?? null;
  const readBalance = (walletId: string | null) => {
    if (!walletId) return 0;
    const row = (balances.data ?? []).find((item) => asString(item, "wallet_id") === walletId);
    return asNumber(row, "balance") ?? 0;
  };
  const sourceBalance = readBalance(asString(selectedWallet, "id"));
  const providerBalance = readBalance(asString(providerWallet, "id"));
  const currencyDecimals = (code: string) => asNumber(
    (currencies.data ?? []).find((item) => asString(item, "code") === code),
    "decimal_places",
  ) ?? 2;
  const requestedAmount = Number(amount);
  const decimals = currencyDecimals(currency);
  const amountPrecisionValid = amount.trim().length > 0
    && !/[eE]/.test(amount.trim())
    && (amount.trim().split(".")[1]?.length ?? 0) <= decimals;
  const enoughBalance = amountPrecisionValid
    && Number.isFinite(requestedAmount)
    && requestedAmount > 0
    && sourceBalance >= requestedAmount;

  const funding = useMutation({
    mutationFn: async (payload: { walletId: string; amount: number; key: string }) => api.post(
      "/runtime/logistics/company/wallet/fund",
      {
        organizationId,
        customerWalletId: payload.walletId,
        amount: payload.amount,
        idempotencyKey: payload.key,
      },
      z.record(z.string(), z.unknown()),
    ),
    onSuccess: async () => {
      setAmount("");
      setIdempotencyKey(null);
      setFundError(null);
      await Promise.all([
        wallets.refetch(),
        balances.refetch(),
        currencies.refetch(),
        queryClient.invalidateQueries({ queryKey: ["skima-logistics", "wallets"] }),
        queryClient.invalidateQueries({ queryKey: ["skima-logistics", "wallet-balances"] }),
      ]);
    },
    onError: (cause) => setFundError(cause instanceof Error ? cause.message : "The company wallet could not be funded."),
  });

  return (
    <Card padding="lg">
      <View style={fundingStyles.heading}>
        <View style={[fundingStyles.headingIcon, { backgroundColor: palette.brandSoft }]}><WalletCards color={palette.brand} size={20} /></View>
        <View style={fundingStyles.headingCopy}>
          <Text style={[fundingStyles.title, { color: palette.ink }]}>Company wallet</Text>
          <Text style={[fundingStyles.description, { color: palette.muted }]}>Funds your organisation’s offline provider receival fees.</Text>
        </View>
      </View>
      <View style={[fundingStyles.balancePanel, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <Text style={[fundingStyles.balanceLabel, { color: palette.muted }]}>Company balance · {currency}</Text>
        <Text style={[fundingStyles.balanceValue, { color: palette.ink }]}>{formatCurrency(providerBalance, currency, currencyDecimals(currency))}</Text>
        <Text style={[fundingStyles.balanceHint, { color: palette.muted }]}>Online bookings do not debit this wallet for commission. That is deducted from escrow at settlement.</Text>
      </View>
      <View style={fundingStyles.form}>
        <Text style={[fundingStyles.label, { color: palette.ink }]}>Fund from your personal customer wallet</Text>
        {wallets.isPending || balances.isPending || currencies.isPending ? (
          <ScreenSkeleton cards={1} />
        ) : personalWallets.length === 0 ? (
          <StatePanel title="Personal wallet required" description="Create or top up your own customer wallet in SKIMA first. You can then move funds into the company wallet." retry={() => void Promise.all([wallets.refetch(), balances.refetch()])} />
        ) : (
          <>
            <View style={fundingStyles.walletChoices}>
              {personalWallets.map((wallet) => {
                const id = asString(wallet, "id") ?? "";
                const code = asString(wallet, "currency_code") ?? "";
                const selected = asString(selectedWallet, "id") === id;
                const walletBalance = readBalance(id);
                return (
                  <Pressable key={id} accessibilityRole="button" onPress={() => { setSourceWalletId(id); setIdempotencyKey(null); }}
                    style={[fundingStyles.walletChoice, { backgroundColor: selected ? palette.brandSofter : palette.surface, borderColor: selected ? palette.brand : palette.border }]}>
                    <Text style={[fundingStyles.walletCode, { color: selected ? palette.brand : palette.ink }]}>{code}</Text>
                    <Text style={[fundingStyles.walletAvailable, { color: palette.muted }]}>{formatCurrency(walletBalance, code, currencyDecimals(code))}</Text>
                  </Pressable>
                );
              })}
            </View>
            <AppField
              label={`Transfer amount (${currency})`}
              value={amount}
              onChangeText={(value) => { setAmount(value); setIdempotencyKey(null); }}
              keyboardType="decimal-pad"
              placeholder="Enter amount to move"
              hint={`An internal transfer: your personal wallet is debited and the company wallet is credited. Maximum ${decimals} decimal places.`}
            />
            <AppButton
              label="Move funds to company wallet"
              fullWidth
              loading={funding.isPending}
              disabled={!selectedWallet || !enoughBalance}
              onPress={() => {
                if (!selectedWallet) return;
                const key = idempotencyKey ?? createClientIdempotencyKey("logistics.provider.wallet.fund", organizationId);
                setIdempotencyKey(key);
                setFundError(null);
                funding.mutate({ walletId: asString(selectedWallet, "id") ?? "", amount: requestedAmount, key });
              }}
              icon={<ArrowDownUp color="#FFFFFF" size={16} />}
            />
            {amount.trim() && !amountPrecisionValid ? <Text style={[fundingStyles.errorText, { color: palette.danger }]}>Enter an amount with no more than {decimals} decimal places.</Text> : null}
            {amount.trim() && amountPrecisionValid && !enoughBalance ? <Text style={[fundingStyles.errorText, { color: palette.danger }]}>Enter an amount within your personal wallet’s available balance.</Text> : null}
          </>
        )}
        {fundError ? <View style={[fundingStyles.errorPanel, { backgroundColor: palette.dangerSoft }]}><XCircle color={palette.danger} size={15} /><Text style={[fundingStyles.errorText, { color: palette.danger }]}>{fundError}</Text></View> : null}
      </View>
      <View style={[fundingStyles.footnote, { backgroundColor: palette.successSoft }]}>
        <ShieldCheck color={palette.success} size={14} />
        <Text style={[fundingStyles.footnoteText, { color: palette.ink }]}>The transfer uses SKIMA’s shared ledger. No customer booking fee or online commission is taken during funding.</Text>
      </View>
    </Card>
  );
}


function formatCurrency(value: number, currency: string, decimals: number) {
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency", currency,
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("en-NG")}`;
  }
}
function nested(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function TextButton({ label, active, onPress }: { label: string; active: boolean; onPress(): void }) {
  return <AppButton size="sm" variant={active ? "primary" : "secondary"} label={label} onPress={onPress} />;
}
const fundingStyles = StyleSheet.create({
  heading: { flexDirection: "row", alignItems: "center", gap: 10 },
  headingIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  headingCopy: { flex: 1, gap: 3 },
  title: { ...typography.bodyStrong, fontSize: 14 },
  description: { ...typography.caption, fontSize: 9, lineHeight: 15 },
  balancePanel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 13, gap: 4 },
  balanceLabel: { ...typography.caption, fontSize: 9 },
  balanceValue: { ...typography.heading, fontSize: 25 },
  balanceHint: { ...typography.caption, fontSize: 9, lineHeight: 15 },
  form: { gap: 10 },
  label: { ...typography.caption, fontSize: 11, fontWeight: "900" },
  walletChoices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  walletChoice: { minWidth: 105, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 11, paddingVertical: 9, gap: 3 },
  walletCode: { ...typography.bodyStrong, fontSize: 11 },
  walletAvailable: { ...typography.caption, fontSize: 9 },
  footnote: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: radii.md },
  footnoteText: { flex: 1, ...typography.caption, fontSize: 9, lineHeight: 15 },
  errorPanel: { flexDirection: "row", alignItems: "flex-start", gap: 7, padding: 10, borderRadius: radii.md },
  errorText: { flex: 1, ...typography.caption, fontSize: 9, lineHeight: 15 },
});
const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: spacing.sm },
  content: { gap: spacing.lg },
  section: { gap: 12 },
  sectionIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  sectionTitle: { ...typography.heading, fontSize: 18 },
  sectionBody: { ...typography.caption, fontSize: 11, lineHeight: 18 },
  companyRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  companyIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  companyCopy: { flex: 1, gap: 2 },
  companyEyebrow: { ...typography.eyebrow, fontSize: 8 },
  companyName: { ...typography.bodyStrong, fontSize: 14 },
  companyMeta: { ...typography.caption, fontSize: 9 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: radii.md, padding: 10 },
  noticeText: { ...typography.caption, flex: 1, fontSize: 9, lineHeight: 15 },
  sectionLead: { flexDirection: "row", alignItems: "center", gap: 8 },
  formTitle: { ...typography.bodyStrong, fontSize: 13 },
  fieldLabel: { ...typography.caption, fontSize: 11, fontWeight: "900" },
  choiceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  quoteHint: { flexDirection: "row", alignItems: "center", gap: 7 },
  quoteHintText: { ...typography.caption, flex: 1, fontSize: 9 },
  serviceList: { gap: 8 },
  serviceCard: { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 11 },
  coverageList: { gap: 8 },
  coverageCard: { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 11 },
  smallIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  serviceCopy: { flex: 1, minWidth: 0, gap: 2 },
  serviceTitle: { ...typography.bodyStrong, fontSize: 11 },
  serviceMeta: { ...typography.caption, fontSize: 9, textTransform: "capitalize" },
  coverageHint: { ...typography.caption, fontSize: 9, lineHeight: 15 },
  error: { flexDirection: "row", gap: 7, alignItems: "flex-start", padding: 11, borderRadius: radii.md },
  errorText: { ...typography.caption, fontSize: 10, flex: 1, lineHeight: 17 },
});
