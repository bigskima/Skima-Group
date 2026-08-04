import { CheckCircle2, Fuel, MapPin, WalletCards } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { useCurrenciesQuery, useLpgConfigQuery } from "@lpg/features/config/api";
import { useCylindersQuery } from "@lpg/features/cylinders/api";
import {
  useCreateOrderMutation,
  useCreateQuoteMutation,
  useQuotesQuery,
  useReserveOrderPaymentMutation,
} from "@lpg/features/orders/api";
import { useLocationsQuery } from "@lpg/features/profiles/api";
import { useWalletBalancesQuery } from "@lpg/features/wallet/api";
import {
  displayReference,
  findRecordById,
  getActionResultId,
  getConfigRecords,
  getFirstRecordNumber,
  getFirstRecordString,
  getRecordId,
} from "@lpg/shared/api/records";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { RecordField, WorkflowForm, WorkflowHeader } from "@lpg/shared/ui/WorkflowScreen";
import { displayMoney, resolveCurrencyCode } from "@lpg/shared/utilities/display";
import { formatCylinderTitle } from "@lpg/shared/utilities/lpgFormat";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

export function NewRefillScreen(props: CustomerScreenProps) {
  const cylinders = useCylindersQuery();
  const locations = useLocationsQuery();
  const quotes = useQuotesQuery();
  const config = useLpgConfigQuery();
  const currencies = useCurrenciesQuery();
  const wallets = useWalletBalancesQuery();
  const createQuote = useCreateQuoteMutation();
  const createOrder = useCreateOrderMutation();
  const reservePayment = useReserveOrderPaymentMutation();
  const [cylinderId, setCylinderId] = useState("");
  const [pickupLocationId, setPickupLocationId] = useState("");
  const [deliveryLocationId, setDeliveryLocationId] = useState("");
  const [requestedKg, setRequestedKg] = useState("");
  const [instructions, setInstructions] = useState("");
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<Error | null>(null);
  const selectedQuote = findRecordById(quotes.data ?? [], quoteId);
  const selectedCylinder = findRecordById(cylinders.data ?? [], cylinderId);
  const pricing = getConfigRecords(config.data, "pricing");
  const minKg = useMemo(() => minimumNumber(pricing, ["minKg", "min_kg"]), [pricing]);
  const maxKg = useMemo(() => maximumNumber(pricing, ["maxKg", "max_kg"]), [pricing]);
  const currencyCode = resolveCurrencyCode(currencies.data ?? [], selectedQuote ?? pricing[0]);
  const error = cylinders.error ?? locations.error ?? quotes.error ?? config.error ?? currencies.error ?? wallets.error;
  const loading = cylinders.isLoading || locations.isLoading || config.isLoading || currencies.isLoading || wallets.isLoading;

  const requestQuote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);

    try {
      if (!cylinderId || !pickupLocationId || !deliveryLocationId) {
        throw new Error("Choose a cylinder, pickup address, and delivery address.");
      }
      const quantity = Number(requestedKg);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Enter the kilograms to refill.");
      const result = await createQuote.submit({
        cylinderId,
        deliveryInstructions: instructions.trim() || undefined,
        deliveryLocationId,
        pickupLocationId,
        requestedKg: quantity,
        source: "skima.lpg.mobile",
      });
      const id = getActionResultId(result);
      if (!id) throw new Error("The quote service did not return a quote identifier.");
      setQuoteId(id);
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error("The refill quote could not be created."));
    }
  };

  const placeOrder = async () => {
    setLocalError(null);

    try {
      let nextOrderId = orderId;
      if (!nextOrderId) {
        if (!quoteId) throw new Error("Create a quote before placing the order.");
        const result = await createOrder.submit(quoteId);
        nextOrderId = getActionResultId(result);
        if (!nextOrderId) throw new Error("The order service did not return an order identifier.");
        setOrderId(nextOrderId);
      }
      const walletId = getFirstRecordString(wallets.data?.[0], ["wallet_id", "walletId"]);
      await reservePayment.submit(nextOrderId, walletId ?? undefined);
      props.navigation.replace("order-details", { orderId: nextOrderId });
    } catch (error) {
      setLocalError(error instanceof Error ? error : new Error("The order payment could not be reserved."));
    }
  };

  return (
    <QueryState loading={loading} error={error}>
      <WorkflowHeader title="New Refill" subtitle="Quote and payment are calculated by the backend" onBack={props.navigation.goBack} />
      {!quoteId ? (
        <WorkflowForm error={localError ?? createQuote.error} isPending={createQuote.isPending} onSubmit={(event) => void requestQuote(event)} submitLabel="Get Refill Quote">
          <label>
            Cylinder
            <select value={cylinderId} onChange={(event) => setCylinderId(event.currentTarget.value)} required>
              <option value="">Choose registered cylinder</option>
              {(cylinders.data ?? []).map((cylinder) => <option key={getRecordId(cylinder) ?? ""} value={getRecordId(cylinder) ?? ""}>{formatCylinderTitle(cylinder)} - {displayReference(cylinder)}</option>)}
            </select>
          </label>
          <label>
            Pickup address
            <select value={pickupLocationId} onChange={(event) => setPickupLocationId(event.currentTarget.value)} required>
              <option value="">Choose pickup address</option>
              {(locations.data ?? []).map((location) => <option key={getRecordId(location) ?? ""} value={getRecordId(location) ?? ""}>{getFirstRecordString(location, ["label"]) ?? "Saved address"}</option>)}
            </select>
          </label>
          <label>
            Delivery address
            <select value={deliveryLocationId} onChange={(event) => setDeliveryLocationId(event.currentTarget.value)} required>
              <option value="">Choose delivery address</option>
              {(locations.data ?? []).map((location) => <option key={getRecordId(location) ?? ""} value={getRecordId(location) ?? ""}>{getFirstRecordString(location, ["label"]) ?? "Saved address"}</option>)}
            </select>
          </label>
          <label>Kilograms<input type="number" inputMode="decimal" step="0.1" min={minKg ?? undefined} max={maxKg ?? undefined} value={requestedKg} onChange={(event) => setRequestedKg(event.currentTarget.value)} required /></label>
          <label>Delivery instructions<textarea value={instructions} onChange={(event) => setInstructions(event.currentTarget.value)} /></label>
        </WorkflowForm>
      ) : (
        <section className="order-confirmation">
          <span className="confirmation-icon"><CheckCircle2 aria-hidden="true" /></span>
          <h2>{displayReference(selectedQuote, "Quote ready")}</h2>
          <div className="panel-card">
            <RecordField label="Cylinder" value={formatCylinderTitle(selectedCylinder)} />
            <RecordField label="Requested" value={`${getFirstRecordNumber(selectedQuote, ["requested_kg", "requestedKg"]) ?? requestedKg} kg`} />
            <RecordField label="LPG" value={displayMoney(getFirstRecordNumber(selectedQuote, ["lpg_amount", "lpgAmount"]), currencyCode)} />
            <RecordField label="Delivery" value={displayMoney(getFirstRecordNumber(selectedQuote, ["delivery_fee_amount", "deliveryFeeAmount"]), currencyCode)} />
            <RecordField label="Platform fee" value={displayMoney(getFirstRecordNumber(selectedQuote, ["platform_fee_amount", "platformFeeAmount"]), currencyCode)} />
            <RecordField label="Tax" value={displayMoney(getFirstRecordNumber(selectedQuote, ["tax_amount", "taxAmount"]), currencyCode)} />
            <RecordField label="Total" value={displayMoney(getFirstRecordNumber(selectedQuote, ["total_amount", "totalAmount"]), currencyCode)} />
          </div>
          {localError ?? createOrder.error ?? reservePayment.error ? <p className="form-message is-error">{(localError ?? createOrder.error ?? reservePayment.error)?.message}</p> : null}
          <button type="button" className="primary-button" disabled={createOrder.isPending || reservePayment.isPending} onClick={() => void placeOrder()}>
            <WalletCards aria-hidden="true" /> {orderId ? "Retry Payment Reservation" : "Place Order And Reserve Payment"}
          </button>
          <button type="button" className="outline-button" onClick={() => { setQuoteId(null); setOrderId(null); }}><Fuel aria-hidden="true" />Change Refill</button>
          {(locations.data ?? []).length === 0 ? <p className="form-message is-error"><MapPin aria-hidden="true" />Add a delivery address before ordering.</p> : null}
        </section>
      )}
    </QueryState>
  );
}

function minimumNumber(records: readonly Readonly<Record<string, unknown>>[], keys: readonly string[]): number | null {
  const values = records.map((record) => getFirstRecordNumber(record, keys)).filter((value): value is number => value !== null);
  return values.length > 0 ? Math.min(...values) : null;
}

function maximumNumber(records: readonly Readonly<Record<string, unknown>>[], keys: readonly string[]): number | null {
  const values = records.map((record) => getFirstRecordNumber(record, keys)).filter((value): value is number => value !== null);
  return values.length > 0 ? Math.max(...values) : null;
}
