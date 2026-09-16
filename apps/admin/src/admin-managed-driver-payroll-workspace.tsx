import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RefreshCcw, UsersRound, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { createClientIdempotencyKey } from "@skima/frontend-core";
import {
  Button,
  ErrorState,
  LoadingState,
  MetricTile,
  PageHeader,
  StatusBadge,
  TextInput,
} from "@skima/ui";

import { useSessionState } from "./session";

const DriverSchema = z.object({
  driverProfileId: z.string().uuid(),
  displayName: z.string(),
  publicDriverId: z.string().nullable(),
  isManaged: z.boolean(),
  availableForPayout: z.coerce.number(),
  paidToWallet: z.coerce.number(),
  pendingEarnings: z.coerce.number(),
  driverWalletBalance: z.coerce.number(),
  currencyCode: z.string(),
  lastPaidAt: z.string().nullable(),
});

const DriverListSchema = z.array(DriverSchema.passthrough());
type Driver = z.infer<typeof DriverSchema>;

const PayoutSchema = z.object({
  payoutId: z.string().uuid(),
  displayName: z.string(),
  publicDriverId: z.string().nullable(),
  amount: z.coerce.number(),
  currencyCode: z.string(),
  payoutReference: z.string(),
  paidAt: z.string(),
});
const PayoutListSchema = z.array(PayoutSchema.passthrough());

const BatchResultSchema = z.object({
  batchId: z.string().uuid(),
  batchReference: z.string(),
  totalAmount: z.coerce.number(),
  payoutCount: z.coerce.number().int().positive(),
  currencyCode: z.string(),
  status: z.string(),
});

