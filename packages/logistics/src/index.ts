/**
 * SKIMA Logistics shared domain contracts.
 *
 * These functions are client-safe previews/contract helpers only.
 * The backend policy resolver and financial ledger remain authoritative.
 */

export const LOGISTICS_MODULE_KEY = "logistics_network" as const;

export const LOGISTICS_PAYMENT_MODES = [
  "offline_provider",
  "skima_settlement",
] as const;

export type LogisticsPaymentMode = (typeof LOGISTICS_PAYMENT_MODES)[number];

export const LOGISTICS_JOB_STATUSES = [
  "draft",
  "open",
  "matching",
  "offers_received",
  "booking_pending",
  "booked",
  "assigned",
  "pickup_confirmed",
  "in_progress",
  "delivered",
  "completed",
  "cancelled",
  "disputed",
  "expired",
] as const;

export type LogisticsJobStatus = (typeof LOGISTICS_JOB_STATUSES)[number];

export const LOGISTICS_OFFER_STATUSES = [
  "submitted",
  "countered",
  "accepted",
  "rejected",
  "withdrawn",
  "expired",
] as const;

export type LogisticsOfferStatus = (typeof LOGISTICS_OFFER_STATUSES)[number];

export const LOGISTICS_PRICING_MODES = [
  "fixed",
  "distance",
  "weight",
  "time",
  "capacity",
  "negotiated",
  "quote_required",
  "hybrid",
] as const;

export type LogisticsPricingMode = (typeof LOGISTICS_PRICING_MODES)[number];

export interface LogisticsLocation {
  readonly geographyId?: string | null;
  readonly countryCode: string;
  readonly stateOrRegion?: string | null;
  readonly locality?: string | null;
  readonly address?: string | null;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly placeReference?: string | null;
}

export interface LogisticsServiceCapability {
  readonly serviceKey: string;
  readonly categoryKey: string;
  readonly capabilityKeys: readonly string[];
  readonly cargoTypes: readonly string[];
  readonly vehicleTypeKeys: readonly string[];
  readonly pricingModes: readonly LogisticsPricingMode[];
  readonly enabled: boolean;
}

export interface LogisticsProviderMatch {
  readonly jobId: string;
  readonly providerOrganizationId: string;
  readonly serviceKey: string;
  readonly eligibility: {
    readonly capabilityMatched: boolean;
    readonly pickupCovered: boolean;
    readonly destinationCovered: boolean;
    readonly capacityAvailable: boolean;
    readonly availableForRequestedWindow: boolean;
    readonly complianceSatisfied: boolean;
  };
  readonly ranking: {
    readonly distanceScore?: number;
    readonly capacityScore?: number;
    readonly serviceQualityScore?: number;
    readonly responseScore?: number;
    readonly explanation: readonly string[];
  };
}

export interface LogisticsOffer {
  readonly id: string;
  readonly jobId: string;
  readonly providerOrganizationId: string;
  readonly version: number;
  readonly status: LogisticsOfferStatus;
  readonly currencyCode: string;
  /** Amount in the currency's minor unit (NGN kobo, for example). */
  readonly deliveryPriceMinor: number;
  readonly estimatedDurationMinutes?: number | null;
  readonly validUntil?: string | null;
  readonly terms: Readonly<Record<string, unknown>>;
}

export interface LogisticsFeePolicySnapshot {
  readonly bookingFeeMinor: number;
  readonly providerReceivalFeeMinor: number;
  /** 1 basis point = 0.01%; 10,000 basis points = 100%. */
  readonly settlementCommissionBasisPoints: number;
  readonly bookingFeePolicyVersionId: string;
  readonly providerReceivalFeePolicyVersionId: string;
  readonly settlementCommissionPolicyVersionId: string;
}

