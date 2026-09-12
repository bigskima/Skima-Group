import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleDollarSign,
  Landmark,
  RefreshCcw,
  Settings2,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import {
  Button,
  DataTable,
  ErrorState,
  LoadingState,
  MetricTile,
  StatusBadge,
  type TableColumn,
} from "@skima/ui";

import { useSessionState } from "../../session";
import { AdminV2PageHeader } from "../../shared/patterns/AdminV2Patterns";
import {
  MoneyRowsSchema,
  type MoneyRow,
  currency,
  firstText,
  formatDate,
  formatMajorMoney,
  formatMinorMoney,
  formatMoneyBreakdown,
  friendly,
  numberValue,
  readError,
  rowId,
  shortReference,
  statusTone,
  text,
  walletLabel,
} from "./money-v2-shared";

const ADVANCED_FINANCE_PATH = "/money/balances/advanced";

export function MoneyBalancesScreenV2(props: { readonly onNavigate: (href: string) => void }) {
  const { api, status } = useSessionState();
  const client = useQueryClient();
  const enabled = status === "authenticated";

  const wallets = useQuery({
    queryKey: ["money-v2", "wallets"],
    queryFn: () => api.get("/runtime/wallets", MoneyRowsSchema),
    enabled,
  });
  const balances = useQuery({
    queryKey: ["money-v2", "balances"],
    queryFn: () => api.get("/runtime/wallet-balances", MoneyRowsSchema),
    enabled,
  });
  const deposits = useQuery({
    queryKey: ["money-v2", "deposits"],
    queryFn: () => api.get("/runtime/payments/deposits", MoneyRowsSchema),
    enabled,
  });
  const events = useQuery({
    queryKey: ["money-v2", "payment-events"],
    queryFn: () => api.get("/runtime/payment-webhook-events", MoneyRowsSchema),
    enabled,
    retry: false,
  });

  const refresh = async () => client.invalidateQueries({ queryKey: ["money-v2"] });
  const blockingError = wallets.error ?? balances.error ?? deposits.error;
  if (wallets.isLoading || balances.isLoading || deposits.isLoading) {
    return <LoadingState label="Loading balances and deposits" />;
  }
  if (blockingError) {
    return (
      <ErrorState
        title="Balances & deposits unavailable"
        message={readError(blockingError)}
        onRetry={() => void refresh()}
      />
    );
  }

  const walletRows = wallets.data ?? [];
  const balanceRows = balances.data ?? [];
  const depositRows = deposits.data ?? [];
  const eventRows = events.data ?? [];
  const walletMap = new Map(walletRows.map((row) => [text(row, "id"), row]));
  const reservedEntries = balanceRows.filter((row) => numberValue(row, "reserved_balance_minor") > 0).length;

  const walletColumns: TableColumn<MoneyRow>[] = [
    {
      key: "wallet",
      header: "Wallet",
      render: (row) => (
        <>
          <strong>{walletLabel(row)}</strong>
          <br />
          <small>{friendly(text(row, "status") || "configured")}</small>
        </>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const value = text(row, "status") || "configured";
        return <StatusBadge tone={statusTone(value)}>{friendly(value)}</StatusBadge>;
      },
    },
    { key: "currency", header: "Currency", render: (row) => currency(row) },
  ];
  const balanceColumns: TableColumn<MoneyRow>[] = [
    {
      key: "wallet",
      header: "Wallet",
      render: (row) => walletLabel(walletMap.get(text(row, "wallet_id"))),
    },
    {
      key: "available",
      header: "Available",
      render: (row) => (
        <strong>{formatMinorMoney(numberValue(row, "available_balance_minor"), currency(row))}</strong>
      ),
    },
    {
      key: "reserved",
      header: "Reserved",
      render: (row) => formatMinorMoney(numberValue(row, "reserved_balance_minor"), currency(row)),
    },
    { key: "currency", header: "Currency", render: (row) => currency(row) },
  ];
  const depositColumns: TableColumn<MoneyRow>[] = [
    {
      key: "reference",
      header: "Deposit",
      render: (row) => (
        <>
          <strong>{shortReference(firstText(row, ["public_reference", "provider_reference", "reference"]))}</strong>
          <br />
          <small>{walletLabel(walletMap.get(text(row, "wallet_id")))}</small>
        </>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      render: (row) => formatMajorMoney(numberValue(row, "amount"), currency(row)),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const value = text(row, "status") || "pending";
        return <StatusBadge tone={statusTone(value)}>{friendly(value)}</StatusBadge>;
      },
    },
    {
      key: "updated",
      header: "Updated",
      render: (row) => formatDate(firstText(row, ["updated_at", "created_at"])),
    },
  ];

  return (
    <div className="money-v2">
      <AdminV2PageHeader
        eyebrow="Money · Balances"
        title="Balances & deposits"
        description="Review wallet balances and incoming funding without exposing internal wallet IDs or mixing in withdrawal and settlement actions."
        actions={
          <>
            <Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button>
            <Button
              icon={Settings2}
              variant="outline"
              requiredPermission="platform.financial.manage"
              onClick={() => props.onNavigate(ADVANCED_FINANCE_PATH)}
            >
              Advanced finance tools
            </Button>
          </>
        }
      />
      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Wallets" value={walletRows.length} icon={WalletCards} tone="info" />
        <MetricTile
          label="Available"
          value={formatMoneyBreakdown(balanceRows, "available_balance_minor", "minor")}
          icon={CircleDollarSign}
          tone="success"
        />
        <MetricTile
          label="Reserved"
          value={formatMoneyBreakdown(balanceRows, "reserved_balance_minor", "minor")}
          icon={ShieldCheck}
          tone={reservedEntries ? "warning" : "neutral"}
        />
        <MetricTile label="Recent deposits" value={depositRows.length} icon={Landmark} />
      </section>
      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <h2>Wallet balances</h2>
            <p className="skima-muted">Available and reserved money remain separated because reserved funds may still belong to an active payment or escrow flow.</p>
          </div>
        </div>
        <DataTable
          caption="Wallet balances"
          columns={balanceColumns}
          records={balanceRows}
          getRowKey={rowId}
          emptyTitle="No wallet balances"
          emptyMessage="Wallet balances will appear after wallets are initialized."
        />
      </section>
      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <h2>Recent deposits</h2>
            <p className="skima-muted">Provider references are shortened in the normal view. Verification and bank-transfer configuration remain under Advanced finance tools.</p>
          </div>
          <StatusBadge>{eventRows.length} payment events</StatusBadge>
        </div>
        <DataTable
          caption="Recent deposits"
          columns={depositColumns}
          records={depositRows.slice(0, 100)}
          getRowKey={rowId}
          emptyTitle="No deposits"
          emptyMessage="Incoming wallet funding will appear here."
        />
      </section>
      <details className="money-v2__advanced">
        <summary>Wallet directory</summary>
        <DataTable
          caption="Wallet directory"
          columns={walletColumns}
          records={walletRows}
          getRowKey={rowId}
          emptyTitle="No wallets"
          emptyMessage="No wallets are available."
        />
      </details>
    </div>
  );
}

