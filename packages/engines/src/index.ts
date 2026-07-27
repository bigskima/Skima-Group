import { assertPlatformKey } from "../../core/src/index.ts";

export const CURRENCY_STATUSES = ["enabled", "disabled", "retired"] as const;
export type CurrencyStatus = (typeof CURRENCY_STATUSES)[number];

export const PRICING_MODES = [
  "fixed",
  "distance",
  "weight",
  "time",
  "dynamic",
  "negotiated",
  "quoted",
  "marketplace",
  "subscription",
  "hybrid",
  "ai_assisted",
  "manual",
] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

export const WALLET_TYPES = [
  "customer",
  "driver",
  "partner",
  "platform",
  "escrow",
  "commission",
  "refund",
  "bonus",
  "loyalty",
  "generic",
] as const;
export type WalletType = (typeof WALLET_TYPES)[number];

export const ENGINE_POLICY_STATUSES = ["draft", "active", "retired"] as const;
export type EnginePolicyStatus = (typeof ENGINE_POLICY_STATUSES)[number];

export const DISPATCH_REQUEST_STATUSES = [
  "pending",
  "matching",
  "assigned",
  "cancelled",
  "expired",
  "completed",
] as const;
export type DispatchRequestStatus = (typeof DISPATCH_REQUEST_STATUSES)[number];

export const TRACKING_SESSION_STATUSES = ["active", "paused", "completed", "cancelled"] as const;
export type TrackingSessionStatus = (typeof TRACKING_SESSION_STATUSES)[number];

export const NOTIFICATION_CHANNELS = [
  "push",
  "sms",
  "email",
  "whatsapp",
  "voice",
  "in_app",
  "future",
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const AI_TASK_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type AiTaskRunStatus = (typeof AI_TASK_RUN_STATUSES)[number];

export interface CurrencyDefinition {
  readonly code: string;
  readonly displayName: string;
  readonly decimalPlaces: number;
  readonly status: CurrencyStatus;
}

export interface EnginePolicy<TMode extends string = string> {
  readonly key: string;
  readonly displayName: string;
  readonly mode: TMode;
  readonly rules: Readonly<Record<string, unknown>>;
  readonly status: EnginePolicyStatus;
  readonly version: number;
}

export interface LedgerEntryDraft {
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: "debit" | "credit";
  readonly amount: string;
  readonly currencyCode: string;
  readonly entryType: "principal" | "fee" | "commission" | "tax" | "discount" | "adjustment";
  readonly idempotencyKey?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface FinancialPostingEntryDraft {
  readonly walletId: string;
  readonly direction: "debit" | "credit";
  readonly amount: string;
  readonly entryType?: LedgerEntryDraft["entryType"];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface FinancialPostingDraft {
  readonly transactionType:
    | "payment"
    | "transfer"
    | "hold"
    | "release"
    | "refund"
    | "commission"
    | "fee"
    | "adjustment";
  readonly currencyCode: string;
  readonly source: string;
  readonly subjectType: string;
  readonly subjectId?: string | null;
  readonly entries: readonly FinancialPostingEntryDraft[];
  readonly idempotencyKey: string;
  readonly providerAdapterId?: string | null;
  readonly externalReference?: string | null;
  readonly policySnapshot?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DispatchRequestDraft {
  readonly policyKey?: string | null;
  readonly source: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly requiredCapabilities?: Readonly<Record<string, unknown>>;
  readonly pickupLocation?: Readonly<Record<string, unknown>>;
  readonly dropoffLocation?: Readonly<Record<string, unknown>>;
  readonly priority?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
}

export interface TrackingPointDraft {
  readonly trackingSessionId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters?: number | null;
  readonly speedMetersPerSecond?: number | null;
  readonly headingDegrees?: number | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly recordedAt?: Date;
  readonly idempotencyKey: string;
}

export interface NotificationMessageDraft {
  readonly templateKey?: string | null;
  readonly channel: NotificationChannel;
  readonly recipientEntityType: string;
  readonly recipientEntityId?: string | null;
  readonly recipientAddress?: string | null;
  readonly providerAdapterId?: string | null;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly source: string;
  readonly idempotencyKey: string;
}

export interface AiTaskRunDraft {
  readonly taskKey: string;
  readonly source: string;
  readonly subjectType: string;
  readonly subjectId?: string | null;
  readonly input?: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
}

export function defineEnginePolicy<TMode extends string>(
  key: string,
  displayName: string,
  mode: TMode,
  rules: Readonly<Record<string, unknown>>,
  version = 1,
): EnginePolicy<TMode> {
  if (displayName.trim().length === 0) {
    throw new Error("displayName is required.");
  }

  if (version < 1) {
    throw new Error("version must be greater than zero.");
  }

  return {
    key: assertPlatformKey(key, "policyKey"),
    displayName,
    mode,
    rules: { ...rules },
    status: "draft",
    version,
  };
}

export function assertCurrencyCode(code: string): string {
  if (!/^[A-Z0-9]{3,12}$/.exec(code)) {
    throw new Error("currency code must be 3-12 uppercase letters or digits.");
  }

  return code;
}

export function assertPositiveAmount(amount: string): string {
  const value = Number(amount);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("amount must be greater than zero.");
  }

  return amount;
}

export function assertRequiredIdempotencyKey(value: string): string {
  if (value.trim().length === 0) {
    throw new Error("idempotencyKey is required.");
  }

  return value;
}

export function assertBalancedLedgerEntries(
  entries: readonly Pick<FinancialPostingEntryDraft, "amount" | "direction">[],
): void {
  if (entries.length < 2) {
    throw new Error("a financial posting requires at least two ledger entries.");
  }

  let debitTotal = 0n;
  let creditTotal = 0n;

  for (const entry of entries) {
    const amount = parseLedgerAmount(entry.amount);

    if (entry.direction === "debit") {
      debitTotal += amount;
    } else if (entry.direction === "credit") {
      creditTotal += amount;
    } else {
      throw new Error("ledger entry direction must be debit or credit.");
    }
  }

  if (debitTotal !== creditTotal) {
    throw new Error("financial posting ledger entries must balance.");
  }
}

function parseLedgerAmount(amount: string): bigint {
  const normalized = assertPositiveAmount(amount).trim();

  if (!/^\d+(\.\d{1,8})?$/.exec(normalized)) {
    throw new Error("amount must be a decimal string with up to 8 decimal places.");
  }

  const [whole, fraction = ""] = normalized.split(".");

  return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
}