export function AdminManagedDriverPayrollWorkspace() {
  const { supabase, status, context } = useSessionState();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [payrollNote, setPayrollNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const isSuperAdmin = context?.platformAdmin?.admin_kind === "super_admin";
  const canPay = Boolean(isSuperAdmin || context?.permissions.includes("platform.financial.manage"));

  const drivers = useQuery({
    queryKey: ["lpg-managed-drivers-admin"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_managed_driver_admin", {
        target_driver_profile_id: null,
      });
      if (error) throw error;
      return DriverListSchema.parse(data ?? []);
    },
  });

  const payouts = useQuery({
    queryKey: ["lpg-managed-driver-payouts"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_managed_driver_payouts", {
        target_driver_profile_id: null,
        target_limit: 50,
      });
      if (error) throw error;
      return PayoutListSchema.parse(data ?? []);
    },
  });

  const managedDrivers = useMemo(
    () => (drivers.data ?? []).filter((driver) => driver.isManaged),
    [drivers.data],
  );
  const payableDrivers = useMemo(
    () => managedDrivers.filter((driver) => driver.availableForPayout > 0),
    [managedDrivers],
  );

  useEffect(() => {
    setAmounts((current) => {
      const next = { ...current };
      for (const driver of managedDrivers) {
        if (!(driver.driverProfileId in next)) {
          next[driver.driverProfileId] = driver.availableForPayout > 0 ? String(driver.availableForPayout) : "";
        }
      }
      return next;
    });
  }, [managedDrivers]);

  const selectedPayments = useMemo(() => {
    return managedDrivers
      .filter((driver) => selected[driver.driverProfileId])
      .map((driver) => ({
        driver,
        amount: Number(amounts[driver.driverProfileId] ?? "0"),
      }))
      .filter((item) => Number.isFinite(item.amount) && item.amount > 0);
  }, [amounts, managedDrivers, selected]);

  const selectedTotal = selectedPayments.reduce((sum, item) => sum + item.amount, 0);
  const totalOutstanding = payableDrivers.reduce((sum, driver) => sum + driver.availableForPayout, 0);
  const totalWalletBalance = managedDrivers.reduce((sum, driver) => sum + driver.driverWalletBalance, 0);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["lpg-managed-drivers-admin"] }),
      queryClient.invalidateQueries({ queryKey: ["lpg-managed-driver-payouts"] }),
    ]);
  };

  const payBatch = useMutation({
    mutationFn: async () => {
      if (!selectedPayments.length) throw new Error("Choose at least one Driver with an amount to pay.");
      for (const payment of selectedPayments) {
        if (payment.amount > payment.driver.availableForPayout) {
          throw new Error(`${payment.driver.displayName}'s payment is greater than their available earnings.`);
        }
      }
      const currencies = new Set(selectedPayments.map((payment) => payment.driver.currencyCode));
      if (currencies.size !== 1) throw new Error("One payroll batch can only contain one currency.");
      const currency = selectedPayments[0].driver.currencyCode;
      const { data, error } = await supabase.rpc("pay_lpg_managed_driver_batch_to_wallet", {
        target_currency_code: currency,
        target_idempotency_key: createClientIdempotencyKey("admin.lpg.managed-driver-payroll", `${selectedPayments.length}:${selectedTotal}`),
        target_metadata: { surface: "managed_driver_payroll" },
        target_note: payrollNote.trim() || "Managed Driver payroll",
        target_payments: selectedPayments.map((payment) => ({
          driverProfileId: payment.driver.driverProfileId,
          amount: payment.amount,
        })),
      });
      if (error) throw error;
      return BatchResultSchema.parse(data);
    },
    onSuccess: async (result) => {
      setNotice(`${result.payoutCount} Driver payment${result.payoutCount === 1 ? "" : "s"} sent to SKIMA Wallets · ${money(result.totalAmount, result.currencyCode)} · ${result.batchReference}`);
      setSelected({});
      setAmounts({});
      setPayrollNote("");
      setConfirming(false);
      await refresh();
    },
  });

  if (drivers.isPending || payouts.isPending) return <LoadingState label="Loading Managed Driver payroll…" />;
  if (drivers.error) return <ErrorState error={drivers.error} onRetry={() => void refresh()} />;

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Money · Driver payroll"
        title="Managed Driver Payroll"
        description="Pay completed SKIMA-managed delivery earnings into Drivers' SKIMA Wallets. Drivers can then use the normal wallet withdrawal flow when they want to withdraw to a bank."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button>}
      />

      {notice ? <div className="sk-panel"><StatusBadge tone="success">{notice}</StatusBadge></div> : null}

      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Managed Drivers" value={managedDrivers.length} icon={UsersRound} />
        <MetricTile label="Drivers awaiting pay" value={payableDrivers.length} icon={WalletCards} tone={payableDrivers.length ? "warning" : "success"} />
        <MetricTile label="Total unpaid" value={money(totalOutstanding, "NGN")} icon={WalletCards} tone={totalOutstanding > 0 ? "warning" : "neutral"} />
        <MetricTile label="Current Driver wallets" value={money(totalWalletBalance, "NGN")} icon={CheckCircle2} />
      </section>

      <section className="sk-panel stack-md">
        <div className="section-heading">
          <div>
            <span className="section-kicker">Payroll</span>
            <h2>Choose Drivers and payment amounts</h2>
            <p className="skima-muted">Amounts default to each Driver's full available earnings. Reduce an amount for a partial payment; the unpaid remainder stays available for a later payroll.</p>
          </div>
        </div>

        {managedDrivers.length ? managedDrivers.map((driver) => {
          const checked = Boolean(selected[driver.driverProfileId]);
          const amount = amounts[driver.driverProfileId] ?? "";
          const enteredAmount = Number(amount || 0);
          const invalid = enteredAmount < 0 || enteredAmount > driver.availableForPayout;
          return (
            <div className="sk-panel" key={driver.driverProfileId}>
              <div className="skima-list-row">
                <label style={{ display: "flex", alignItems: "center", gap: ".75rem", cursor: driver.availableForPayout > 0 ? "pointer" : "default" }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!canPay || driver.availableForPayout <= 0}
                    onChange={(event) => setSelected((current) => ({ ...current, [driver.driverProfileId]: event.currentTarget.checked }))}
                  />
                  <span>
                    <strong>{driver.displayName}</strong><br />
                    <small>{driver.publicDriverId ?? "SKIMA Managed Driver"}</small>
                  </span>
                </label>
                <div style={{ textAlign: "right" }}>
                  <strong>{money(driver.availableForPayout, driver.currencyCode)}</strong><br />
                  <small>available · wallet {money(driver.driverWalletBalance, driver.currencyCode)}</small>
                </div>
              </div>
              <div className="skima-form-grid" style={{ marginTop: ".75rem" }}>
                <TextInput
                  label="Amount to pay to SKIMA Wallet"
                  type="number"
                  min="0"
                  max={driver.availableForPayout}
                  step="0.01"
                  value={amount}
                  disabled={!checked}
                  error={invalid ? "Amount cannot be greater than the Driver's available earnings." : undefined}
                  onChange={(event) => setAmounts((current) => ({ ...current, [driver.driverProfileId]: event.currentTarget.value }))}
                />
                <div className="sk-panel" style={{ alignSelf: "end" }}>
                  <span className="skima-muted">After this payment</span><br />
                  <strong>{money(Math.max(driver.availableForPayout - Math.max(enteredAmount, 0), 0), driver.currencyCode)} unpaid</strong>
                </div>
              </div>
            </div>
          );
        }) : <p className="skima-muted">No SKIMA Managed Drivers are configured yet.</p>}

        {payableDrivers.length ? (
          <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
            <Button
              variant="outline"
              disabled={!canPay}
              onClick={() => {
                const nextSelected: Record<string, boolean> = {};
                const nextAmounts: Record<string, string> = {};
                for (const driver of payableDrivers) {
                  nextSelected[driver.driverProfileId] = true;
                  nextAmounts[driver.driverProfileId] = String(driver.availableForPayout);
                }
                setSelected(nextSelected);
                setAmounts((current) => ({ ...current, ...nextAmounts }));
              }}
            >
              Select all unpaid Drivers
            </Button>
            <Button variant="ghost" onClick={() => setSelected({})}>Clear selection</Button>
          </div>
        ) : null}

        <TextInput
          label="Payroll note (optional)"
          value={payrollNote}
          onChange={(event) => setPayrollNote(event.currentTarget.value)}
          placeholder="Example: Weekly Managed Driver payroll"
        />

        {selectedPayments.length ? (
          <div className="sk-panel stack-md">
            <div className="skima-list-row">
              <div><strong>{selectedPayments.length} Driver{selectedPayments.length === 1 ? "" : "s"} selected</strong><span>Payment goes to SKIMA Wallets, not bank accounts.</span></div>
              <strong>{money(selectedTotal, selectedPayments[0].driver.currencyCode)}</strong>
            </div>
            {!confirming ? (
              <Button disabled={!canPay} onClick={() => setConfirming(true)}>Review payroll payment</Button>
            ) : (
              <div className="stack-md">
                <StatusBadge tone="warning">Confirm: this posts real wallet credits from SKIMA's settled Driver liability balance.</StatusBadge>
                <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
                  <Button variant="ghost" disabled={payBatch.isPending} onClick={() => setConfirming(false)}>Go back</Button>
                  <Button disabled={!canPay || payBatch.isPending} onClick={() => payBatch.mutate()}>{payBatch.isPending ? "Paying…" : `Pay ${money(selectedTotal, selectedPayments[0].driver.currencyCode)} to wallets`}</Button>
                </div>
              </div>
            )}
          </div>
        ) : null}
        {payBatch.error ? <ErrorState error={payBatch.error} /> : null}
      </section>

      <section className="sk-panel stack-md">
        <div className="section-heading"><div><span className="section-kicker">History</span><h2>Recent Driver wallet payments</h2></div></div>
        {payouts.error ? <ErrorState error={payouts.error} onRetry={() => void payouts.refetch()} /> : null}
        {payouts.data?.length ? payouts.data.slice(0, 20).map((payout) => (
          <div className="skima-list-row" key={payout.payoutId}>
            <div><strong>{payout.displayName}</strong><span>{payout.payoutReference} · {formatDate(payout.paidAt)}</span></div>
            <div><strong>{money(payout.amount, payout.currencyCode)}</strong><span>Paid to SKIMA Wallet</span></div>
          </div>
        )) : <p className="skima-muted">No Managed Driver wallet payment has been made yet.</p>}
      </section>
    </div>
  );
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}
