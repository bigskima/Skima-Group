type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function valueAtPath(payload: UnknownRecord, path: string): unknown {
  let current: unknown = payload;

  for (const segment of path.split(".")) {
    const record = asRecord(current);
    if (!record || !(segment in record)) return undefined;
    current = record[segment];
  }

  return current;
}

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/**
 * Mirrors public.application_requirement_applies in Supabase.
 * Requirements without a conditional rule always apply.
 */
export function requirementAppliesToPayload(
  requirementValue: unknown,
  payloadValue: unknown,
): boolean {
  const requirement = asRecord(requirementValue);
  const payload = asRecord(payloadValue);
  if (!requirement || !payload) return true;

  const metadata = asRecord(requirement.metadata);
  const condition = asRecord(metadata?.required_when) ?? asRecord(metadata?.requiredWhen);

  if (!condition) return true;

  const path = typeof condition.path === "string" ? condition.path.trim() : "";
  if (!path) return true;

  const operator =
    typeof condition.operator === "string" && condition.operator.trim()
      ? condition.operator.trim()
      : "equals";

  const actual = valueAtPath(payload, path);
  const actualText = textValue(actual);
  const expectedText = textValue(condition.value);
  const values = Array.isArray(condition.values)
    ? condition.values.map(textValue).filter((value): value is string => value !== null)
    : [];

  switch (operator) {
    case "equals":
      return actualText === expectedText;
    case "not_equals":
      return actualText !== expectedText;
    case "exists":
      return actual !== undefined && actual !== null;
    case "not_exists":
      return actual === undefined || actual === null;
    case "in":
      return actualText !== null && values.includes(actualText);
    case "not_in":
      return actualText === null || !values.includes(actualText);
    default:
      // Unknown rules remain permissive, matching the backend helper.
      return true;
  }
}
