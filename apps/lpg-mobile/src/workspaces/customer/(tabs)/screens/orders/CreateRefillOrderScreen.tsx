import { useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, CheckCircle2, ClipboardList, MapPin, WalletCards } from "lucide-react";

import { useCurrenciesQuery } from "@lpg/features/config/api";
import { useCylindersQuery } from "@lpg/features/cylinders/api";
import { useCreateOrderMutation, useCreateQuoteMutation, useQuotesQuery, useReserveOrderPaymentMutation } from "@lpg/features/orders/api";
import { useLocationsQuery } from "@lpg/features/profiles/api";
import { useWalletBalancesQuery } from "@lpg/features/wallet/api";
import { displayReference, findRecordById, getFirstRecordNumber, getFirstRecordString, getRecordId } from "@lpg/shared/api/records";
import { InfoTile, PageHeading, PolishedEmpty } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { displayMoney, resolveCurrencyCode } from "@lpg/shared/utilities/display";
import { formatCylinderTitle } from "@lpg/shared/utilities/lpgFormat";
import type { CustomerScreenProps } from "../../navigation/customerRoutes";

type Step = "details" | "quote" | "complete";

export function CreateRefillOrderScreen(props: CustomerScreenProps) {
  const cylinders = useCylindersQuery();
  const locations = useLocationsQuery();
  const quotes = useQuotesQuery();
  const wallets = useWalletBalancesQuery();
  const currencies = useCurrenciesQuery();
  const createQuote = useCreateQuoteMutation();
  const createOrder = useCreateOrderMutation();
  const reservePayment = useReserveOrderPaymentMutation();
  const [cylinderId, setCylinderId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [requestedKg, setRequestedKg] = useState("");
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("details");
  const [error, setError] = useState<string | null>(null);
  const selectedCylinder = findRecordById(cylinders.data ?? [], cylinderId);
  const selectedLocation = findRecordById(locations.data ?? [], locationId);
  const quote = useMemo(() => findRecordById(quotes.data ?? [], quoteId), [quotes.data, quoteId]);
  const currencyCode = resolveCurrencyCode(currencies.data ?? [], quote);
  const busy = createQuote.isPending || createOrder.isPending || reservePayment.isPending;
  const loading = cylinders.isLoading || locations.isLoading || quotes.isLoading || wallets.isLoading || currencies.isLoading;
  const queryError = cylinders.error ?? locations.error ?? quotes.error ?? wallets.error ?? currencies.error;

  async function requestQuote(event: FormEvent) {
    event.preventDefault();
    const kg = Number(requestedKg);
    const capacity = getFirstRecordNumber(selectedCylinder, ["max_capacity_kg", "size_kg"]);
    if (!selectedCylinder || !selectedLocation || !Number.isFinite(kg) || kg <= 0 || (capacity !== null && kg > capacity)) {
      setError(capacity !== null ? `Enter a refill amount up to ${capacity}kg.` : "Select a cylinder, address and valid refill amount.");
      return;
    }
    setError(null);
    try {
      const result = await createQuote.submit({
        cylinderId, deliveryLocationId: locationId, pickupLocationId: locationId, requestedKg: kg,
      });
      if (typeof result !== "string") throw new Error("The quote response did not include its record ID.");
      setQuoteId(result);
      await quotes.refetch();
      setStep("quote");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the quote."); }
  }

  async function payAndPlaceOrder() {
    if (!quoteId) return;
    setError(null);
    try {
      const created = await createOrder.submit(quoteId);
      if (typeof created !== "string") throw new Error("The order response did not include its record ID.");
      const walletId = getFirstRecordString(wallets.data?.[0], ["wallet_id", "walletId"]);
      await reservePayment.submit(created, walletId ?? undefined);
      setOrderId(created);
      setStep("complete");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not place the order."); }
  }

  return <QueryState loading={loading} error={queryError} onRetry={() => void Promise.all([cylinders.refetch(), locations.refetch(), quotes.refetch(), wallets.refetch(), currencies.refetch()])}>
    <button className="back-link" type="button" onClick={props.navigation.goBack}><ArrowLeft /> Back</button>
    <PageHeading title="Request a Refill" subtitle="Your quote and workflow are calculated by Skima" icon={<ClipboardList />} />
    {(cylinders.data ?? []).length === 0 ? <PolishedEmpty icon={<ClipboardList />} title="Register a cylinder first" message="A verified cylinder record is required before requesting a refill." actionLabel="Register Cylinder" onAction={() => props.navigation.replace("cylinder-register")} /> :
    (locations.data ?? []).length === 0 ? <PolishedEmpty icon={<MapPin />} title="Add a delivery address first" message="A backend-verified pickup and delivery location is required." actionLabel="Manage Addresses" onAction={() => props.navigation.replace("account-addresses")} /> :
    step === "details" ? <form className="sheet-form content-card" onSubmit={requestQuote}>
      <label>Cylinder<select required value={cylinderId} onChange={(e) => setCylinderId(e.target.value)}><option value="">Select cylinder</option>{(cylinders.data ?? []).map((item) => <option key={getRecordId(item) ?? ""} value={getRecordId(item) ?? ""}>{formatCylinderTitle(item)} — {displayReference(item)}</option>)}</select></label>
      <label>Pickup and delivery address<select required value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">Select saved address</option>{(locations.data ?? []).map((item) => <option key={getRecordId(item) ?? ""} value={getRecordId(item) ?? ""}>{getFirstRecordString(item, ["label", "formatted_address"]) ?? "Saved address"}</option>)}</select></label>
      <label>Kilograms to refill<input required inputMode="decimal" min="0.1" step="0.1" type="number" value={requestedKg} onChange={(e) => setRequestedKg(e.target.value)} /></label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" disabled={busy} type="submit">{busy ? "Creating quote…" : "Review Quote"}</button>
    </form> : step === "quote" ? <section className="content-card stack">
      <h2>Quote summary</h2>
      {!quote ? <p>The quote is refreshing from the backend…</p> : <div className="info-grid">
        <InfoTile icon={<ClipboardList />} title="Reference" text={displayReference(quote)} />
        <InfoTile icon={<WalletCards />} title="LPG" text={displayMoney(getFirstRecordNumber(quote, ["lpg_amount"]), currencyCode)} />
        <InfoTile icon={<MapPin />} title="Delivery" text={displayMoney(getFirstRecordNumber(quote, ["delivery_fee_amount"]), currencyCode)} />
        <InfoTile icon={<WalletCards />} title="Total" text={displayMoney(getFirstRecordNumber(quote, ["total_amount"]), currencyCode)} />
      </div>}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" disabled={busy || !quote} type="button" onClick={() => void payAndPlaceOrder()}>{busy ? "Securing payment…" : "Pay from Wallet & Place Order"}</button>
      <button className="outline-button" disabled={busy} type="button" onClick={() => setStep("details")}>Change Details</button>
    </section> : <PolishedEmpty icon={<CheckCircle2 />} title="Order placed" message="Payment is reserved and dispatch can now continue through the configured workflow." actionLabel="View Order" onAction={() => props.navigation.replace("order-details", { orderId: orderId ?? "" })} />}
  </QueryState>;
}