export interface LogisticsFinancialBreakdown {
  readonly currencyCode: string;
  readonly paymentMode: LogisticsPaymentMode;
  readonly deliveryPriceMinor: number;
  readonly customerBookingFeeMinor: number;
  readonly providerReceivalFeeMinor: number;
  readonly settlementCommissionBasisPoints: number;
  readonly settlementCommissionMinor: number;
  readonly companyDeliveryProceedsMinor: number;
  readonly customerPaysThroughSkimaMinor: number;
  readonly customerPaysProviderOfflineMinor: number;
}

/**
 * Produces a display/acceptance preview from an already-resolved policy.
 * The server must independently resolve policy versions and recalculate
 * this breakdown before booking confirmation and ledger posting.
 */
export function calculateLogisticsFinancialBreakdown(input: {
  readonly currencyCode: string;
  readonly paymentMode: LogisticsPaymentMode;
  readonly deliveryPriceMinor: number;
  readonly policy: LogisticsFeePolicySnapshot;
}): LogisticsFinancialBreakdown {
  const { currencyCode, paymentMode, deliveryPriceMinor, policy } = input;

  if (!/^[A-Z0-9]{3,12}$/.test(currencyCode)) {
    throw new Error("A valid registered currency code is required.");
  }
  assertMinorAmount(deliveryPriceMinor, "deliveryPriceMinor");
  assertMinorAmount(policy.bookingFeeMinor, "bookingFeeMinor");
  assertMinorAmount(policy.providerReceivalFeeMinor, "providerReceivalFeeMinor");

  if (
    !Number.isInteger(policy.settlementCommissionBasisPoints) ||
    policy.settlementCommissionBasisPoints < 0 ||
    policy.settlementCommissionBasisPoints > 10_000
  ) {
    throw new Error("Settlement commission must be between 0 and 10,000 basis points.");
  }
  requirePolicyVersion(policy.bookingFeePolicyVersionId, "booking fee");

  const online = paymentMode === "skima_settlement";
  if (online) {
    requirePolicyVersion(policy.settlementCommissionPolicyVersionId, "settlement commission");
  } else {
    requirePolicyVersion(policy.providerReceivalFeePolicyVersionId, "provider receival fee");
  }
  const settlementCommissionMinor = online
    ? roundBasisPoints(deliveryPriceMinor, policy.settlementCommissionBasisPoints)
    : 0;
  const providerReceivalFeeMinor = online ? 0 : policy.providerReceivalFeeMinor;

  if (online && settlementCommissionMinor > deliveryPriceMinor) {
    throw new Error("Settlement commission cannot exceed the agreed delivery price.");
  }

  return {
    currencyCode,
    paymentMode,
    deliveryPriceMinor,
    customerBookingFeeMinor: policy.bookingFeeMinor,
    providerReceivalFeeMinor,
    settlementCommissionBasisPoints: online ? policy.settlementCommissionBasisPoints : 0,
    settlementCommissionMinor,
    companyDeliveryProceedsMinor: online
      ? deliveryPriceMinor - settlementCommissionMinor
      : deliveryPriceMinor,
    customerPaysThroughSkimaMinor: online
      ? deliveryPriceMinor + policy.bookingFeeMinor
      : policy.bookingFeeMinor,
    customerPaysProviderOfflineMinor: online ? 0 : deliveryPriceMinor,
  };
}

export function isProviderEligibleForLogisticsJob(
  match: LogisticsProviderMatch,
): boolean {
  const checks = match.eligibility;
  return checks.capabilityMatched &&
    checks.pickupCovered &&
    checks.destinationCovered &&
    checks.capacityAvailable &&
    checks.availableForRequestedWindow &&
    checks.complianceSatisfied;
}

function roundBasisPoints(amountMinor: number, basisPoints: number): number {
  // BigInt avoids precision loss in percentage fee calculations.
  const numerator = BigInt(amountMinor) * BigInt(basisPoints);
  return Number((numerator + 5_000n) / 10_000n);
}

function assertMinorAmount(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer in minor currency units.`);
  }
}

function requirePolicyVersion(value: string, label: string): void {
  if (!value || value.trim().length === 0) {
    throw new Error(`An active, approved ${label} policy version is required.`);
  }
}
