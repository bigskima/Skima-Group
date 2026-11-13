import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { z } from "zod";

import { Button, ErrorState, LoadingState, MetricTile, PageHeader, StatusBadge } from "@skima/ui";
import { createClientIdempotencyKey } from "@skima/frontend-core";
import { useSessionState } from "./session";
import "./profit-capital-workspace.css";

type Row = Readonly<Record<string, unknown>>;
type CategoryKey = "platform_expenses" | "vehicle_repayment" | "skima_savings" | "daily_expenses" | "staff_payment" | "investment_savings";
type RpcClient = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> };
const RecordSchema = z.record(z.string(), z.unknown());
const WorkspaceSchema = z.object({
  currencyCode: z.string().default("NGN"),
  templates: z.array(RecordSchema).default([]),
  participants: z.array(RecordSchema).default([]),
  vehicleAgreements: z.array(RecordSchema).default([]),
  distributions: z.array(RecordSchema).default([]),
});
type Workspace = z.infer<typeof WorkspaceSchema>;
const ExecutionSchema = z.object({
  currencyCode: z.string().default("NGN"),
  participants: z.array(RecordSchema).default([]),
  periodClosings: z.array(RecordSchema).default([]),
  schedules: z.array(RecordSchema).default([]),
  categoryAccounts: z.array(RecordSchema).default([]),
});
type ExecutionWorkspace = z.infer<typeof ExecutionSchema>;

const CATEGORIES: readonly { key: CategoryKey; label: string; description: string }[] = [
  { key: "platform_expenses", label: "Platform expenses", description: "General company operating costs" },
  { key: "vehicle_repayment", label: "Vehicle repayment", description: "Interest-free return of vehicle capital" },
  { key: "skima_savings", label: "SKIMA savings", description: "General company reserves" },
  { key: "daily_expenses", label: "Daily expenses", description: "Fuel, oil, maintenance and vehicle operations" },
  { key: "staff_payment", label: "Staff payment", description: "Staff compensation" },
  { key: "investment_savings", label: "Investment savings", description: "Funds reserved for future investments" },
];
const emptyPercentages: Record<CategoryKey, string> = {
  platform_expenses: "", vehicle_repayment: "", skima_savings: "",
  daily_expenses: "", staff_payment: "", investment_savings: "",
};

function value(row: Row | null | undefined, key: string, fallback = ""): string {
  const field = row?.[key];
  return typeof field === "string" && field.trim() ? field : fallback;
}
function numberValue(row: Row | null | undefined, key: string): number {
  const raw = row?.[key];
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
function records(raw: unknown): Row[] {
  return Array.isArray(raw) ? raw.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}
function money(amount: number, currency: string): string {
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return currency + " " + amount.toFixed(2); }
}
function dateLabel(raw: string): string {
  if (!raw) return "—";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" }).format(date);
}
function todayLocal(): string {
  const current = new Date();
  return new Date(current.getTime() - current.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
function categoryLabel(key: string): string {
  return CATEGORIES.find((category) => category.key === key)?.label ?? key.replace(/_/g, " ");
}
function Field(props: {
  label: string; value: string; onChange: (value: string) => void; type?: string;
  placeholder?: string; min?: string; max?: string; step?: string; required?: boolean;
}) {
  return <label className="skima-pc-field"><span>{props.label}</span><input
    type={props.type ?? "text"} value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)}
    placeholder={props.placeholder} min={props.min} max={props.max} step={props.step} required={props.required}
  /></label>;
}
function SelectField(props: {
  label: string; value: string; onChange: (value: string) => void;
  options: readonly { label: string; value: string }[];
}) {
  return <label className="skima-pc-field"><span>{props.label}</span><select value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)}>
    {props.options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
  </select></label>;
}
function Notice(props: { children: string; tone?: "success" | "warning" | "danger" }) {
  return <div className={"skima-pc-notice skima-pc-notice--" + (props.tone ?? "warning")} role="status">{props.children}</div>;
}
function Panel(props: { title: string; description: string; children: ReactNode }) {
  return <section className="sk-panel skima-pc-panel"><div className="sk-panel__header"><div><h2>{props.title}</h2><p className="skima-muted">{props.description}</p></div></div>{props.children}</section>;
}

