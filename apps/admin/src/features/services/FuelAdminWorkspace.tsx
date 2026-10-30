import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Plus, RefreshCcw, Save, ShieldCheck, Truck, Warehouse } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

import { createClientIdempotencyKey } from "@skima/frontend-core";
import {
  Button,
  ErrorState,
  LoadingState,
  MetricTile,
  SelectInput,
  StatusBadge,
  TextInput,
} from "@skima/ui";

import { useSessionState } from "../../session";
import { AdminFormSection, AdminV2PageHeader } from "../../shared/patterns/AdminV2Patterns";
import {
  CatalogRecordArraySchema,
  catalogError,
  catalogLabel,
  catalogNumber,
  catalogText,
  type CatalogRecord,
} from "./service-catalog-v2-shared";
import "./service-catalog-v2.css";

const PRODUCTS = [
  { key: "fuel.pms", name: "Petrol", code: "PMS" },
  { key: "fuel.ago", name: "Diesel", code: "AGO" },
  { key: "fuel.dpk", name: "Kerosene", code: "DPK" },
] as const;
const CURRENCIES = [
  { label: "Nigerian naira (NGN)", value: "NGN" },
  { label: "USDC", value: "USDC" },
];
const FULFILLMENT_MODES = ["station_managed", "independent_driver", "skima_managed"] as const;
const empty = {
  branchId: "",
  productKey: "fuel.pms",
  currencyCode: "NGN",
  pricePerLitre: "",
  minimumLitres: "1",
  maximumLitres: "200",
  purchaseAmount: "",
  rentalAmount: "",
  depositAmount: "",
  deliveryFee: "",
  platformFee: "",
  taxRate: "0",
  status: "draft",
};
type OfferForm = typeof empty;

