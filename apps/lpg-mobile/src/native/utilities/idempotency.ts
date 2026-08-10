import * as Crypto from "expo-crypto";
export function idempotencyKey(scope: string, target: string) { return `lpg-expo:${scope}:${target}:${Crypto.randomUUID()}`; }
