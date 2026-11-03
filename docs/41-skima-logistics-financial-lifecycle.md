# SKIMA Logistics Financial Lifecycle

**Status:** Agreed product rules; implementation contract  
**Parent:** [SKIMA Logistics Network — Architecture Foundation](40-skima-logistics-network-architecture.md)

## 1. Commercial rules

A logistics company can discover a qualified customer opportunity, view the full job details, access the customer's permitted contact information and submit/negotiation offers without paying an entry, lead or unlock fee.

No company fee is triggered by:
- A job being created or distributed.
- A provider viewing the opportunity.
- A provider viewing permitted customer contact details.
- A provider submitting a quote.
- A customer and provider exchanging counteroffers.

Fees begin only when the customer confirms a booking.

## 2. Configurable fee components

The SKIMA platform administrator controls fee policies through the existing governed, versioned financial-policy layer. The customer app and company app may display a fee calculation but never become the source of truth.

| Component | Payer | Trigger | Applies to |
|---|---|---|---|
| Customer booking fee | Customer | Booking confirmation | Both payment modes |
| Provider receival fee | Logistics company | Booking confirmation | Offline settlement only |
| Settlement commission | Logistics company | Successful online settlement after fulfilment | SKIMA-mediated settlement only |

Each fee policy must support explicit currency, fixed or percentage calculation as appropriate, effective dates, status, scope, minimum/maximum bounds where needed, approval/audit history and a version identifier. No missing policy may silently fall back to zero.

## 3. Offline settlement with logistics company

Example: customer and provider agree a delivery price of NGN 10,000.

1. Customer confirms the selected quote.
2. The backend revalidates the offer, provider eligibility and fee-policy versions.
3. The backend creates one booking and snapshots the delivery price, currency, customer booking fee, provider receival fee, payment mode and policy versions.
4. The customer is charged the configured booking fee through SKIMA.
5. The company receival fee is automatically posted by the financial runtime to the company's fee account and SKIMA's corresponding fee-revenue account. No manual "pay SKIMA" action is required from the company.
6. The company collects the NGN 10,000 delivery charge directly from the customer outside SKIMA and remains responsible for recording the job's payment/fulfilment evidence in the app.
7. SKIMA does not charge an online delivery settlement commission because it did not process the delivery payment.

### Provider fee collection policy

The provider receival fee must never be represented as paid if the company has no funds available. The implementation must use the existing wallet/ledger and an explicitly configured collection policy:

- Preferred: automatically debit the company's available platform balance at booking confirmation.
- If the company has insufficient available balance: create a clearly identified provider-fee receivable and recover it automatically from subsequent SKIMA-settled proceeds or permitted company wallet funding, subject to an administrator-controlled credit limit. When the limit is exceeded, block further offline bookings before confirmation.
- Never silently produce a negative wallet balance or allow an unbounded fee debt.

The company must see the applicable receival fee before accepting the booking, during onboarding and in its fee statement. No company action is needed to initiate the posting.

## 4. SKIMA-mediated settlement

Example: customer and provider agree a delivery price of NGN 10,000.

1. Customer confirms the selected quote.
2. The backend snapshots the agreed delivery amount, booking fee, commission policy/version and payment mode.
3. Customer pays the booking fee and funds the NGN 10,000 delivery amount through SKIMA's configured payment provider.
4. The delivery amount is reserved in the existing escrow/payment infrastructure. The booking is not marked funded until the provider/payment confirmation is verified.
5. The company fulfils the job. The system records pickup, progress and proof of delivery.
6. Once the customer confirms delivery (or a separately governed completion rule resolves the job), the backend calculates the commission from the snapshotted policy.
7. The backend posts the commission once and releases the remaining delivery proceeds to the company according to the approved settlement policy.
8. The offline provider receival fee is not charged on this booking.

The booking fee is separate from the delivery price and is not included in the percentage commission base unless a future, explicitly approved policy says otherwise.

## 5. Accounting invariants

- Every financial posting has a unique idempotency key derived from booking, event and fee type.
- Debits and credits are balanced and traceable to the booking and policy snapshot.
- Financial records are append-only; reversals use compensating entries.
- The accepted quote and its financial snapshot are immutable.
- A later fee-policy change affects future bookings only.
- A booking cannot use both offline provider receival fee and online settlement commission.
- A failed charge cannot be labelled collected.
- A refund or cancellation must reverse only the fee components allowed by the cancellation policy, through compensating ledger postings.
- Company dashboard totals are read models from the ledger, not locally calculated balances.

## 6. Required booking states

The exact status names must be reconciled with the existing workflow engine, but the lifecycle must represent at least:

- Quote accepted / booking confirmation pending.
- Booking confirmed.
- Booking fee pending / paid / failed / refunded.
- Provider fee pending / posted / receivable / recovered / reversed (offline only).
- Online delivery payment pending / funded / failed / refunded (SKIMA-mediated only).
- Assigned.
- Pickup confirmed.
- In progress.
- Delivered / awaiting confirmation.
- Completed.
- Disputed / cancelled.
- Settlement pending / posted / failed / reversed (SKIMA-mediated only).

Do not put every financial status into one overloaded booking status. Use dedicated payment/fee lifecycle records or a structured, auditable state model.

## 7. Required automated tests

1. Quote viewing and negotiation create no financial transaction.
2. Free opportunity/contact access does not create a financial transaction.
3. Offline booking posts the correct booking fee and provider receival fee once.
4. Replaying the booking-confirmation event does not duplicate either posting.
5. Offline booking never posts the online settlement commission.
6. SKIMA-mediated booking captures the booking fee and reserves the agreed amount.
7. Successful online fulfilment deducts the configured commission from the delivery amount and releases the net amount once.
8. Online booking never posts the offline provider receival fee.
9. Fee-policy changes after confirmation do not alter the saved fee amounts.
10. Insufficient provider funds follow the configured receivable/credit-limit policy.
11. Payment failure, cancellation, refund and dispute use balanced compensating entries.
12. A company cannot read another company's fee records or wallet details.
