import {
  calculateLogisticsFinancialBreakdown,
  isProviderEligibleForLogisticsJob,
  type LogisticsFeePolicySnapshot,
  type LogisticsProviderMatch,
} from "../packages/logistics/src/index.ts";

const policy: LogisticsFeePolicySnapshot = {
  bookingFeeMinor: 15_000,
  providerReceivalFeeMinor: 8_000,
  settlementCommissionBasisPoints: 500,
  bookingFeePolicyVersionId: "booking-v1",
  providerReceivalFeePolicyVersionId: "provider-v1",
  settlementCommissionPolicyVersionId: "commission-v1",
};

Deno.test("offline bookings charge both booking and provider receival fees, never settlement commission", () => {
  const result = calculateLogisticsFinancialBreakdown({
    currencyCode: "NGN",
    paymentMode: "offline_provider",
    deliveryPriceMinor: 1_000_000,
    policy,
  });

  if (result.customerBookingFeeMinor !== 15_000) throw new Error("Customer booking fee mismatch.");
  if (result.providerReceivalFeeMinor !== 8_000) throw new Error("Provider receival fee mismatch.");
  if (result.settlementCommissionMinor !== 0) throw new Error("Offline jobs must not incur settlement commission.");
  if (result.customerPaysThroughSkimaMinor !== 15_000) throw new Error("Offline customer should pay only the booking fee through SKIMA.");
  if (result.customerPaysProviderOfflineMinor !== 1_000_000) throw new Error("Offline delivery payment must remain with the provider.");
  if (result.companyDeliveryProceedsMinor !== 1_000_000) throw new Error("Offline company proceeds mismatch.");
});

Deno.test("SKIMA-settled bookings charge booking fee and commission, never provider receival fee", () => {
  const result = calculateLogisticsFinancialBreakdown({
    currencyCode: "NGN",
    paymentMode: "skima_settlement",
    deliveryPriceMinor: 1_000_000,
    policy,
  });

  if (result.customerBookingFeeMinor !== 15_000) throw new Error("Customer booking fee mismatch.");
  if (result.providerReceivalFeeMinor !== 0) throw new Error("Online jobs must not incur provider receival fee.");
  if (result.settlementCommissionMinor !== 50_000) throw new Error("Five percent commission mismatch.");
  if (result.companyDeliveryProceedsMinor !== 950_000) throw new Error("Net company proceeds mismatch.");
  if (result.customerPaysThroughSkimaMinor !== 1_015_000) throw new Error("Online customer total mismatch.");
  if (result.customerPaysProviderOfflineMinor !== 0) throw new Error("Online customer must not pay delivery separately offline.");
});

Deno.test("missing financial policy versions fail closed", () => {
  let rejected = false;
  try {
    calculateLogisticsFinancialBreakdown({
      currencyCode: "NGN",
      paymentMode: "offline_provider",
      deliveryPriceMinor: 100_000,
      policy: {
      ...policy,
      providerReceivalFeeMinor: undefined,
      providerReceivalFeePolicyVersionId: undefined,
    },
    });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Missing approved policy version must be rejected.");
});


Deno.test("each payment mode requires only the applicable provider fee policy", () => {
  const offline = calculateLogisticsFinancialBreakdown({
    currencyCode: "NGN",
    paymentMode: "offline_provider",
    deliveryPriceMinor: 100_000,
    policy: {
      ...policy,
      settlementCommissionBasisPoints: undefined,
      settlementCommissionPolicyVersionId: undefined,
    },
  });
  if (offline.settlementCommissionMinor !== 0) throw new Error("Offline commission must remain zero.");

  const online = calculateLogisticsFinancialBreakdown({
    currencyCode: "NGN",
    paymentMode: "skima_settlement",
    deliveryPriceMinor: 100_000,
    policy: { ...policy, providerReceivalFeePolicyVersionId: "" },
  });
  if (online.providerReceivalFeeMinor !== 0) throw new Error("Online provider receival fee must remain zero.");
});

Deno.test("fee calculation rejects floating amounts and invalid commission rates", () => {
  for (const input of [
    { deliveryPriceMinor: 10_000.5, policy },
    { deliveryPriceMinor: 10_000, policy: { ...policy, settlementCommissionBasisPoints: 10_001 } },
  ]) {
    let rejected = false;
    try {
      calculateLogisticsFinancialBreakdown({
        currencyCode: "NGN",
        paymentMode: "skima_settlement",
        ...input,
      });
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Invalid financial values must fail closed.");
  }
});

Deno.test("provider matches require every hard eligibility gate", () => {
  const eligible: LogisticsProviderMatch = {
    jobId: "job-1",
    providerOrganizationId: "org-1",
    serviceKey: "appliance.transport",
    eligibility: {
      capabilityMatched: true,
      pickupCovered: true,
      destinationCovered: true,
      capacityAvailable: true,
      availableForRequestedWindow: true,
      complianceSatisfied: true,
    },
    ranking: { explanation: ["Handles large appliances", "Covers both locations"] },
  };
  if (!isProviderEligibleForLogisticsJob(eligible)) throw new Error("Qualified provider should pass.");

  const notQualified = {
    ...eligible,
    eligibility: { ...eligible.eligibility, destinationCovered: false },
  };
  if (isProviderEligibleForLogisticsJob(notQualified)) throw new Error("Destination coverage is a hard eligibility gate.");
});