export function FuelAdminWorkspace(props: { onNavigate: (href: string) => void }) {
  const { api, status } = useSessionState();
  const client = useQueryClient();
  const [offerForm, setOfferForm] = useState<OfferForm>(empty);
  const [selectedModes, setSelectedModes] = useState<string[]>([...FULFILLMENT_MODES]);
  const [storageForm, setStorageForm] = useState({
    branchId: "", productKey: "fuel.pms", key: "", name: "", capacity: "", reserve: "0", status: "active",
  });
  const [containerTypeForm, setContainerTypeForm] = useState({
    key: "", name: "", capacity: "", products: ["fuel.pms"] as string[], status: "draft",
  });
  const [containerForm, setContainerForm] = useState({ serial: "", containerTypeId: "", branchId: "", organizationId: "" });
  const [qualificationForm, setQualificationForm] = useState({
    driverUserId: "", driverProfileId: "", stationManagedDriverId: "", branchId: "",
    vehicleId: "", productKey: "fuel.pms", maximumLoad: "", status: "pending",
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const products = useFuelQuery(api, status, "products", "/runtime/fuel/products");
  const branches = useFuelQuery(api, status, "branches", "/runtime/organization-branches");
  const offers = useFuelQuery(api, status, "offers", "/runtime/fuel/offers");
  const tanks = useFuelQuery(api, status, "storage", "/runtime/fuel/storage");
  const containerTypes = useFuelQuery(api, status, "container-types", "/runtime/fuel/container-types");
  const containers = useFuelQuery(api, status, "containers", "/runtime/fuel/containers");
  const qualifications = useFuelQuery(api, status, "qualifications", "/runtime/fuel/driver-qualifications");

  const queries = [products, branches, offers, tanks, containerTypes, containers, qualifications];
  const loading = queries.some((query) => query.isLoading);
  const failed = queries.find((query) => query.error)?.error;
  const branchOptions = useMemo(() => [
    { label: "Choose station branch", value: "" },
    ...(branches.data ?? []).map((branch) => ({
      label: catalogLabel(branch, "Station branch"),
      value: catalogText(branch, "id"),
    })).filter((option) => option.value),
  ], [branches.data]);
  const typeOptions = useMemo(() => [
    { label: "Choose container type", value: "" },
    ...(containerTypes.data ?? []).filter((type) => catalogText(type, "status") === "active").map((type) => ({
      label: `${catalogLabel(type)} · ${catalogNumber(type, "nominal_capacity_litres")} L`,
      value: catalogText(type, "id"),
    })).filter((option) => option.value),
  ], [containerTypes.data]);

  const refresh = async () => {
    await Promise.all(queries.map((query) => query.refetch()));
  };
  const invalidate = async () => {
    await client.invalidateQueries({ queryKey: ["admin-fuel"] });
    await refresh();
  };
  const toggleProduct = useFuelMutation(api, "/runtime/fuel/products", invalidate, setNotice, setActionError);
  const saveOffer = useFuelMutation(api, "/runtime/fuel/offers", invalidate, setNotice, setActionError);
  const saveTank = useFuelMutation(api, "/runtime/fuel/storage", invalidate, setNotice, setActionError);
  const saveContainerType = useFuelMutation(api, "/runtime/fuel/container-types", invalidate, setNotice, setActionError);
  const registerContainer = useFuelMutation(api, "/runtime/fuel/containers/register", invalidate, setNotice, setActionError);
  const saveQualification = useFuelMutation(api, "/runtime/fuel/driver-qualifications", invalidate, setNotice, setActionError);

  const onProductToggle = async (product: CatalogRecord) => {
    const key = catalogText(product, "key");
    const enabled = catalogText(product, "status") === "enabled";
    await toggleProduct.mutateAsync({
      productKey: key,
      status: enabled ? "disabled" : "enabled",
      reason: enabled ? "Disabled from Fuel administration workspace" : "Enabled from Fuel administration workspace",
      idempotencyKey: createClientIdempotencyKey("admin.fuel.product", key),
    });
  };

  const submitOffer = async () => {
    if (!offerForm.branchId || !offerForm.pricePerLitre || !offerForm.minimumLitres || !offerForm.maximumLitres) {
      setActionError("Choose a branch and enter the per-litre price and valid litre limits.");
      return;
    }
    await saveOffer.mutateAsync({
      branchId: offerForm.branchId,
      productKey: offerForm.productKey,
      currencyCode: offerForm.currencyCode,
      pricePerLitre: Number(offerForm.pricePerLitre),
      minimumLitres: Number(offerForm.minimumLitres),
      maximumLitres: Number(offerForm.maximumLitres),
      containerPurchaseAmount: numeric(offerForm.purchaseAmount),
      containerRentalAmount: numeric(offerForm.rentalAmount),
      refundableDepositAmount: numeric(offerForm.depositAmount),
      driverDeliveryFeeAmount: numeric(offerForm.deliveryFee),
      platformFeeAmount: numeric(offerForm.platformFee),
      taxRatePercent: numeric(offerForm.taxRate),
      fulfillmentModes: selectedModes,
      status: offerForm.status,
      idempotencyKey: createClientIdempotencyKey("admin.fuel.offer", `${offerForm.branchId}:${offerForm.productKey}:${offerForm.currencyCode}`),
      metadata: { configured_from: "admin_fuel_workspace" },
    });
  };

  const submitTank = async () => {
    if (!storageForm.branchId || !storageForm.key.trim() || !storageForm.name.trim() || !storageForm.capacity) {
      setActionError("Choose a branch and provide a tank key, display name and positive capacity.");
      return;
    }
    const branch = (branches.data ?? []).find((item) => catalogText(item, "id") === storageForm.branchId);
    const organizationId = branch ? catalogText(branch, "organization_id") : "";
    if (!organizationId) {
      setActionError("The selected station branch has no resolvable organization.");
      return;
    }
    await saveTank.mutateAsync({
      organizationId,
      branchId: storageForm.branchId,
      productKey: storageForm.productKey,
      storageKey: storageForm.key.trim(),
      displayName: storageForm.name.trim(),
      capacityLitres: Number(storageForm.capacity),
      safetyReserveLitres: numeric(storageForm.reserve),
      status: storageForm.status,
      metadata: {},
      idempotencyKey: createClientIdempotencyKey("admin.fuel.tank", `${storageForm.branchId}:${storageForm.key.trim()}`),
    });
    setStorageForm({ branchId: storageForm.branchId, productKey: storageForm.productKey, key: "", name: "", capacity: "", reserve: "0", status: "active" });
  };

  const submitContainerType = async () => {
    if (!containerTypeForm.key.trim() || !containerTypeForm.name.trim() || Number(containerTypeForm.capacity) <= 0 || containerTypeForm.products.length === 0) {
      setActionError("Enter a type key, name, positive litre capacity and at least one compatible product.");
      return;
    }
    await saveContainerType.mutateAsync({
      key: containerTypeForm.key.trim(),
      displayName: containerTypeForm.name.trim(),
      nominalCapacityLitres: Number(containerTypeForm.capacity),
      supportedProductKeys: containerTypeForm.products,
      status: containerTypeForm.status,
      metadata: {},
      idempotencyKey: createClientIdempotencyKey("admin.fuel.container-type", containerTypeForm.key.trim()),
    });
    setContainerTypeForm({ key: "", name: "", capacity: "", products: ["fuel.pms"], status: "draft" });
  };

  const submitContainer = async () => {
    if (!containerForm.serial.trim() || !containerForm.containerTypeId) {
      setActionError("Enter a unique container serial and choose its type.");
      return;
    }
    await registerContainer.mutateAsync({
      serialNumber: containerForm.serial.trim(),
      containerTypeId: containerForm.containerTypeId,
      organizationId: containerForm.organizationId || undefined,
      metadata: { registered_from: "admin_fuel_workspace" },
    });
    setContainerForm({ serial: "", containerTypeId: containerForm.containerTypeId, branchId: containerForm.branchId, organizationId: containerForm.organizationId });
  };

  const submitQualification = async () => {
    const hasDriverIdentity = Boolean(qualificationForm.driverProfileId) !== Boolean(qualificationForm.stationManagedDriverId);
    if (!qualificationForm.driverUserId || !hasDriverIdentity || !qualificationForm.vehicleId || !qualificationForm.maximumLoad) {
      setActionError("Provide the driver user, exactly one driver profile type, vehicle and maximum fuel load.");
      return;
    }
    await saveQualification.mutateAsync({
      driverUserId: qualificationForm.driverUserId,
      driverProfileId: qualificationForm.driverProfileId || undefined,
      stationManagedDriverId: qualificationForm.stationManagedDriverId || undefined,
      branchId: qualificationForm.branchId || undefined,
      vehicleId: qualificationForm.vehicleId,
      productKey: qualificationForm.productKey,
      maximumLoadLitres: Number(qualificationForm.maximumLoad),
      status: qualificationForm.status,
      idempotencyKey: createClientIdempotencyKey("admin.fuel.driver-qualification", `${qualificationForm.driverUserId}:${qualificationForm.vehicleId}:${qualificationForm.productKey}:${qualificationForm.branchId}`),
      metadata: { reviewed_from: "admin_fuel_workspace" },
    });
    setQualificationForm({ ...qualificationForm, maximumLoad: "" });
  };

  if (loading) return <LoadingState label="Loading SKIMA Fuel configuration" />;
  if (failed) return <ErrorState title="Fuel administration unavailable" message={catalogError(failed)} onRetry={() => void refresh()} />;

  const productRows = (products.data ?? []).filter((item) =>
    PRODUCTS.some((product) => product.key === catalogText(item, "key"))
  );
  const enabledCount = productRows.filter((item) => catalogText(item, "status") === "enabled").length;

  return (
    <div className="catalog-v2">
      <AdminV2PageHeader
        eyebrow="Services · SKIMA Fuel"
        title="Fuel administration"
        description="Control petrol, diesel and kerosene as one Fuel module. Configure global product availability, each station's local offer, tank stock, reusable containers and product-qualified delivery teams."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button>}
      />

      <div className="catalog-v2__review-grid">
        <MetricTile label="Enabled products" value={String(enabledCount)} />
        <MetricTile label="Station offers" value={String(offers.data?.filter((item) => catalogText(item, "status") === "active").length ?? 0)} />
        <MetricTile label="Fuel tanks" value={String(tanks.data?.length ?? 0)} />
        <MetricTile label="Container assets" value={String(containers.data?.length ?? 0)} />
      </div>

      {notice ? <section className="admin-notice"><strong>Saved</strong><p>{notice}</p></section> : null}
      {actionError ? <section className="admin-notice is-error"><strong>Action could not be completed</strong><p>{actionError}</p></section> : null}

      <section className="sk-panel catalog-v2__form-card">
        <div className="sk-panel__header">
          <div><p className="admin-section-kicker">Platform-level switches</p><h2>Fuel products</h2></div>
          <StatusBadge>{enabledCount} of 3 enabled</StatusBadge>
        </div>
        <p className="skima-muted">The Fuel module can stay active while each product is independently disabled. Pausing a product blocks new customer orders without deleting in-progress orders.</p>
        <div className="fuel-admin-product-grid">
          {PRODUCTS.map((definition) => {
            const record = productRows.find((item) => catalogText(item, "key") === definition.key);
            const enabled = catalogText(record, "status") === "enabled";
            return (
              <article className="fuel-admin-product" key={definition.key}>
                <div><strong>{definition.name}</strong><small>{definition.code} · {definition.key}</small></div>
                <StatusBadge tone={enabled ? "success" : "warning"}>{enabled ? "Enabled" : "Disabled"}</StatusBadge>
                <Button
                  variant={enabled ? "outline" : "primary"}
                  isLoading={toggleProduct.isPending}
                  onClick={() => record ? void onProductToggle(record) : undefined}
                  disabled={!record}
                >{enabled ? "Disable product" : "Enable product"}</Button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="sk-panel catalog-v2__form-card">
        <div className="sk-panel__header"><div><p className="admin-section-kicker">Branch-level offer</p><h2>Station prices and charges</h2></div><StatusBadge>Per product · Per currency</StatusBadge></div>
        <p className="skima-muted">Each branch and product has independent litre limits and prices. Container charges, delivery, platform fee and tax are stored with the station offer and included in the server-calculated customer quote.</p>
        <div className="skima-form-grid">
          <SelectInput label="Station branch" value={offerForm.branchId} onChange={(event) => setOfferForm({ ...offerForm, branchId: event.currentTarget.value })} options={branchOptions} />
          <SelectInput label="Fuel product" value={offerForm.productKey} onChange={(event) => setOfferForm({ ...offerForm, productKey: event.currentTarget.value })} options={PRODUCTS.map((p) => ({ label: p.name, value: p.key }))} />
          <SelectInput label="Currency" value={offerForm.currencyCode} onChange={(event) => setOfferForm({ ...offerForm, currencyCode: event.currentTarget.value })} options={CURRENCIES} />
          <TextInput label="Price per litre" type="number" value={offerForm.pricePerLitre} onChange={(event) => setOfferForm({ ...offerForm, pricePerLitre: event.currentTarget.value })} />
          <TextInput label="Minimum litres" type="number" value={offerForm.minimumLitres} onChange={(event) => setOfferForm({ ...offerForm, minimumLitres: event.currentTarget.value })} />
          <TextInput label="Maximum litres" type="number" value={offerForm.maximumLitres} onChange={(event) => setOfferForm({ ...offerForm, maximumLitres: event.currentTarget.value })} />
          <TextInput label="Container purchase charge (per container)" type="number" value={offerForm.purchaseAmount} onChange={(event) => setOfferForm({ ...offerForm, purchaseAmount: event.currentTarget.value })} />
          <TextInput label="Container rental charge (per container)" type="number" value={offerForm.rentalAmount} onChange={(event) => setOfferForm({ ...offerForm, rentalAmount: event.currentTarget.value })} />
          <TextInput label="Refundable rental deposit (per container)" type="number" value={offerForm.depositAmount} onChange={(event) => setOfferForm({ ...offerForm, depositAmount: event.currentTarget.value })} />
          <TextInput label="Driver / delivery fee" type="number" value={offerForm.deliveryFee} onChange={(event) => setOfferForm({ ...offerForm, deliveryFee: event.currentTarget.value })} />
          <TextInput label="Platform fee" type="number" value={offerForm.platformFee} onChange={(event) => setOfferForm({ ...offerForm, platformFee: event.currentTarget.value })} />
          <TextInput label="Tax rate (%)" type="number" value={offerForm.taxRate} onChange={(event) => setOfferForm({ ...offerForm, taxRate: event.currentTarget.value })} />
          <SelectInput label="Offer status" value={offerForm.status} onChange={(event) => setOfferForm({ ...offerForm, status: event.currentTarget.value })} options={[{ label: "Draft", value: "draft" }, { label: "Active", value: "active" }, { label: "Paused", value: "paused" }]} />
        </div>
        <AdminFormSection title="Allowed fulfilment modes" description="The customer can only choose modes enabled here for this specific branch and product.">
          <div className="fuel-admin-checks">
            {FULFILLMENT_MODES.map((mode) => (
              <label key={mode}><input type="checkbox" checked={selectedModes.includes(mode)} onChange={(event) => setSelectedModes(event.currentTarget.checked ? [...selectedModes, mode] : selectedModes.filter((value) => value !== mode))} />{formatMode(mode)}</label>
            ))}
          </div>
        </AdminFormSection>
        <Button icon={Save} isLoading={saveOffer.isPending} disabled={!selectedModes.length} onClick={() => void submitOffer()}>Save branch offer</Button>
        <div className="fuel-admin-list">
          {(offers.data ?? []).map((offer) => (
            <article className="fuel-admin-list-row" key={catalogText(offer, "id")}>
              <div><strong>{productName(catalogText(offer, "product_key"))}</strong><small>{branchName(branches.data ?? [], catalogText(offer, "branch_id"))} · {catalogText(offer, "currency_code")}</small></div>
              <div><strong>{formatMoney(catalogNumber(offer, "price_per_litre"), catalogText(offer, "currency_code"))} / L</strong><small>{catalogNumber(offer, "minimum_litres")}–{catalogNumber(offer, "maximum_litres")} L</small></div>
              <StatusBadge tone={catalogText(offer, "status") === "active" ? "success" : "warning"}>{catalogText(offer, "status")}</StatusBadge>
            </article>
          ))}
        </div>
      </section>

      <div className="fuel-admin-two-column">
        <section className="sk-panel catalog-v2__form-card">
          <div className="sk-panel__header"><div><p className="admin-section-kicker">Station inventory</p><h2>Configure fuel tanks</h2></div><Warehouse size={21} /></div>
          <div className="skima-form-grid">
            <SelectInput label="Station branch" value={storageForm.branchId} onChange={(event) => setStorageForm({ ...storageForm, branchId: event.currentTarget.value })} options={branchOptions} />
            <SelectInput label="Product" value={storageForm.productKey} onChange={(event) => setStorageForm({ ...storageForm, productKey: event.currentTarget.value })} options={PRODUCTS.map((p) => ({ label: p.name, value: p.key }))} />
            <TextInput label="Tank key" value={storageForm.key} onChange={(event) => setStorageForm({ ...storageForm, key: event.currentTarget.value })} />
            <TextInput label="Tank name" value={storageForm.name} onChange={(event) => setStorageForm({ ...storageForm, name: event.currentTarget.value })} />
            <TextInput label="Capacity (litres)" type="number" value={storageForm.capacity} onChange={(event) => setStorageForm({ ...storageForm, capacity: event.currentTarget.value })} />
            <TextInput label="Safety reserve (litres)" type="number" value={storageForm.reserve} onChange={(event) => setStorageForm({ ...storageForm, reserve: event.currentTarget.value })} />
          </div>
          <Button icon={Plus} isLoading={saveTank.isPending} onClick={() => void submitTank()}>Save tank configuration</Button>
          <div className="fuel-admin-list">
            {(tanks.data ?? []).map((tank) => (
              <article className="fuel-admin-list-row" key={catalogText(tank, "id")}>
                <div><strong>{catalogLabel(tank)}</strong><small>{productName(catalogText(tank, "product_key"))} · {branchName(branches.data ?? [], catalogText(tank, "branch_id"))}</small></div>
                <div><strong>{catalogNumber(tank, "physical_stock_litres").toLocaleString()} / {catalogNumber(tank, "capacity_litres").toLocaleString()} L</strong><small>{catalogNumber(tank, "reserved_stock_litres")} L reserved · {catalogNumber(tank, "safety_reserve_litres")} L safety reserve</small></div>
                <StatusBadge>{catalogText(tank, "status")}</StatusBadge>
              </article>
            ))}
          </div>
        </section>

        <section className="sk-panel catalog-v2__form-card">
          <div className="sk-panel__header"><div><p className="admin-section-kicker">Returnable asset setup</p><h2>Container types</h2></div><Package size={21} /></div>
          <div className="skima-form-grid">
            <TextInput label="Container type key" value={containerTypeForm.key} onChange={(event) => setContainerTypeForm({ ...containerTypeForm, key: event.currentTarget.value })} />
            <TextInput label="Display name" value={containerTypeForm.name} onChange={(event) => setContainerTypeForm({ ...containerTypeForm, name: event.currentTarget.value })} />
            <TextInput label="Capacity (litres)" type="number" value={containerTypeForm.capacity} onChange={(event) => setContainerTypeForm({ ...containerTypeForm, capacity: event.currentTarget.value })} />
            <SelectInput label="Type status" value={containerTypeForm.status} onChange={(event) => setContainerTypeForm({ ...containerTypeForm, status: event.currentTarget.value })} options={[{ label: "Draft", value: "draft" }, { label: "Active", value: "active" }, { label: "Paused", value: "paused" }]} />
          </div>
          <AdminFormSection title="Compatible fuel products">
            <div className="fuel-admin-checks">
              {PRODUCTS.map((product) => (
                <label key={product.key}><input type="checkbox" checked={containerTypeForm.products.includes(product.key)} onChange={(event) => setContainerTypeForm({ ...containerTypeForm, products: event.currentTarget.checked ? [...containerTypeForm.products, product.key] : containerTypeForm.products.filter((value) => value !== product.key) })} />{product.name}</label>
              ))}
            </div>
          </AdminFormSection>
          <Button icon={Save} isLoading={saveContainerType.isPending} onClick={() => void submitContainerType()}>Save container type</Button>
          <div className="fuel-admin-list">
            {(containerTypes.data ?? []).map((type) => (
              <article className="fuel-admin-list-row" key={catalogText(type, "id")}>
                <div><strong>{catalogLabel(type)}</strong><small>{catalogText(type, "key")}</small></div>
                <div><strong>{catalogNumber(type, "nominal_capacity_litres")} L</strong><small>{Array.isArray(type.supported_product_keys) ? type.supported_product_keys.map((key) => productName(String(key))).join(", ") : ""}</small></div>
                <StatusBadge>{catalogText(type, "status")}</StatusBadge>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="sk-panel catalog-v2__form-card">
        <div className="sk-panel__header"><div><p className="admin-section-kicker">Physical container registry</p><h2>Register SKIMA containers</h2></div><Package size={21} /></div>
        <p className="skima-muted">A registered container is a serialized physical asset. Assign it to the station's organization so station staff can see the container inventory. Reuse remains blocked until a rental return passes station inspection.</p>
        <div className="skima-form-grid">
          <TextInput label="Serial / asset number" value={containerForm.serial} onChange={(event) => setContainerForm({ ...containerForm, serial: event.currentTarget.value })} />
          <SelectInput label="Container type" value={containerForm.containerTypeId} onChange={(event) => setContainerForm({ ...containerForm, containerTypeId: event.currentTarget.value })} options={typeOptions} />
          <SelectInput label="Owning station branch" value={containerForm.branchId} onChange={(event) => {
            const branch = (branches.data ?? []).find((item) => catalogText(item, "id") === event.currentTarget.value);
            setContainerForm({
              ...containerForm,
              branchId: event.currentTarget.value,
              organizationId: branch ? catalogText(branch, "organization_id") : "",
            });
          }} options={branchOptions} />
        </div>
        <Button icon={Plus} isLoading={registerContainer.isPending} onClick={() => void submitContainer()}>Register container asset</Button>
        <div className="fuel-admin-list">
          {(containers.data ?? []).slice(0, 40).map((container) => (
            <article className="fuel-admin-list-row" key={catalogText(container, "id")}>
              <div><strong>{catalogText(container, "serial_number")}</strong><small>{typeName(containerTypes.data ?? [], catalogText(container, "container_type_id"))}</small></div>
              <div><strong>{catalogNumber(container, "capacity_litres")} L</strong><small>{catalogText(container, "ownership_mode")}</small></div>
              <StatusBadge tone={catalogText(container, "status") === "available" ? "success" : "warning"}>{catalogText(container, "status")}</StatusBadge>
            </article>
          ))}
        </div>
      </section>

      <section className="sk-panel catalog-v2__form-card">
        <div className="sk-panel__header"><div><p className="admin-section-kicker">Driver & vehicle control</p><h2>Product-specific qualifications</h2></div><Truck size={21} /></div>
        <p className="skima-muted">A driver must be separately approved for each fuel product, vehicle and maximum litre load. Station Managed qualifications use the existing station-managed driver identity; independent and SKIMA Managed qualifications use the existing driver profile.</p>
        <div className="skima-form-grid">
          <TextInput label="Driver user ID" value={qualificationForm.driverUserId} onChange={(event) => setQualificationForm({ ...qualificationForm, driverUserId: event.currentTarget.value })} />
          <TextInput label="Independent driver profile ID (optional)" value={qualificationForm.driverProfileId} onChange={(event) => setQualificationForm({ ...qualificationForm, driverProfileId: event.currentTarget.value, stationManagedDriverId: "" })} />
          <TextInput label="Station Managed driver ID (optional)" value={qualificationForm.stationManagedDriverId} onChange={(event) => setQualificationForm({ ...qualificationForm, stationManagedDriverId: event.currentTarget.value, driverProfileId: "" })} />
          <SelectInput label="Station branch (optional)" value={qualificationForm.branchId} onChange={(event) => setQualificationForm({ ...qualificationForm, branchId: event.currentTarget.value })} options={[{ label: "All branches (where permitted)", value: "" }, ...branchOptions.filter((option) => option.value)]} />
          <TextInput label="Vehicle ID" value={qualificationForm.vehicleId} onChange={(event) => setQualificationForm({ ...qualificationForm, vehicleId: event.currentTarget.value })} />
          <SelectInput label="Fuel product" value={qualificationForm.productKey} onChange={(event) => setQualificationForm({ ...qualificationForm, productKey: event.currentTarget.value })} options={PRODUCTS.map((p) => ({ label: p.name, value: p.key }))} />
          <TextInput label="Maximum approved load (litres)" type="number" value={qualificationForm.maximumLoad} onChange={(event) => setQualificationForm({ ...qualificationForm, maximumLoad: event.currentTarget.value })} />
          <SelectInput label="Qualification status" value={qualificationForm.status} onChange={(event) => setQualificationForm({ ...qualificationForm, status: event.currentTarget.value })} options={[{ label: "Pending", value: "pending" }, { label: "Approved", value: "approved" }, { label: "Rejected", value: "rejected" }, { label: "Suspended", value: "suspended" }]} />
        </div>
        <Button icon={ShieldCheck} isLoading={saveQualification.isPending} onClick={() => void submitQualification()}>Save driver qualification</Button>
        <div className="fuel-admin-list">
          {(qualifications.data ?? []).map((qualification) => (
            <article className="fuel-admin-list-row" key={catalogText(qualification, "id")}>
              <div><strong>{productName(catalogText(qualification, "product_key"))} · {catalogNumber(qualification, "maximum_load_litres")} L</strong><small>{catalogText(qualification, "driver_user_id")} · {catalogText(qualification, "vehicle_id")}</small></div>
              <StatusBadge tone={catalogText(qualification, "status") === "approved" ? "success" : "warning"}>{catalogText(qualification, "status")}</StatusBadge>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-notice">
        <strong>Service coverage must also be enabled for Fuel</strong>
        <p>Global products and station offers do not automatically launch service in every location. Configure the Fuel customer-ordering coverage policy and approved station/driver Fuel assignments in the existing coverage workspace before enabling customer ordering in a launch area.</p>
        <Button variant="outline" onClick={() => props.onNavigate("/operations/coverage")}>Open service coverage</Button>
      </section>
    </div>
  );
}

function useFuelQuery(api: ReturnType<typeof useSessionState>["api"], status: string, key: string, path: string) {
  return useQuery({
    queryKey: ["admin-fuel", key],
    enabled: status === "authenticated",
    retry: false,
    queryFn: () => api.get(path, CatalogRecordArraySchema),
  });
}

function useFuelMutation(
  api: ReturnType<typeof useSessionState>["api"],
  path: string,
  onSuccess: () => Promise<void>,
  setNotice: (value: string | null) => void,
  setError: (value: string | null) => void,
) {
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post(path, payload, z.unknown()),
    onSuccess: async () => {
      setError(null);
      setNotice("Your Fuel configuration was saved.");
      await onSuccess();
    },
    onError: (error) => {
      setNotice(null);
      setError(catalogError(error));
    },
  });
}

function numeric(value: string): number {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}

function productName(key: string): string {
  return PRODUCTS.find((product) => product.key === key)?.name ?? (key || "Fuel");
}

function branchName(branches: readonly CatalogRecord[], branchId: string): string {
  const branch = branches.find((item) => catalogText(item, "id") === branchId);
  return catalogLabel(branch, branchId || "Station branch");
}

function typeName(types: readonly CatalogRecord[], typeId: string): string {
  return catalogLabel(types.find((item) => catalogText(item, "id") === typeId), typeId || "Container type");
}

function formatMode(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
