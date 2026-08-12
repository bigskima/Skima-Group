import * as Crypto from "expo-crypto";
export function idempotencyKey(scope: string, target: string) { return `lpg-expo:${scope}:${target}:${Crypto.randomUUID()}`; }

export function operationIdempotencyKey(scope: string, target: string) {
  const safeScope = scope.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, "-");
  const safeTarget = target.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, "-");
  return `lpg-expo:${safeScope}:${safeTarget}:confirmed`;
}
