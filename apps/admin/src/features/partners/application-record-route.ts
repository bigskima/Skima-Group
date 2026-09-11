export const APPLICATIONS_BASE_PATH = "/partners/applications";

export type ApplicationRecordRoute =
  | { readonly kind: "queue" }
  | { readonly kind: "record"; readonly applicationId: string }
  | { readonly kind: "invalid" };

export function parseApplicationRecordRoute(route: string): ApplicationRecordRoute {
  if (route === APPLICATIONS_BASE_PATH) {
    return { kind: "queue" };
  }

  const prefix = `${APPLICATIONS_BASE_PATH}/`;
  if (!route.startsWith(prefix)) {
    return { kind: "invalid" };
  }

  const rawId = route.slice(prefix.length);
  if (!rawId || rawId.includes("/")) {
    return { kind: "invalid" };
  }

  try {
    const applicationId = decodeURIComponent(rawId).trim();
    return applicationId ? { kind: "record", applicationId } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

export function buildApplicationRecordPath(applicationId: string): string {
  const normalizedId = applicationId.trim();
  if (!normalizedId) {
    throw new Error("Application ID is required to build an application route.");
  }

  return `${APPLICATIONS_BASE_PATH}/${encodeURIComponent(normalizedId)}`;
}
