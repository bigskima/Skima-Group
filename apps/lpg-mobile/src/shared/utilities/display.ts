import { formatMoney } from "@skima/frontend-core";

import { getFirstRecordString, type PlatformRecord } from "../api/records";

export function resolveCurrencyCode(
  currencies: readonly PlatformRecord[],
  record?: PlatformRecord | null,
): string | null {
  return getFirstRecordString(record, ["currency_code", "currencyCode"]) ??
    getFirstRecordString(currencies[0], ["code"]);
}

export function displayMoney(amount: number | null, currencyCode: string | null): string {
  return amount !== null && currencyCode ? formatMoney(amount, currencyCode) : "Amount unavailable";
}
