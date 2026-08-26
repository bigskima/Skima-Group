function errorMessage(cause: unknown) {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  if (cause && typeof cause === "object") {
    const record = cause as Record<string, unknown>;
    for (const key of ["message", "error_description", "error", "details"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  return "";
}

export function friendlyError(
  cause: unknown,
  fallback = "Something went wrong. Please try again.",
) {
  const raw = errorMessage(cause);
  if (!raw) return fallback;
  const message = raw.toLowerCase();

  // Database, gateway and implementation details must never be shown on a
  // customer, driver or station screen. Callers still receive their own
  // context-specific fallback instead of PostgreSQL/RPC/schema internals.
  if (
    message.includes("sqlstate") ||
    message.includes("postgres") ||
    message.includes("postgrest") ||
    message.includes("pgrst") ||
    message.includes("violates") ||
    message.includes("constraint") ||
    message.includes("relation ") ||
    message.includes("column ") ||
    message.includes("function public.") ||
    message.includes("permission denied") ||
    message.includes("row-level security") ||
    message.includes("schema cache") ||
    /\b42p\d{2}\b/.test(message) ||
    /\b23\d{3}\b/.test(message) ||
    /\b42501\b/.test(message)
  )
    return fallback;

  if (
    message.includes("invalid login") ||
    message.includes("invalid credentials") ||
    message.includes("email or password")
  )
    return "The email or password is incorrect. Check both and try again.";
  if (message.includes("email not confirmed"))
    return "Confirm your email address before signing in.";
  if (message.includes("already registered") || message.includes("user already exists"))
    return "An account already uses this email. Sign in or reset your password.";
  if (message.includes("password") && (message.includes("weak") || message.includes("characters")))
    return "Choose a stronger password and try again.";
  if (
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("timeout") ||
    message.includes("connection") ||
    message.includes("offline")
  )
    return "We couldn't connect right now. Check your internet connection and try again.";
  if (message.includes("invalid json") || message.includes("invalid backend response"))
    return "Some information couldn't be refreshed. Please try again.";
  if (message.includes("permission") && message.includes("location"))
    return "Location access is off. Allow it in your device settings, or choose the place manually.";
  if (message.includes("rate") && message.includes("limit"))
    return "That was a little too quick. Wait a moment and try again.";
  if (
    message.includes("session") ||
    message.includes("jwt") ||
    message.includes("unauthorized") ||
    message.includes("token has expired")
  )
    return "Your session has ended. Sign in again to continue.";
  if (
    message.includes("maps adapter") ||
    message.includes("map provider") ||
    message.includes("server secret")
  )
    return "Address search is temporarily unavailable. You can still use your current location or place the pin manually.";

  if (message.includes("pickup location is outside enabled lpg service coverage"))
    return "Sorry, SKIMA service is not yet available at this pickup location. Choose another location or apply to become a SKIMA partner in this area.";
  if (message.includes("return location is outside enabled lpg service coverage"))
    return "Sorry, SKIMA service is not yet available at this return location. Choose another location or apply to become a SKIMA partner in this area.";
  if (message.includes("selected lpg station cannot fulfil this refill for the chosen trip"))
    return "That station can no longer fulfil this refill for the selected trip. Choose another available station and try again.";
  if (message.includes("an eligible lpg station is required for this refill"))
    return "Choose an available SKIMA station that can fulfil this refill before continuing.";
  if (message.includes("lpg serviceability verification"))
    return "We couldn't verify service availability for this location. Check the saved location and try again.";
  if (message.includes("valid latitude and longitude are required"))
    return "This saved location needs a valid map position before SKIMA can check service availability.";

  if (
    message.includes("verified cylinder capacity can only be changed") ||
    message.includes("capacity re-verification") ||
    message.includes("capacity reverification")
  )
    return "This cylinder size must be reviewed before its verified refill limit can change.";
  if (message.includes("active capacity re-verification request already exists"))
    return "A capacity review is already in progress for this cylinder.";
  if (message.includes("all required cylinder evidence must be approved"))
    return "The cylinder evidence still needs review before the verified capacity can change.";
  if (message.includes("cylinder capacity details changed after this request"))
    return "This cylinder changed after the review was submitted. Start a fresh capacity review.";

  if (
    message.includes("scanned cylinder does not match") ||
    message.includes("scan cylinder does not exist")
  )
    return "This is not the cylinder assigned to this job.";
  if (message.includes("scanned cylinder identity is required"))
    return "This cylinder code could not be read. Align the SKIMA code and scan again.";
  if (message.includes("scan is not valid for the current order status"))
    return "This scan has already been completed or is not needed at this step.";
  if (message.includes("lpg order access permission") || message.includes("assigned driver is required"))
    return "This job is assigned to someone else. Ask your supervisor if that looks wrong.";
  if (message.includes("branch-scoped") || message.includes("station branch"))
    return "This refill belongs to another station or your station access needs updating.";
  if (message.includes("target_lpg_order_id must reference"))
    return "This job is no longer available. Return to the queue and refresh.";

  return fallback;
}