export function MoneyWithdrawalsScreenV2(props: { readonly onNavigate: (href: string) => void }) {
  const { api, status } = useSessionState();
  const client = useQueryClient();
  const enabled = status === "authenticated";

  const beneficiaries = useQuery({
    queryKey: ["money-v2", "beneficiaries"],
    queryFn: () => api.get("/runtime/withdrawal-beneficiaries", MoneyRowsSchema),
    enabled,
  });
  const withdrawals = useQuery({
    queryKey: ["money-v2", "withdrawals"],
    queryFn: () => api.get("/runtime/withdrawals", MoneyRowsSchema),
    enabled,
  });
  const transfers = useQuery({
    queryKey: ["money-v2", "transfers"],
    queryFn: () => api.get("/runtime/withdrawals/transfers", MoneyRowsSchema),
    enabled,
  });

  const refresh = async () => client.invalidateQueries({ queryKey: ["money-v2"] });
  const blockingError = beneficiaries.error ?? withdrawals.error ?? transfers.error;
  if (beneficiaries.isLoading || withdrawals.isLoading || transfers.isLoading) {
    return <LoadingState label="Loading withdrawals" />;
  }
  if (blockingError) {
    return <ErrorState title="Withdrawals unavailable" message={readError(blockingError)} onRetry={() => void refresh()} />;
  }

  const beneficiaryRows = beneficiaries.data ?? [];
  const withdrawalRows = withdrawals.data ?? [];
  const transferRows = transfers.data ?? [];
  const beneficiaryMap = new Map(beneficiaryRows.map((row) => [text(row, "id"), row]));
  const transferByWithdrawal = new Map(transferRows.map((row) => [text(row, "withdrawal_request_id"), row]));
  const pending = withdrawalRows.filter((row) => ["pending", "requested", "awaiting_approval"].includes(text(row, "status"))).length;
  const failed = transferRows.filter((row) => ["failed", "rejected", "reversed"].includes(text(row, "status"))).length;

  const withdrawalColumns: TableColumn<MoneyRow>[] = [
    {
      key: "request",
      header: "Withdrawal",
      render: (row) => {
        const beneficiary = beneficiaryMap.get(firstText(row, ["beneficiary_id", "withdrawal_beneficiary_id"]));
        return (
          <>
            <strong>{formatMajorMoney(numberValue(row, "amount"), currency(row))}</strong>
            <br />
            <small>{beneficiary ? firstText(beneficiary, ["account_name", "display_name"]) || "Bank beneficiary" : "Bank beneficiary"}</small>
          </>
        );
      },
    },
    {
      key: "fee",
      header: "Fee",
      render: (row) => formatMajorMoney(numberValue(row, "fee_amount"), currency(row)),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const value = text(row, "status") || "pending";
        return <StatusBadge tone={statusTone(value)}>{friendly(value)}</StatusBadge>;
      },
    },
    {
      key: "transfer",
      header: "Provider result",
      render: (row) => {
        const transfer = transferByWithdrawal.get(text(row, "id"));
        if (!transfer) return "Not sent yet";
        const value = text(transfer, "status") || "processing";
        return (
          <>
            <StatusBadge tone={statusTone(value)}>{friendly(value)}</StatusBadge>
            <br />
            <small>{shortReference(text(transfer, "provider_reference"))}</small>
          </>
        );
      },
    },
  ];

  return (
    <div className="money-v2">
      <AdminV2PageHeader
        eyebrow="Money · Withdrawals"
        title="Withdrawals"
        description="Review withdrawal requests and provider transfer outcomes. Approvals, bank-account setup and manual provider-result recording stay in Advanced finance tools."
        actions={
          <>
            <Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button>
            <Button
              icon={Settings2}
              variant="outline"
              requiredPermission="platform.financial.manage"
              onClick={() => props.onNavigate(ADVANCED_FINANCE_PATH)}
            >
              Advanced finance tools
            </Button>
          </>
        }
      />
      <section className="skima-grid skima-grid--compact">
        <MetricTile label="Requests" value={withdrawalRows.length} icon={Landmark} tone="info" />
        <MetricTile label="Awaiting approval" value={pending} icon={ShieldCheck} tone={pending ? "warning" : "success"} />
        <MetricTile label="Beneficiaries" value={beneficiaryRows.length} icon={WalletCards} />
        <MetricTile label="Failed transfers" value={failed} icon={CircleDollarSign} tone={failed ? "warning" : "success"} />
      </section>
      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <h2>Withdrawal queue</h2>
            <p className="skima-muted">This routine view is intentionally read-focused. Approval and transfer-result commands remain protected in Advanced finance tools.</p>
          </div>
        </div>
        <DataTable
          caption="Withdrawal requests"
          columns={withdrawalColumns}
          records={withdrawalRows}
          getRowKey={rowId}
          emptyTitle="No withdrawals"
          emptyMessage="Withdrawal requests will appear here."
        />
      </section>
    </div>
  );
}

