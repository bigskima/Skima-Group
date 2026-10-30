export type DocumentRequirementRecord = Record<string, unknown>;

function asRecord(value: unknown): DocumentRequirementRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as DocumentRequirementRecord
    : {};
}

function valueAtPath(value: unknown, path: string): string | null {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    const record = asRecord(current);
    if (!Object.prototype.hasOwnProperty.call(record, segment)) return null;
    current = record[segment];
  }

  if (current === null || current === undefined) return null;
  if (typeof current === "string") return current;
  if (typeof current === "number" || typeof current === "boolean") return String(current);
  return null;
}

/**
 * Mirrors public.application_requirement_applies() in Supabase.
 * Conditional requirements stay backend-authoritative and are also reflected
 * in the applicant UI so people only see evidence that applies to their vehicle.
 */
export function applicationRequirementApplies(
  requirement: DocumentRequirementRecord,
  applicationPayload: unknown,
): boolean {
  const metadata = asRecord(requirement.metadata);
  const condition = asRecord(metadata.required_when ?? metadata.requiredWhen);
  if (Object.keys(condition).length === 0) return true;

  const path = typeof condition.path === "string" ? condition.path.trim() : "";
  if (!path) return true;

  const operator = typeof condition.operator === "string" && condition.operator.trim()
    ? condition.operator.trim()
    : "equals";
  const actual = valueAtPath(applicationPayload, path);
  const expected = condition.value === null || condition.value === undefined
    ? null
    : String(condition.value);

  switch (operator) {
    case "equals":
      return actual === expected;
    case "not_equals":
      return actual !== expected;
    case "exists":
      return actual !== null;
    case "not_exists":
      return actual === null;
    case "in":
      return Array.isArray(condition.values) && condition.values.some((value) => String(value) === actual);
    case "not_in":
      return !Array.isArray(condition.values) || !condition.values.some((value) => String(value) === actual);
    default:
      // Match the SQL function's fail-open behaviour for unknown operators.
      return true;
  }
}

export function applicationRequirementIsRequired(
  requirement: DocumentRequirementRecord,
  applicationPayload: unknown,
): boolean {
  return requirement.is_required === true &&
    applicationRequirementApplies(requirement, applicationPayload);
}
