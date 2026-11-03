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

export interface LogisticsCompanyProfile {
  readonly organizationId: string;
  readonly displayName: string;
  readonly verificationStatus: "pending" | "verified" | "rejected" | "suspended";
  readonly operationalStatus: "active" | "paused" | "closed";
  readonly serviceKeys: readonly string[];
  readonly coveredGeographyIds: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface LogisticsJobRequest {
  readonly id: string;
  readonly requesterUserId: string;
  readonly serviceCategoryKey: string;
  readonly requestedServiceKey: string;
  readonly description: string;
  readonly pickup: LogisticsLocation;
  readonly destination: LogisticsLocation;
  readonly cargo: {
    readonly cargoTypeKeys: readonly string[];
    readonly quantity?: number | null;
    readonly weightKg?: number | null;
    readonly volumeM3?: number | null;
    readonly dimensionsCm?: Readonly<{ length: number; width: number; height: number }> | null;
    readonly handlingRequirements: readonly string[];
  };
  readonly requestedPickupAt?: string | null;
  readonly status: LogisticsJobStatus;
  readonly createdAt: string;
}

export interface LogisticsBookingCommercialSnapshot {
  readonly bookingId: string;
  readonly jobId: string;
  readonly acceptedOfferId: string;
  readonly providerOrganizationId: string;
  readonly paymentMode: LogisticsPaymentMode;
  readonly currencyCode: string;
  readonly deliveryPriceMinor: number;
  readonly financial: LogisticsFinancialBreakdown;
  readonly feePolicy: LogisticsFeePolicySnapshot;
  readonly confirmedAt: string;
}

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
  readonly providerReceivalFeeMinor?: number;
  /** 1 basis point = 0.01%; 10,000 basis points = 100%. */
  readonly settlementCommissionBasisPoints?: number;
  readonly bookingFeePolicyVersionId: string;
  readonly providerReceivalFeePolicyVersionId?: string;
  readonly settlementCommissionPolicyVersionId?: string;
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

const JOB_STATUS_TRANSITIONS: Readonly<Record<LogisticsJobStatus, readonly LogisticsJobStatus[]>> = {
  draft: ["open", "cancelled"],
  open: ["matching", "offers_received", "cancelled", "expired"],
  matching: ["offers_received", "cancelled", "expired"],
  offers_received: ["matching", "booking_pending", "cancelled", "expired"],
  booking_pending: ["booked", "offers_received", "cancelled", "expired"],
  booked: ["assigned", "cancelled", "disputed"],
  assigned: ["pickup_confirmed", "cancelled", "disputed"],
  pickup_confirmed: ["in_progress", "cancelled", "disputed"],
  in_progress: ["delivered", "disputed"],
  delivered: ["completed", "disputed"],
  completed: [],
  cancelled: [],
  disputed: ["completed", "cancelled"],
  expired: [],
};

/**
 * UI/domain guard for displaying an allowed transition.
 * The authoritative workflow engine must re-check actor permissions,
 * concurrency and state inside a database transaction.
 */
export function canTransitionLogisticsJobStatus(
  current: LogisticsJobStatus,
  next: LogisticsJobStatus,
): boolean {
  return JOB_STATUS_TRANSITIONS[current].includes(next);
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

  if (!LOGISTICS_PAYMENT_MODES.includes(paymentMode)) {
    throw new Error("A supported logistics payment mode is required.");
  }
  if (!/^[A-Z0-9]{3,12}$/.test(currencyCode)) {
    throw new Error("A valid currency code format is required.");
  }
  assertMinorAmount(deliveryPriceMinor, "deliveryPriceMinor");
  assertMinorAmount(policy.bookingFeeMinor, "bookingFeeMinor");
  requirePolicyVersion(policy.bookingFeePolicyVersionId, "booking fee");

  const online = paymentMode === "skima_settlement";
  let settlementCommissionBasisPoints = 0;
  let settlementCommissionMinor = 0;
  let providerReceivalFeeMinor = 0;

  if (online) {
    const configuredBasisPoints = policy.settlementCommissionBasisPoints;
    if (
      configuredBasisPoints === undefined ||
      !Number.isInteger(configuredBasisPoints) ||
      configuredBasisPoints < 0 ||
      configuredBasisPoints > 10_000
    ) {
      throw new Error("Settlement commission must be configured between 0 and 10,000 basis points.");
    }
    requirePolicyVersion(policy.settlementCommissionPolicyVersionId, "settlement commission");
    settlementCommissionBasisPoints = configuredBasisPoints;
    settlementCommissionMinor = roundBasisPoints(deliveryPriceMinor, configuredBasisPoints);
  } else {
    if (policy.providerReceivalFeeMinor === undefined) {
      throw new Error("Provider receival fee must be explicitly configured for offline bookings.");
    }
    assertMinorAmount(policy.providerReceivalFeeMinor, "providerReceivalFeeMinor");
    requirePolicyVersion(policy.providerReceivalFeePolicyVersionId, "provider receival fee");
    providerReceivalFeeMinor = policy.providerReceivalFeeMinor;
  }

  if (online && settlementCommissionMinor > deliveryPriceMinor) {
    throw new Error("Settlement commission cannot exceed the agreed delivery price.");
  }

  return {
    currencyCode,
    paymentMode,
    deliveryPriceMinor,
    customerBookingFeeMinor: policy.bookingFeeMinor,
    providerReceivalFeeMinor,
    settlementCommissionBasisPoints,
    settlementCommissionMinor,
    companyDeliveryProceedsMinor: online
      ? deliveryPriceMinor - settlementCommissionMinor
      : deliveryPriceMinor,
    customerPaysThroughSkimaMinor: safeMinorSum(
      online ? deliveryPriceMinor : 0,
      policy.bookingFeeMinor,
    ),
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

function safeMinorSum(left: number, right: number): number {
  const total = BigInt(left) + BigInt(right);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Combined customer payment exceeds the safe minor-unit range.");
  }
  return Number(total);
}

function assertMinorAmount(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer in minor currency units.`);
  }
}

function requirePolicyVersion(value: string | undefined, label: string): void {
  if (!value || value.trim().length === 0) {
    throw new Error(`An active, approved ${label} policy version is required.`);
  }
}