export function MoneySettlementsScreenV2(props: { readonly onNavigate: (href: string) => void }) {
  const { api, status } = useSessionState();
  const client = useQueryClient();
  const enabled = status === "authenticated";

  const commissions = useQuery({
    queryKey: ["money-v2", "commissions"],
    queryFn: () => api.get("/runtime/commission-executions", MoneyRowsSchema),
    enabled,
  });
  const settlements = useQuery({
    queryKey: ["money-v2", "settlements"],
    queryFn: () => api.get("/runtime/settlement-statements", MoneyRowsSchema),
    enabled,
  });
  const refresh = async () => client.invalidateQueries({ queryKey: ["money-v2"] });
  const blockingError = commissions.error ?? settlements.error;
  if (commissions.isLoading || settlements.isLoading) {
    return <LoadingState label="Loading settlements and escrow" />;
  }
  if (blockingError) {
    return <ErrorState title="Settlements unavailable" message={readError(blockingError)} onRetry={() => void refresh()} />;
  }

  const commissionRows = commissions.data ?? [];
  const settlementRows = settlements.data ?? [];
  const pendingSettlements = settlementRows.filter((row) => !["settled", "completed", "paid"].includes(text(row, "status"))).length;
  const pendingCommissions = commissionRows.filter((row) => !["completed", "paid", "settled"].includes(text(row, "status"))).length;

  const settlementColumns: TableColumn<MoneyRow>[] = [
    {
      key: "statement",
      header: "Settlement",
      render: (row) => (
        <>
          <strong>{shortReference(firstText(row, ["public_reference", "reference", "id"]))}</strong>
          <br />
          <small>{friendly(firstText(row, ["organization_display_name", "organization_name", "scope_type"]) || "Business settlement")}</small>
        </>
      ),
    },
    {
      key: "gross",
      header: "Gross",
      render: (row) => formatMajorMoney(numberValue(row, "gross_amount"), currency(row)),
    },
    {
      key: "net",
      header: "Net",
      render: (row) => <strong>{formatMajorMoney(numberValue(row, "net_amount"), currency(row))}</strong>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const value = text(row, "status") || "pending";
        return <StatusBadge tone={statusTone(value)}>{friendly(value)}</StatusBadge>;
      },
    },
    {
      key: "updated",
      header: "Updated",
      render: (row) => formatDate(firstText(row, ["updated_at", "created_at"])),
    },
  ];
  const commissionColumns: TableColumn<MoneyRow>[] = [
    {
      key: "commission",
      header: "Driver commission",
      render: (row) => (
        <>
          <strong>{formatMajorMoney(numberValue(row, "amount"), currency(row))}</strong>
          <br />
          <small>Order {shortReference(text(row, "order_id"))}</small>
        </>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const value = text(row, "status") || "pending";
        return <StatusBadge tone={statusTone(value)}>{friendly(value)}</StatusBadge>;
      },
    },
    {
      key: "updated",
      header: "Updated",
      render: (row) => formatDate(firstText(row, ["updated_at", "created_at"])),
    },
  ];

  return (
    <div className="money-v2">
      <AdminV2PageHeader
        eyebrow="Money · Settlements"
        title="Settlements & escrow"
        description="Review business settlements and driver commissions in a safe operational view. Escrow release, refund, manual status changes and reconciliation remain protected in Advanced finance tools."
        actions={
          <>
            <Button icon={RefreshCcw} variant="outline" onClick={() => void refresh()}>Refresh</Button>
            <Button
              icon={Settings2}
              variant="outline"
              requiredPermission="platform.financial.manage"
              onClick={() => props.onNavigate(ADVANCED_FINANCE_PATH)}
            >
              Advanced finance tools
            </Button>
          </>
        }
      />
      <section className="skima-grid skima-grid--compact">
        <MetricTile
          label="Gross settlement"
          value={formatMoneyBreakdown(settlementRows, "gross_amount", "major")}
          icon={CircleDollarSign}
          tone="info"
        />
        <MetricTile
          label="Net settlement"
          value={formatMoneyBreakdown(settlementRows, "net_amount", "major")}
          icon={Landmark}
          tone="success"
        />
        <MetricTile label="Pending settlements" value={pendingSettlements} icon={ShieldCheck} tone={pendingSettlements ? "warning" : "success"} />
        <MetricTile label="Pending commissions" value={pendingCommissions} icon={WalletCards} tone={pendingCommissions ? "warning" : "success"} />
      </section>
      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <h2>Settlement statements</h2>
            <p className="skima-muted">Statements are shown separately from actions that move money.</p>
          </div>
        </div>
        <DataTable
          caption="Settlement statements"
          columns={settlementColumns}
          records={settlementRows}
          getRowKey={rowId}
          emptyTitle="No settlement statements"
          emptyMessage="Settlement statements will appear after governed settlement runs."
        />
      </section>
      <section className="sk-panel">
        <div className="sk-panel__header">
          <div>
            <h2>Driver commissions</h2>
            <p className="skima-muted">Commission execution remains tied to the authoritative order and escrow workflow.</p>
          </div>
        </div>
        <DataTable
          caption="Driver commissions"
          columns={commissionColumns}
          records={commissionRows.slice(0, 100)}
          getRowKey={rowId}
          emptyTitle="No commission executions"
          emptyMessage="Driver commission records will appear after eligible order completion."
        />
      </section>
    </div>
  );
}