export function AdminProfitCapitalWorkspace() {
  const { supabase, status, context } = useSessionState();
  const queryClient = useQueryClient();
  const rpc = supabase as unknown as RpcClient;
  const permissions = context?.permissions ?? [];
  const isSuperAdmin = context?.platformAdmin?.admin_kind === "super_admin";
  const canRead = isSuperAdmin || permissions.some((permission) => [
    "platform.profit_capital.read", "platform.profit_capital.manage", "platform.financial.read", "platform.financial.manage",
  ].includes(permission));
  const canManage = isSuperAdmin || permissions.includes("platform.profit_capital.manage") || permissions.includes("platform.financial.manage");

  const [currency, setCurrency] = useState("NGN");
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "warning" | "danger" } | null>(null);
  const [templateName, setTemplateName] = useState("SKIMA operating profit allocation");
  const [templateNotes, setTemplateNotes] = useState("");
  const [percentages, setPercentages] = useState<Record<CategoryKey, string>>(emptyPercentages);
  const [participantName, setParticipantName] = useState("");
  const [participantEmail, setParticipantEmail] = useState("");
  const [participantPhone, setParticipantPhone] = useState("");
  const [participantType, setParticipantType] = useState("profit_only");
  const [participantPercent, setParticipantPercent] = useState("0.1");
  const [fundingCategory, setFundingCategory] = useState<CategoryKey>("skima_savings");
  const [participantNotes, setParticipantNotes] = useState("");
  const [participantProfileId, setParticipantProfileId] = useState("");
  const [closeStart, setCloseStart] = useState(todayLocal());
  const [closeEnd, setCloseEnd] = useState(todayLocal());
  const [operatingExpenses, setOperatingExpenses] = useState("0");
  const [refundReserve, setRefundReserve] = useState("0");
  const [taxReserve, setTaxReserve] = useState("0");
  const [otherReserve, setOtherReserve] = useState("0");
  const [excludedCustomerFunds, setExcludedCustomerFunds] = useState("0");
  const [excludedSupplierFunds, setExcludedSupplierFunds] = useState("0");
  const [excludedEscrowFunds, setExcludedEscrowFunds] = useState("0");
  const [closeReference, setCloseReference] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [scheduleName, setScheduleName] = useState("SKIMA profit distribution");
  const [scheduleFrequency, setScheduleFrequency] = useState("monthly");
  const [scheduleStart, setScheduleStart] = useState(todayLocal());
  const [scheduleEnd, setScheduleEnd] = useState(todayLocal());
  const [scheduleNextRunAt, setScheduleNextRunAt] = useState(todayLocal() + "T09:00");
  const paymentAttempts = useRef<Record<string, { fingerprint: string; key: string }>>({});
  const [agreementParticipant, setAgreementParticipant] = useState("");
  const [vehicleDescription, setVehicleDescription] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [agreementReference, setAgreementReference] = useState("");
  const [principalAmount, setPrincipalAmount] = useState("");
  const [agreementNotes, setAgreementNotes] = useState("");
  const [selectedPeriodCloseId, setSelectedPeriodCloseId] = useState("");
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, { amount: string; transactionId: string; reference: string }>>({});
  const templateAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const participantAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const agreementAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const distributionAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const workspaceQuery = useQuery({
    queryKey: ["platform-profit-capital-workspace", currency],
    enabled: status === "authenticated" && canRead,
    retry: false,
    queryFn: async (): Promise<Workspace> => {
      const { data, error } = await rpc.rpc("read_platform_profit_capital_workspace", { target_currency_code: currency });
      if (error) throw new Error(error.message);
      return WorkspaceSchema.parse(data);
    },
  });
  const executionQuery = useQuery({
    queryKey: ["platform-profit-capital-execution-workspace", currency],
    enabled: status === "authenticated" && canRead,
    retry: false,
    queryFn: async (): Promise<ExecutionWorkspace> => {
      const { data, error } = await rpc.rpc("read_platform_profit_capital_execution_workspace", {
        target_currency_code: currency,
      });
      if (error) throw new Error(error.message);
      return ExecutionSchema.parse(data);
    },
  });
  const workspace = workspaceQuery.data;
  const execution = executionQuery.data;
  const templates = workspace?.templates ?? [];
  const participants = workspace?.participants ?? [];
  const agreements = workspace?.vehicleAgreements ?? [];
  const distributions = workspace?.distributions ?? [];
  const activeTemplate = templates.find((item) => value(item, "status") === "active") ?? null;
  const activeParticipants = participants.filter((item) => value(item, "status") === "active");
  const activeAgreements = agreements.filter((item) => value(item, "status") === "active");
  const outstandingPrincipal = activeAgreements.reduce((sum, item) => sum + numberValue(item, "outstandingPrincipal"), 0);
  const totalParticipation = activeParticipants.reduce((sum, item) => sum + numberValue(item, "profitSharePercent"), 0);
  const allocationTotal = CATEGORIES.reduce((sum, category) => sum + (Number(percentages[category.key]) || 0), 0);
  const distributionDrafts = distributions.filter((item) => value(item, "status") === "draft");
  const providerOptions = participants.filter((item) => ["vehicle_provider", "both"].includes(value(item, "participantType")) && value(item, "status") !== "closed");
  const executionParticipants = execution?.participants ?? [];
  const periodClosings = execution?.periodClosings ?? [];
  const schedules = execution?.schedules ?? [];
  const categoryAccounts = execution?.categoryAccounts ?? [];

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["platform-profit-capital-workspace"] });
    await queryClient.invalidateQueries({ queryKey: ["platform-profit-capital-execution-workspace"] });
    await queryClient.invalidateQueries({ queryKey: ["platform-financial-analytics"] });
  };
  const runRpc = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const { data, error } = await rpc.rpc(name, args);
    if (error) throw new Error(error.message);
    if (typeof data !== "string") throw new Error("The finance operation did not return its record reference.");
    return data;
  };

  const saveTemplate = useMutation({
    mutationFn: () => {
      const payload = {
        target_template_id: null,
        target_display_name: templateName.trim(),
        target_currency_code: currency,
        target_notes: templateNotes.trim() || null,
        target_lines: CATEGORIES.map((category) => ({ categoryKey: category.key, allocationPercent: Number(percentages[category.key]) })),
      };
      const fingerprint = JSON.stringify(payload);
      const key = templateAttempt.current?.fingerprint === fingerprint
        ? templateAttempt.current.key
        : createClientIdempotencyKey("admin.profit-capital.template", templateName.trim() + ":" + currency);
      templateAttempt.current = { fingerprint, key };
      return runRpc("save_platform_profit_allocation_template", { ...payload, target_idempotency_key: key });
    },
    onSuccess: async () => { templateAttempt.current = null; setNotice({ text: "Template saved as a draft. Activate it after checking all six percentages.", tone: "success" }); await refresh(); },
    onError: (error) => setNotice({ text: error instanceof Error ? error.message : "Template save failed.", tone: "danger" }),
  });
  const activateTemplate = useMutation({
    mutationFn: (id: string) => runRpc("activate_platform_profit_allocation_template", { target_template_id: id }),
    onSuccess: async () => { setNotice({ text: "Allocation template activated for " + currency + ".", tone: "success" }); await refresh(); },
    onError: (error) => setNotice({ text: error instanceof Error ? error.message : "Template activation failed.", tone: "danger" }),
  });

  const savePeriodClose = useMutation({
    mutationFn: () => runRpc("save_platform_profit_period_close", {
      target_currency_code: currency,
      target_period_start: closeStart,
      target_period_end: closeEnd,
      target_operating_expenses: Number(operatingExpenses),
      target_refund_chargeback_reserve: Number(refundReserve),
      target_tax_and_statutory_reserve: Number(taxReserve),
      target_other_reserves: Number(otherReserve),
      target_excluded_customer_collections: Number(excludedCustomerFunds),
      target_excluded_supplier_pass_through: Number(excludedSupplierFunds),
      target_excluded_escrow_and_unsettled_funds: Number(excludedEscrowFunds),
      target_reconciliation_reference: closeReference.trim(),
      target_idempotency_key: createClientIdempotencyKey("admin.profit-capital.period-close", currency + ":" + closeStart + ":" + closeEnd + ":" + closeReference.trim()),
      target_notes: closeNotes.trim() || null,
    }),
    onSuccess: async () => {
      setNotice({ text: "Period close saved as a draft using posted SKIMA platform-revenue ledger entries. A different Finance Admin must approve it.", tone: "success" });
      await refresh();
    },
    onError: (error) => setNotice({ text: error instanceof Error ? error.message : "Period close could not be saved.", tone: "danger" }),
  });
  const approvePeriodClose = useMutation({
    mutationFn: (id: string) => runRpc("approve_platform_profit_period_close", { target_close_id: id }),
    onSuccess: async () => {
      setNotice({ text: "Period close approved. A distribution can now be created from this reconciled close.", tone: "success" });
      await refresh();
    },
    onError: (error) => setNotice({ text: error instanceof Error ? error.message : "Period close approval failed.", tone: "danger" }),
  });
  const createSchedule = useMutation({
    mutationFn: () => {
      if (!activeTemplate) throw new Error("Activate an allocation template before creating a schedule.");
      return runRpc("save_platform_profit_distribution_schedule", {
        target_display_name: scheduleName.trim(),
        target_currency_code: currency,
        target_template_id: value(activeTemplate, "id"),
        target_frequency: scheduleFrequency,
        target_period_start: scheduleStart,
        target_period_end: scheduleEnd,
        target_next_run_at: new Date(scheduleNextRunAt).toISOString(),
        target_idempotency_key: createClientIdempotencyKey("admin.profit-capital.schedule", currency + ":" + scheduleName.trim() + ":" + scheduleStart + ":" + scheduleEnd),
        target_notes: "Scheduled calculation only. Every period still requires a separately approved Finance close.",
      });
    },
    onSuccess: async () => {
      setNotice({ text: "Recurring schedule saved. The runtime worker will create draft runs only after a matching approved period close exists.", tone: "success" });
      await refresh();
    },
    onError: (error) => setNotice({ text: error instanceof Error ? error.message : "The recurring schedule could not be saved.", tone: "danger" }),
  });
  const setScheduleStatus = useMutation({
    mutationFn: (input: { id: string; status: string }) => runRpc("set_platform_profit_distribution_schedule_status", {
      target_schedule_id: input.id,
      target_status: input.status,
    }),
    onSuccess: async () => { setNotice({ text: "Recurring schedule status updated.", tone: "success" }); await refresh(); },
    onError: (error) => setNotice({ text: error instanceof Error ? error.message : "Schedule status could not be updated.", tone: "danger" }),
  });
  const fundDistribution = useMutation({
    mutationFn: (id: string) => runRpc("fund_platform_profit_distribution", {
      target_distribution_id: id,
      target_idempotency_key: createClientIdempotencyKey("admin.profit-capital.funding", id),
    }),
    onSuccess: async () => { setNotice({ text: "Distribution funded from the SKIMA platform-revenue wallet into the six separate category wallets.", tone: "success" }); await refresh(); },
    onError: (error) => setNotice({ text: error instanceof Error ? error.message : "Distribution funding failed.", tone: "danger" }),
  });
  const payParticipantToWallet = useMutation({
    mutationFn: async (input: { entitlementId: string; amount: number }) => {
      const fingerprint = input.entitlementId + ":" + String(input.amount);
      const existing = paymentAttempts.current[input.entitlementId];
      const key = existing?.fingerprint === fingerprint
        ? existing.key
        : createClientIdempotencyKey("admin.profit-capital.participant-wallet-payout", fingerprint);
      paymentAttempts.current[input.entitlementId] = { fingerprint, key };
      const { data, error } = await rpc.rpc("pay_platform_profit_participant_entitlement_to_wallet", {
        target_entitlement_id: input.entitlementId,
        target_amount: input.amount,
        target_idempotency_key: key,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: async (_data, input) => {
      delete paymentAttempts.current[input.entitlementId];
      setNotice({ text: "Profit participation paid to the linked SKIMA wallet through a posted ledger transfer.", tone: "success" });
      await refresh();
    },
    onError: (error) => setNotice({ text: error instanceof Error ? error.message : "Wallet payout failed.", tone: "danger" }),
  });
  const payVehicleToWallet = useMutation({
    mutationFn: async (input: { repaymentId: string; amount: number }) => {
      const fingerprint = input.repaymentId + ":" + String(input.amount);
      const existing = paymentAttempts.current[input.repaymentId];
      const key = existing?.fingerprint === fingerprint
        ? existing.key
        : createClientIdempotencyKey("admin.profit-capital.vehicle-wallet-payout", fingerprint);
      paymentAttempts.current[input.repaymentId] = { fingerprint, key };
      const { data, error } = await rpc.rpc("pay_platform_vehicle_capital_repayment_to_wallet", {
        target_repayment_id: input.repaymentId,
        target_amount: input.amount,
        target_idempotency_key: key,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: async (_data, input) => {
      delete paymentAttempts.current[input.repaymentId];
      setNotice({ text: "Interest-free vehicle principal repaid to the linked SKIMA wallet through a posted ledger transfer.", tone: "success" });
      await refresh();
    },
    onError: (error) => setNotice({ text: error instanceof Error ? error.message : "Vehicle capital wallet payout failed.", tone: "danger" }),
  });

    const saveParticipant = useMutation({
    mutationFn: () => {
      const payload = {
        target_participant_id: null,
        target_display_name: participantName.trim(),
        target_participant_type: participantType,
        target_contact_email: participantEmail.trim() || null,
        target_contact_phone: participantPhone.trim() || null,
        target_currency_code: currency,
        target_profit_share_percent: Number(participantPercent),
        target_funding_category: fundingCategory,
        target_status: "active",
        target_notes: participantNotes.trim() || null,
      };
      const fingerprint = JSON.stringify(payload);
      const key = participantAttempt.current?.fingerprint === fingerprint
        ? participantAttempt.current.key
        : createClientIdempotencyKey("admin.profit-capital.participant", participantName.trim() + ":" + currency);
      participantAttempt.current = { fingerprint, key };
      return runRpc("save_platform_profit_participant", { ...payload, target_idempotency_key: key }).then(async (participantId) => {
        if (participantProfileId.trim()) {
          await runRpc("link_platform_profit_participant_profile", {
            target_participant_id: participantId,
            target_profile_id: participantProfileId.trim(),
          });
        }
        return participantId;
      });
    },
    onSuccess: async () => {
      participantAttempt.current = null;
      setParticipantName(""); setParticipantEmail(""); setParticipantPhone(""); setParticipantProfileId(""); setParticipantNotes("");
      setNotice({ text: "Participant saved. This is contractual profit participation, not an issued shareholding.", tone: "success" });
      await refresh();
    },
    onError: (error) => setNotice({ text: error instanceof Error ? error.message : "Participant save failed.", tone: "danger" }),
  });
  const saveAgreement = useMutation({
    mutationFn: () => {
      const payload = {
        target_agreement_id: null,
        target_participant_id: agreementParticipant,
        target_vehicle_description: vehicleDescription.trim(),
        target_registration_number: registrationNumber.trim() || null,
        target_agreement_reference: agreementReference.trim(),
        target_currency_code: currency,
        target_principal_amount: Number(principalAmount),
        target_status: "active",
        target_notes: agreementNotes.trim() || null,
      };
      const fingerprint = JSON.stringify(payload);
      const key = agreementAttempt.current?.fingerprint === fingerprint
        ? agreementAttempt.current.key
        : createClientIdempotencyKey("admin.profit-capital.vehicle-agreement", agreementReference.trim());
      agreementAttempt.current = { fingerprint, key };
      return runRpc("save_platform_vehicle_capital_agreement", { ...payload, target_idempotency_key: key });
    },
    onSuccess: async () => {
      agreementAttempt.current = null;
      setVehicleDescription(""); setRegistrationNumber(""); setAgreementReference(""); setPrincipalAmount(""); setAgreementNotes("");
      setNotice({ text: "Vehicle agreement saved. Principal only; interest is fixed at 0%.", tone: "success" });
      await refresh();
    },
    onError: (error) => setNotice({ text: error instanceof Error ? error.message : "Vehicle agreement save failed.", tone: "danger" }),
  });
  const createDistribution = useMutation({
    mutationFn: () => {
      const closeRecord = periodClosings.find((item) => value(item, "id") === selectedPeriodCloseId);
      if (!activeTemplate) throw new Error("Activate an allocation template before creating a distribution.");
      if (!closeRecord || value(closeRecord, "status") !== "approved") {
        throw new Error("Choose a Finance-approved period close before creating a distribution.");
      }
      if (!(numberValue(closeRecord, "distributableProfit") > 0)) {
        throw new Error("This approved close has no positive distributable profit.");
      }
      const fingerprint = selectedPeriodCloseId + ":" + value(activeTemplate, "id");
      const key = distributionAttempt.current?.fingerprint === fingerprint
        ? distributionAttempt.current.key
        : createClientIdempotencyKey("admin.profit-capital.distribution-from-close", fingerprint);
      distributionAttempt.current = { fingerprint, key };
      return runRpc("create_platform_profit_distribution_from_close", {
        target_template_id: value(activeTemplate, "id"),
        target_close_id: selectedPeriodCloseId,
        target_idempotency_key: key,
      });
    },
    onSuccess: async () => {
      distributionAttempt.current = null;
      setSelectedPeriodCloseId("");
      setNotice({ text: "Draft distribution calculated from the approved period close. Review all six categories and payable items before approval.", tone: "success" });
      await refresh();
    },
    onError: (error) => setNotice({ text: error instanceof Error ? error.message : "Distribution calculation failed.", tone: "danger" }),
  });
  const approveDistribution = useMutation({
    mutationFn: (id: string) => runRpc("approve_platform_profit_distribution", { target_distribution_id: id }),
    onSuccess: async () => { setNotice({ text: "Distribution approved. Payables can now be settled against posted ledger transfers.", tone: "success" }); await refresh(); },
    onError: (error) => setNotice({ text: error instanceof Error ? error.message : "Distribution approval failed.", tone: "danger" }),
  });
  const recordParticipantPayment = useMutation({
    mutationFn: (input: { id: string; amount: number; transactionId: string; reference: string }) => runRpc("record_platform_profit_participant_payment", {
      target_entitlement_id: input.id, target_amount: input.amount, target_financial_transaction_id: input.transactionId,
      target_external_reference: input.reference,
      target_idempotency_key: createClientIdempotencyKey("admin.profit-capital.participant-payment", input.id + ":" + input.transactionId),
    }),
    onSuccess: async () => { setNotice({ text: "Profit participation payment recorded against the posted ledger transaction.", tone: "success" }); await refresh(); },
    onError: (error) => setNotice({ text: error instanceof Error ? error.message : "Participant payment could not be recorded.", tone: "danger" }),
  });
  const recordVehiclePayment = useMutation({
    mutationFn: (input: { id: string; amount: number; transactionId: string; reference: string }) => runRpc("record_platform_vehicle_capital_repayment", {
      target_repayment_id: input.id, target_amount: input.amount, target_financial_transaction_id: input.transactionId,
      target_external_reference: input.reference,
      target_idempotency_key: createClientIdempotencyKey("admin.profit-capital.vehicle-payment", input.id + ":" + input.transactionId),
    }),
    onSuccess: async () => { setNotice({ text: "Vehicle principal repayment recorded. Outstanding principal has been reduced without interest.", tone: "success" }); await refresh(); },
    onError: (error) => setNotice({ text: error instanceof Error ? error.message : "Vehicle repayment could not be recorded.", tone: "danger" }),
  });

  const updatePaymentDraft = (id: string, field: "amount" | "transactionId" | "reference", next: string) => {
    setPaymentDrafts((current) => ({
      ...current,
      [id]: { amount: "", transactionId: "", reference: "", ...current[id], [field]: next },
    }));
  };
  const templateValid = CATEGORIES.every((category) =>
    percentages[category.key].trim() !== "" && Number.isFinite(Number(percentages[category.key]))
    && Number(percentages[category.key]) >= 0 && Number(percentages[category.key]) <= 100);
  const canSaveTemplate = canManage && templateName.trim().length >= 3 && templateValid && Math.abs(allocationTotal - 100) < 0.000001;
  const canSaveParticipant = canManage && participantName.trim().length >= 2
    && Number.isFinite(Number(participantPercent)) && Number(participantPercent) >= 0 && Number(participantPercent) <= 100
    && (participantType === "vehicle_provider" || Number(participantPercent) > 0);
  const canSaveAgreement = canManage && Boolean(agreementParticipant && vehicleDescription.trim() && agreementReference.trim())
    && Number.isFinite(Number(principalAmount)) && Number(principalAmount) > 0;
  const selectedClose = periodClosings.find((item) => value(item, "id") === selectedPeriodCloseId) ?? null;
  const canCreateDistribution = canManage && Boolean(activeTemplate && selectedClose)
    && value(selectedClose, "status") === "approved"
    && numberValue(selectedClose, "distributableProfit") > 0;
  const canSaveClose = canManage
    && Boolean(closeStart && closeEnd && closeEnd >= closeStart && closeReference.trim().length >= 3)
    && [operatingExpenses, refundReserve, taxReserve, otherReserve, excludedCustomerFunds, excludedSupplierFunds, excludedEscrowFunds]
      .every((v) => Number.isFinite(Number(v)) && Number(v) >= 0);
  const canSaveSchedule = canManage && Boolean(activeTemplate && scheduleName.trim().length >= 3
    && scheduleStart && scheduleEnd && scheduleEnd >= scheduleStart && scheduleNextRunAt)
    && new Date(scheduleNextRunAt).toString() !== "Invalid Date";

  if (status === "loading") {
    return <div className="skima-profit-capital"><LoadingState label="Loading profit and capital access…" /></div>;
  }
  if (!canRead) {
    return <div className="skima-profit-capital"><PageHeader eyebrow="Money · Capital" title="Profit & capital" description="Manage SKIMA profit allocations, participation and vehicle principal repayment." /><ErrorState title="Finance access required" message="This workspace is restricted to Admins with finance read or profit-capital access." /></div>;
  }
  if (workspaceQuery.isPending || executionQuery.isPending) {
    return <div className="skima-profit-capital"><LoadingState label="Loading profit and capital records…" /></div>;
  }
  if (workspaceQuery.error || executionQuery.error || !workspace || !execution) {
    const error = workspaceQuery.error ?? executionQuery.error;
    return <div className="skima-profit-capital"><PageHeader eyebrow="Money · Capital" title="Profit & capital" description="Manage SKIMA profit allocations, participation and vehicle principal repayment." /><ErrorState title="Profit and capital data unavailable" message={error instanceof Error ? error.message : "The workspace could not be loaded."} onRetry={() => { void workspaceQuery.refetch(); void executionQuery.refetch(); }} /></div>;
  }

  return (
    <div className="skima-profit-capital stack-lg">
      <PageHeader eyebrow="Money · Capital" title="Profit & capital"
        description="Configure company profit allocations, profit-only participation and interest-free vehicle capital repayment."
        actions={<Button variant="outline" onClick={() => void workspaceQuery.refetch()}>Refresh</Button>} />
      {!canManage ? <Notice tone="warning">Read-only access. A Finance Admin with management permission must create and approve records.</Notice> : null}
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      <div className="skima-pc-currency"><Field label="Currency" value={currency} onChange={(next) => setCurrency(next.toUpperCase())} placeholder="NGN" /></div>
      <div className="skima-grid skima-grid--compact">
        <MetricTile label="Active profit participants" value={activeParticipants.length.toLocaleString("en-NG")} />
        <MetricTile label="Combined profit participation" value={totalParticipation.toFixed(4) + "%"} />
        <MetricTile label="Active vehicle agreements" value={activeAgreements.length.toLocaleString("en-NG")} />
        <MetricTile label="Vehicle principal outstanding" value={money(outstandingPrincipal, currency)} />
      </div>

      <Panel title="Profit allocation templates" description="Create reusable templates. All six categories must total exactly 100% before activation.">
        <div className="skima-pc-form-grid">
          <Field label="Template name" value={templateName} onChange={setTemplateName} placeholder="Operating profit allocation" />
          <Field label="Notes" value={templateNotes} onChange={setTemplateNotes} placeholder="When this allocation applies" />
        </div>
        <div className="skima-pc-category-grid">
          {CATEGORIES.map((category) => <div className="skima-pc-category" key={category.key}>
            <div><strong>{category.label}</strong><small>{category.description}</small></div>
            <label><input aria-label={category.label + " percentage"} type="number" min="0" max="100" step="0.01"
              value={percentages[category.key]} onChange={(event) => setPercentages((current) => ({ ...current, [category.key]: event.currentTarget.value }))} /><span>%</span></label>
          </div>)}
        </div>
        <div className="skima-pc-total"><span>Allocation total</span><strong className={Math.abs(allocationTotal - 100) < 0.000001 ? "is-valid" : "is-invalid"}>{allocationTotal.toFixed(2)}%</strong><span>{Math.abs(allocationTotal - 100) < 0.000001 ? "Ready to save" : "Must total 100%"}</span></div>
        <div className="skima-pc-actions"><Button disabled={!canSaveTemplate || saveTemplate.isPending} isLoading={saveTemplate.isPending} onClick={() => saveTemplate.mutate()}>Save draft template</Button></div>
        <div className="skima-pc-table-wrap"><table className="skima-pc-table">
          <thead><tr><th>Template</th><th>Currency</th><th>Categories</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{templates.length === 0 ? <tr><td colSpan={5}>No templates created for this currency.</td></tr> : templates.map((item) => <tr key={value(item, "id")}>
            <td><strong>{value(item, "displayName")}</strong><small>{value(item, "notes")}</small></td><td>{value(item, "currencyCode")}</td><td>{records(item.lines).length}/6</td>
            <td><StatusBadge tone={value(item, "status") === "active" ? "success" : "neutral"}>{value(item, "status")}</StatusBadge></td>
            <td>{value(item, "status") === "draft" ? <Button size="sm" disabled={!canManage || activateTemplate.isPending} isLoading={activateTemplate.isPending} onClick={() => activateTemplate.mutate(value(item, "id"))}>Activate</Button> : value(item, "status") === "active" ? "Current template" : "Archived"}</td>
          </tr>)}</tbody>
        </table></div>
      </Panel>

      <Panel title="Financial period close & reconciliation" description="Net revenue is captured from posted SKIMA platform-revenue ledger entries only. Enter reconciled operating expenses and reserves; customer collections, supplier pass-through and escrow are recorded only as exclusions and are never added to the profit base.">
        <Notice tone="warning">The net platform-revenue figure is a ledger movement, not a bank-statement profit calculation. Reconcile the period and attach a finance report reference before approval. The creator cannot approve their own close unless they are Super Admin.</Notice>
        <div className="skima-pc-form-grid">
          <Field label="Period starts" value={closeStart} onChange={setCloseStart} type="date" />
          <Field label="Period ends" value={closeEnd} onChange={setCloseEnd} type="date" min={closeStart} />
          <Field label="Operating expenses" value={operatingExpenses} onChange={setOperatingExpenses} type="number" min="0" step="0.01" />
          <Field label="Refund & chargeback reserve" value={refundReserve} onChange={setRefundReserve} type="number" min="0" step="0.01" />
          <Field label="Tax & statutory reserve" value={taxReserve} onChange={setTaxReserve} type="number" min="0" step="0.01" />
          <Field label="Other approved reserves" value={otherReserve} onChange={setOtherReserve} type="number" min="0" step="0.01" />
          <Field label="Customer collections excluded (reference only)" value={excludedCustomerFunds} onChange={setExcludedCustomerFunds} type="number" min="0" step="0.01" />
          <Field label="Supplier pass-through excluded (reference only)" value={excludedSupplierFunds} onChange={setExcludedSupplierFunds} type="number" min="0" step="0.01" />
          <Field label="Escrow & unsettled funds excluded (reference only)" value={excludedEscrowFunds} onChange={setExcludedEscrowFunds} type="number" min="0" step="0.01" />
          <Field label="Finance reconciliation reference (required)" value={closeReference} onChange={setCloseReference} placeholder="Approved P&L, settlement report or ledger close ID" required />
          <Field label="Close notes (optional)" value={closeNotes} onChange={setCloseNotes} placeholder="Period-end notes" />
        </div>
        <div className="skima-pc-actions">
          <Button disabled={!canSaveClose || savePeriodClose.isPending} isLoading={savePeriodClose.isPending} onClick={() => savePeriodClose.mutate()}>Capture draft period close</Button>
        </div>
        <div className="skima-pc-table-wrap"><table className="skima-pc-table">
          <thead><tr><th>Period</th><th>Posted platform revenue</th><th>Expenses & reserves</th><th>Distributable profit</th><th>Reconciliation</th><th>Status / approval</th></tr></thead>
          <tbody>{periodClosings.length === 0 ? <tr><td colSpan={6}>No period closes recorded for this currency.</td></tr> : periodClosings.map((close) => <tr key={value(close, "id")}>
            <td><strong>{dateLabel(value(close, "periodStart"))} – {dateLabel(value(close, "periodEnd"))}</strong></td>
            <td>{money(numberValue(close, "netPlatformRevenue"), currency)}</td>
            <td>{money(numberValue(close, "operatingExpenses") + numberValue(close, "refundChargebackReserve") + numberValue(close, "taxAndStatutoryReserve") + numberValue(close, "otherReserves"), currency)}</td>
            <td><strong>{money(numberValue(close, "distributableProfit"), currency)}</strong></td>
            <td><small>{value(close, "reconciliationReference")}</small></td>
            <td><div className="skima-pc-status-actions"><StatusBadge tone={value(close, "status") === "approved" ? "success" : value(close, "status") === "rejected" ? "danger" : "neutral"}>{value(close, "status")}</StatusBadge>
              {value(close, "status") === "draft" ? <Button size="sm" disabled={!canManage || approvePeriodClose.isPending} isLoading={approvePeriodClose.isPending} onClick={() => approvePeriodClose.mutate(value(close, "id"))}>Approve</Button> : null}</div>
            </td>
          </tr>)}</tbody>
        </table></div>
      </Panel>

      <Panel title="Recurring distribution schedule" description="Schedules prepare a draft distribution when the matching period close has been separately approved. They never auto-approve or automatically pay a participant.">
        <Notice tone="warning">A schedule cannot turn an unclosed accounting period into profit. Finance must approve each matching period close first; the worker then creates a reviewable draft for Finance.</Notice>
        <div className="skima-pc-form-grid">
          <Field label="Schedule name" value={scheduleName} onChange={setScheduleName} placeholder="Monthly SKIMA operating profit" />
          <SelectField label="Frequency" value={scheduleFrequency} onChange={setScheduleFrequency} options={[
            { label: "Weekly", value: "weekly" },
            { label: "Fortnightly", value: "fortnightly" },
            { label: "Monthly", value: "monthly" },
            { label: "Quarterly", value: "quarterly" },
          ]} />
          <Field label="First period starts" value={scheduleStart} onChange={setScheduleStart} type="date" />
          <Field label="First period ends" value={scheduleEnd} onChange={setScheduleEnd} type="date" min={scheduleStart} />
          <Field label="First run at" value={scheduleNextRunAt} onChange={setScheduleNextRunAt} type="datetime-local" />
          <Field label="Active allocation template" value={activeTemplate ? value(activeTemplate, "displayName") : "No active template"} onChange={() => undefined} disabled />
        </div>
        <div className="skima-pc-actions">
          <Button disabled={!canSaveSchedule || createSchedule.isPending} isLoading={createSchedule.isPending} onClick={() => createSchedule.mutate()}>Save recurring schedule</Button>
        </div>
        <div className="skima-pc-table-wrap"><table className="skima-pc-table">
          <thead><tr><th>Schedule</th><th>Cadence</th><th>Next period</th><th>Next run</th><th>Last result</th><th>Status / control</th></tr></thead>
          <tbody>{schedules.length === 0 ? <tr><td colSpan={6}>No recurring schedules configured.</td></tr> : schedules.map((schedule) => <tr key={value(schedule, "id")}>
            <td><strong>{value(schedule, "displayName")}</strong><small>{value(schedule, "currencyCode")}</small></td>
            <td>{value(schedule, "frequency")}</td>
            <td>{dateLabel(value(schedule, "periodStart"))} – {dateLabel(value(schedule, "periodEnd"))}</td>
            <td>{dateLabel(value(schedule, "nextRunAt"))}</td>
            <td><small>{value(schedule, "lastError") || (value(schedule, "lastDistributionId") ? "Draft created" : "Awaiting approved close")}</small></td>
            <td><div className="skima-pc-status-actions"><StatusBadge tone={value(schedule, "status") === "active" ? "success" : "neutral"}>{value(schedule, "status")}</StatusBadge>
              {value(schedule, "status") !== "completed" ? <Button size="sm" variant="outline" disabled={!canManage || setScheduleStatus.isPending} isLoading={setScheduleStatus.isPending} onClick={() => setScheduleStatus.mutate({ id: value(schedule, "id"), status: value(schedule, "status") === "active" ? "paused" : "active" })}>{value(schedule, "status") === "active" ? "Pause" : "Resume"}</Button> : null}</div></td>
          </tr>)}</tbody>
        </table></div>
      </Panel>

      <Panel title="Segregated profit category wallets" description="These are distinct internal ledger accounts funded from the platform-revenue wallet after an approved distribution. Customer balances, escrow and supplier float are not used.">
        <div className="skima-pc-table-wrap"><table className="skima-pc-table">
          <thead><tr><th>Allocation category</th><th>Wallet</th><th>Available balance</th><th>Currency</th></tr></thead>
          <tbody>{CATEGORIES.map((category) => {
            const account = categoryAccounts.find((item) => value(item, "categoryKey") === category.key);
            return <tr key={category.key}>
              <td><strong>{category.label}</strong></td>
              <td><small>{value(account, "walletId") ? value(account, "walletId") : "Created during first funded distribution"}</small></td>
              <td>{money(numberValue(account, "balance"), currency)}</td>
              <td>{value(account, "currencyCode", currency)}</td>
            </tr>;
          })}</tbody>
        </table></div>
        <Notice tone="warning">Category wallets are internal accounting balances. Beneficiary payouts in this release transfer into a linked SKIMA customer wallet; external bank payout rails are not represented as completed here.</Notice>
      </Panel>

      <Panel title="Profit participation register" description="These are contractual profit entitlements, not legal shares. The percentage is calculated from each approved distributable-profit amount.">
        <div className="skima-pc-form-grid">
          <Field label="Beneficiary name" value={participantName} onChange={setParticipantName} placeholder="Person or legal entity" />
          <SelectField label="Arrangement" value={participantType} onChange={setParticipantType} options={[
            { label: "Profit participation only", value: "profit_only" },
            { label: "Vehicle provider only", value: "vehicle_provider" },
            { label: "Vehicle provider + profit participation", value: "both" },
          ]} />
          <Field label="Profit participation (%)" value={participantPercent} onChange={setParticipantPercent} type="number" min="0" max="100" step="0.0001" />
          <SelectField label="Pay from allocation category" value={fundingCategory} onChange={(next) => setFundingCategory(next as CategoryKey)} options={CATEGORIES.map((item) => ({ label: item.label, value: item.key }))} />
          <Field label="Linked SKIMA profile UUID (optional)" value={participantProfileId} onChange={setParticipantProfileId} placeholder="Enables automatic internal wallet payout" />
          <Field label="Email (optional)" value={participantEmail} onChange={setParticipantEmail} type="email" placeholder="beneficiary@example.com" />
          <Field label="Phone (optional)" value={participantPhone} onChange={setParticipantPhone} placeholder="Phone number" />
          <Field label="Agreement note" value={participantNotes} onChange={setParticipantNotes} placeholder="Signed agreement reference / terms" />
        </div>
        <div className="skima-pc-actions"><Button disabled={!canSaveParticipant || saveParticipant.isPending} isLoading={saveParticipant.isPending} onClick={() => saveParticipant.mutate()}>Add participant</Button></div>
        <div className="skima-pc-table-wrap"><table className="skima-pc-table">
          <thead><tr><th>Beneficiary</th><th>Arrangement</th><th>Profit rate</th><th>Funding category</th><th>Status</th></tr></thead>
          <tbody>{participants.length === 0 ? <tr><td colSpan={5}>No profit participants registered.</td></tr> : participants.map((item) => <tr key={value(item, "id")}>
            <td><strong>{value(item, "displayName")}</strong><small>{value(item, "contactEmail") || value(item, "contactPhone")}</small></td>
            <td>{value(item, "participantType").replace(/_/g, " ")}</td><td>{numberValue(item, "profitSharePercent").toFixed(4)}%</td>
            <td>{categoryLabel(value(item, "fundingCategory"))}</td><td><StatusBadge tone={value(item, "status") === "active" ? "success" : "neutral"}>{value(item, "status")}</StatusBadge></td>
          </tr>)}</tbody>
        </table></div>
      </Panel>

      <Panel title="Vehicle capital agreements" description="Register the verified vehicle purchase principal and the provider. Repayment is capped at original principal with no interest.">
        <div className="skima-pc-form-grid">
          <SelectField label="Vehicle capital provider" value={agreementParticipant} onChange={setAgreementParticipant} options={[
            { label: "Choose provider", value: "" },
            ...providerOptions.map((item) => ({ label: value(item, "displayName"), value: value(item, "id") })),
          ]} />
          <Field label="Vehicle description" value={vehicleDescription} onChange={setVehicleDescription} placeholder="Toyota Sienna delivery van" />
          <Field label="Registration number (optional)" value={registrationNumber} onChange={setRegistrationNumber} placeholder="Vehicle registration" />
          <Field label="Agreement reference" value={agreementReference} onChange={setAgreementReference} placeholder="SKIMA-VEH-2026-001" />
          <Field label={"Original principal (" + currency + ")"} value={principalAmount} onChange={setPrincipalAmount} type="number" min="0.01" step="0.01" />
          <Field label="Agreement notes" value={agreementNotes} onChange={setAgreementNotes} placeholder="Purchase invoice / handover reference" />
        </div>
        <div className="skima-pc-actions"><Button disabled={!canSaveAgreement || saveAgreement.isPending} isLoading={saveAgreement.isPending} onClick={() => saveAgreement.mutate()}>Save vehicle agreement</Button><span className="skima-muted">Interest rate: 0% · Payback cap: original principal</span></div>
        <div className="skima-pc-table-wrap"><table className="skima-pc-table">
          <thead><tr><th>Provider / vehicle</th><th>Agreement</th><th>Principal</th><th>Repaid</th><th>Outstanding</th><th>Status</th></tr></thead>
          <tbody>{agreements.length === 0 ? <tr><td colSpan={6}>No vehicle capital agreements recorded.</td></tr> : agreements.map((item) => <tr key={value(item, "id")}>
            <td><strong>{value(item, "participantName")}</strong><small>{value(item, "vehicleDescription")} · {value(item, "registrationNumber", "Registration pending")}</small></td>
            <td>{value(item, "agreementReference")}</td><td>{money(numberValue(item, "principalAmount"), currency)}</td>
            <td>{money(numberValue(item, "principalRepaid"), currency)}</td><td><strong>{money(numberValue(item, "outstandingPrincipal"), currency)}</strong></td>
            <td><StatusBadge tone={value(item, "status") === "fully_repaid" ? "success" : value(item, "status") === "active" ? "neutral" : "warning"}>{value(item, "status").replace(/_/g, " ")}</StatusBadge></td>
          </tr>)}</tbody>
        </table></div>
      </Panel>

      <Panel title="Create a distribution from an approved close" description="The distributable amount comes from the approved period close, not a manually typed figure. Customer collections, supplier funds, escrow and other liabilities are excluded from the revenue base.">
        <div className="skima-pc-form-grid">
          <SelectField label="Finance-approved period close" value={selectedPeriodCloseId} onChange={setSelectedPeriodCloseId} options={[
            { label: "Choose an approved period close", value: "" },
            ...periodClosings.filter((item) => value(item, "status") === "approved" && numberValue(item, "distributableProfit") > 0).map((item) => ({
              label: dateLabel(value(item, "periodStart")) + " – " + dateLabel(value(item, "periodEnd")) + " · " + money(numberValue(item, "distributableProfit"), currency),
              value: value(item, "id"),
            })),
          ]} />
          <Field label="Allocation template" value={activeTemplate ? value(activeTemplate, "displayName") : "No active template"} onChange={() => undefined} disabled />
        </div>
        {selectedClose ? <Notice tone="success">Approved distributable profit: {money(numberValue(selectedClose, "distributableProfit"), currency)} · Reconciliation: {value(selectedClose, "reconciliationReference")}</Notice> : <Notice tone="warning">Select an approved period close with positive distributable profit. Draft and unapproved closes cannot be distributed.</Notice>}
        {!activeTemplate ? <Notice tone="warning">Activate an allocation template for {currency} before creating the distribution.</Notice> : null}
        <div className="skima-pc-actions"><Button disabled={!canCreateDistribution || createDistribution.isPending} isLoading={createDistribution.isPending} onClick={() => createDistribution.mutate()}>Calculate draft from approved close</Button>{distributionDrafts.length ? <span className="skima-muted">{distributionDrafts.length} draft(s) await review.</span> : null}</div>
      </Panel>

      <Panel title="Distribution history and payment records" description="Review the saved allocation snapshot, participant entitlements and vehicle principal repayments. Approval does not itself send money. A payment is recorded only after a matching posted ledger transfer exists.">
        <div className="skima-pc-distributions">
          {distributions.length === 0 ? <div className="skima-pc-empty">No distribution runs created yet.</div> : distributions.map((distribution) => {
            const id = value(distribution, "id");
            const entitlements = records(distribution.participantEntitlements);
            const repayments = records(distribution.vehicleRepayments);
            const allocations = records(distribution.allocations);
            const distributionStatus = value(distribution, "status");
            const funded = value(distribution, "executionStatus") === "funded";
            const approved = (distributionStatus === "approved" || distributionStatus === "completed") && funded;
            return <article className="skima-pc-distribution" key={id}>
              <div className="skima-pc-distribution-head">
                <div><strong>{dateLabel(value(distribution, "periodStart"))} – {dateLabel(value(distribution, "periodEnd"))}</strong>
                  <small>Profit basis: {money(numberValue(distribution, "distributableProfit"), currency)} · Created {dateLabel(value(distribution, "createdAt"))}</small></div>
                <div className="skima-pc-status-actions">
                  <StatusBadge tone={distributionStatus === "completed" ? "success" : distributionStatus === "approved" ? "warning" : "neutral"}>{distributionStatus}</StatusBadge>
                  <StatusBadge tone={funded ? "success" : "neutral"}>{funded ? "funded" : "unfunded"}</StatusBadge>
                  {distributionStatus === "draft" ? <Button size="sm" disabled={!canManage || approveDistribution.isPending} isLoading={approveDistribution.isPending} onClick={() => approveDistribution.mutate(id)}>Approve run</Button> : null}
                  {distributionStatus === "approved" && !funded ? <Button size="sm" disabled={!canManage || fundDistribution.isPending} isLoading={fundDistribution.isPending} onClick={() => fundDistribution.mutate(id)}>Fund six category wallets</Button> : null}
                </div>
                {funded ? <small>Funding ledger transaction: {value(distribution, "fundingTransactionId")}</small> : null}
              </div>
              <div className="skima-pc-allocation-grid">{allocations.map((allocation) => <div key={value(allocation, "categoryKey")}>
                <span>{categoryLabel(value(allocation, "categoryKey"))}</span><strong>{money(numberValue(allocation, "allocatedAmount"), currency)}</strong>
                <small>{numberValue(allocation, "allocationPercent").toFixed(2)}% · {money(numberValue(allocation, "uncommittedAmount"), currency)} uncommitted</small>
              </div>)}</div>
              {entitlements.length ? <div className="skima-pc-subsection"><h3>Profit participation payables</h3><div className="skima-pc-table-wrap"><table className="skima-pc-table">
                <thead><tr><th>Beneficiary</th><th>Rate</th><th>Entitlement</th><th>Paid</th><th>Outstanding</th><th>Record payment</th></tr></thead>
                <tbody>{entitlements.map((item) => {
                  const itemId = value(item, "id");
                  const draft = paymentDrafts[itemId] ?? { amount: value(item, "outstandingAmount"), transactionId: "", reference: "" };
                  const linkedParticipant = executionParticipants.find((participant) => value(participant, "id") === value(item, "participantId"));
                  const profileId = value(linkedParticipant, "profileId");
                  return <tr key={itemId}><td><strong>{value(item, "participantName")}</strong><small>{categoryLabel(value(item, "fundingCategory"))}{profileId ? " · SKIMA wallet linked" : " · No SKIMA wallet linked"}</small></td>
                    <td>{numberValue(item, "sharePercent").toFixed(4)}%</td><td>{money(numberValue(item, "entitlementAmount"), currency)}</td>
                    <td>{money(numberValue(item, "paidAmount"), currency)}</td><td>{money(numberValue(item, "outstandingAmount"), currency)}</td>
                    <td>{["paid", "cancelled"].includes(value(item, "status")) ? <StatusBadge tone="success">{value(item, "status")}</StatusBadge> :
                      <div className="skima-pc-payment-fields">
                        {profileId ? <Button size="sm" disabled={!canManage || !approved || !(Number(draft.amount) > 0) || payParticipantToWallet.isPending}
                          isLoading={payParticipantToWallet.isPending} onClick={() => payParticipantToWallet.mutate({ entitlementId: itemId, amount: Number(draft.amount) })}>Pay to SKIMA wallet</Button> : null}
                        <input aria-label="External payment amount" type="number" min="0.01" max={numberValue(item, "outstandingAmount")} step="0.01" value={draft.amount} onChange={(event) => updatePaymentDraft(itemId, "amount", event.currentTarget.value)} />
                        <input aria-label="Posted ledger transaction ID" value={draft.transactionId} onChange={(event) => updatePaymentDraft(itemId, "transactionId", event.currentTarget.value)} placeholder="Posted transaction UUID" />
                        <input aria-label="Transfer reference" value={draft.reference} onChange={(event) => updatePaymentDraft(itemId, "reference", event.currentTarget.value)} placeholder="Transfer reference" />
                        <Button size="sm" disabled={!canManage || !approved || !(Number(draft.amount) > 0) || draft.transactionId.trim().length < 20 || draft.reference.trim().length < 3 || recordParticipantPayment.isPending}
                          isLoading={recordParticipantPayment.isPending} onClick={() => recordParticipantPayment.mutate({ id: itemId, amount: Number(draft.amount), transactionId: draft.transactionId.trim(), reference: draft.reference.trim() })}>Record external transfer</Button>
                      </div>}</td>
                  </tr>;
                })}</tbody>
              </table></div></div> : null}
              {repayments.length ? <div className="skima-pc-subsection"><h3>Vehicle principal repayments · 0% interest</h3><div className="skima-pc-table-wrap"><table className="skima-pc-table">
                <thead><tr><th>Provider / vehicle</th><th>Principal allocation</th><th>Paid</th><th>Due</th><th>Record principal payment</th></tr></thead>
                <tbody>{repayments.map((item) => {
                  const itemId = value(item, "id");
                  const draft = paymentDrafts[itemId] ?? { amount: value(item, "outstandingAmount"), transactionId: "", reference: "" };
                  const agreement = agreements.find((candidate) => value(candidate, "id") === value(item, "agreementId"));
                  const participantId = value(agreement, "participantId");
                  const linkedParticipant = executionParticipants.find((participant) => value(participant, "id") === participantId);
                  const profileId = value(linkedParticipant, "profileId");
                  return <tr key={itemId}><td><strong>{value(item, "participantName")}</strong><small>{value(item, "vehicleDescription")}{profileId ? " · SKIMA wallet linked" : " · No SKIMA wallet linked"}</small></td>
                    <td>{money(numberValue(item, "principalAmount"), currency)}</td><td>{money(numberValue(item, "paidAmount"), currency)}</td><td>{money(numberValue(item, "outstandingAmount"), currency)}</td>
                    <td>{["paid", "cancelled"].includes(value(item, "status")) ? <StatusBadge tone="success">{value(item, "status")}</StatusBadge> :
                      <div className="skima-pc-payment-fields">
                        {profileId ? <Button size="sm" disabled={!canManage || !approved || !(Number(draft.amount) > 0) || payVehicleToWallet.isPending}
                          isLoading={payVehicleToWallet.isPending} onClick={() => payVehicleToWallet.mutate({ repaymentId: itemId, amount: Number(draft.amount) })}>Pay principal to SKIMA wallet</Button> : null}
                        <input aria-label="Principal payment amount" type="number" min="0.01" max={numberValue(item, "outstandingAmount")} step="0.01" value={draft.amount} onChange={(event) => updatePaymentDraft(itemId, "amount", event.currentTarget.value)} />
                        <input aria-label="Posted ledger transaction ID" value={draft.transactionId} onChange={(event) => updatePaymentDraft(itemId, "transactionId", event.currentTarget.value)} placeholder="Posted transaction UUID" />
                        <input aria-label="Transfer reference" value={draft.reference} onChange={(event) => updatePaymentDraft(itemId, "reference", event.currentTarget.value)} placeholder="Transfer reference" />
                        <Button size="sm" disabled={!canManage || !approved || !(Number(draft.amount) > 0) || draft.transactionId.trim().length < 20 || draft.reference.trim().length < 3 || recordVehiclePayment.isPending}
                          isLoading={recordVehiclePayment.isPending} onClick={() => recordVehiclePayment.mutate({ id: itemId, amount: Number(draft.amount), transactionId: draft.transactionId.trim(), reference: draft.reference.trim() })}>Record external principal transfer</Button>
                      </div>}</td>
                  </tr>;
                })}</tbody>
              </table></div></div> : null}
            </article>;
          })}
        </div>
      </Panel>
    </div>
  );
}
