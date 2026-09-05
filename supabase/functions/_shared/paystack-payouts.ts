export interface PaystackBank {
  readonly name: string;
  readonly code: string;
  readonly slug: string | null;
  readonly type: string | null;
  readonly country: string | null;
  readonly currency: string | null;
}

export interface ResolvedPaystackBankAccount {
  readonly accountName: string;
  readonly accountNumber: string;
  readonly bankCode: string;
}

export interface PaystackTransferRecipient {
  readonly recipientCode: string;
  readonly recipientId: string | number | null;
  readonly accountName: string;
  readonly accountNumber: string;
  readonly bankCode: string;
}

export interface PaystackBalance {
  readonly currency: string;
  readonly balanceMinor: number;
  readonly balance: number;
}

export interface PaystackTransferResult {
  readonly providerReference: string;
  readonly providerStatus: "processing" | "succeeded";
  readonly rawStatus: string | null;
  readonly response: Record<string, unknown>;
}

export class PaystackPayoutError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

type Fetcher = typeof fetch;

export async function listPaystackBanks(
  secretKey: string,
  fetcher: Fetcher = fetch,
): Promise<readonly PaystackBank[]> {
  const url = new URL("https://api.paystack.co/bank");
  url.searchParams.set("country", "nigeria");
  url.searchParams.set("currency", "NGN");
  url.searchParams.set("type", "nuban");
  url.searchParams.set("perPage", "100");

  const body = await paystackRequest(secretKey, url, { method: "GET" }, fetcher);
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows.flatMap((value): PaystackBank[] => {
    const row = record(value);
    const name = text(row.name);
    const code = text(row.code);
    if (!name || !code) return [];
    return [{
      name,
      code,
      slug: text(row.slug),
      type: text(row.type),
      country: text(row.country),
      currency: text(row.currency),
    }];
  }).sort((left, right) => left.name.localeCompare(right.name));
}

export async function resolvePaystackBankAccount(
  secretKey: string,
  accountNumber: string,
  bankCode: string,
  fetcher: Fetcher = fetch,
): Promise<ResolvedPaystackBankAccount> {
  const normalizedAccount = accountNumber.trim();
  const normalizedBank = bankCode.trim();
  if (!/^\d{10}$/.test(normalizedAccount)) {
    throw new PaystackPayoutError(
      "invalid_account_number",
      "Enter a valid 10-digit Nigerian bank account number.",
      400,
    );
  }
  if (!normalizedBank) {
    throw new PaystackPayoutError("bank_required", "Select a bank first.", 400);
  }

  const url = new URL("https://api.paystack.co/bank/resolve");
  url.searchParams.set("account_number", normalizedAccount);
  url.searchParams.set("bank_code", normalizedBank);
  const body = await paystackRequest(secretKey, url, { method: "GET" }, fetcher);
  const data = record(body.data);
  const accountName = text(data.account_name);
  const resolvedNumber = text(data.account_number) ?? normalizedAccount;
  if (!accountName) {
    throw new PaystackPayoutError(
      "bank_account_resolution_failed",
      "The bank account name could not be confirmed.",
    );
  }

  return {
    accountName,
    accountNumber: resolvedNumber,
    bankCode: normalizedBank,
  };
}

export async function createPaystackTransferRecipient(
  secretKey: string,
  account: ResolvedPaystackBankAccount,
  fetcher: Fetcher = fetch,
): Promise<PaystackTransferRecipient> {
  const body = await paystackRequest(
    secretKey,
    new URL("https://api.paystack.co/transferrecipient"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "nuban",
        name: account.accountName,
        account_number: account.accountNumber,
        bank_code: account.bankCode,
        currency: "NGN",
      }),
    },
    fetcher,
  );
  const data = record(body.data);
  const recipientCode = text(data.recipient_code);
  if (!recipientCode) {
    throw new PaystackPayoutError(
      "transfer_recipient_failed",
      "The payout account could not be prepared for transfers.",
    );
  }

  return {
    recipientCode,
    recipientId: typeof data.id === "string" || typeof data.id === "number" ? data.id : null,
    accountName: account.accountName,
    accountNumber: account.accountNumber,
    bankCode: account.bankCode,
  };
}

export async function readPaystackBalances(
  secretKey: string,
  fetcher: Fetcher = fetch,
): Promise<readonly PaystackBalance[]> {
  const body = await paystackRequest(
    secretKey,
    new URL("https://api.paystack.co/balance"),
    { method: "GET" },
    fetcher,
  );
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows.flatMap((value): PaystackBalance[] => {
    const row = record(value);
    const currency = (text(row.currency) ?? "").toUpperCase();
    const balanceMinor = numberValue(row.balance);
    if (!currency || balanceMinor === null) return [];
    return [{
      currency,
      balanceMinor,
      balance: balanceMinor / 100,
    }];
  });
}

export async function initiatePaystackTransfer(
  secretKey: string,
  input: {
    readonly amountMajor: number;
    readonly recipientCode: string;
    readonly reference: string;
    readonly reason: string;
  },
  fetcher: Fetcher = fetch,
): Promise<PaystackTransferResult> {
  if (!Number.isFinite(input.amountMajor) || input.amountMajor <= 0) {
    throw new PaystackPayoutError("invalid_transfer_amount", "Transfer amount must be greater than zero.", 400);
  }
  if (!input.recipientCode.trim() || !input.reference.trim()) {
    throw new PaystackPayoutError("invalid_transfer_request", "Transfer recipient and reference are required.", 400);
  }

  const body = await paystackRequest(
    secretKey,
    new URL("https://api.paystack.co/transfer"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "balance",
        amount: Math.round(input.amountMajor * 100),
        recipient: input.recipientCode.trim(),
        reason: input.reason.trim() || "SKIMA payout",
        reference: input.reference.trim(),
      }),
    },
    fetcher,
  );
  const data = record(body.data);
  const providerReference = text(data.reference) ?? input.reference;
  const rawStatus = text(data.status);
  return {
    providerReference,
    providerStatus: rawStatus === "success" ? "succeeded" : "processing",
    rawStatus,
    response: body,
  };
}

async function paystackRequest(
  secretKey: string,
  url: URL,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<Record<string, unknown>> {
  if (!secretKey.trim()) {
    throw new PaystackPayoutError("paystack_not_configured", "Paystack payouts are not configured.", 503);
  }

  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${secretKey.trim()}`,
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new PaystackPayoutError(
      "paystack_unreachable",
      error instanceof Error && error.name === "TimeoutError"
        ? "Paystack took too long to respond."
        : "Paystack could not be reached. Try again.",
      503,
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await response.json();
    body = record(parsed);
  } catch {
    throw new PaystackPayoutError(
      "paystack_response_invalid",
      "Paystack returned an unreadable payout response.",
    );
  }

  if (!response.ok || body.status !== true) {
    const providerMessage = text(body.message);
    const safeMessage = providerMessage && !providerMessage.toLowerCase().includes("secret")
      ? providerMessage
      : "Paystack could not complete the payout request.";
    throw new PaystackPayoutError(
      response.status === 401 || response.status === 403
        ? "paystack_authentication_failed"
        : response.status === 429
        ? "paystack_rate_limited"
        : "paystack_request_failed",
      safeMessage,
      response.status >= 400 && response.status < 600 ? response.status : 502,
    );
  }

  return body;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : null;
}
