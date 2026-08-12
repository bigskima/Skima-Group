export function friendlyError(
  cause: unknown,
  fallback = "Something went wrong. Please try again.",
) {
  if (!(cause instanceof Error)) return fallback;
  const message = cause.message.toLowerCase();
  if (
    message.includes("invalid login") ||
    message.includes("invalid credentials") ||
    message.includes("email or password")
  )
    return "The email or password is incorrect. Check both and try again.";
  if (message.includes("already registered") || message.includes("already exists"))
    return "An account already uses this email. Sign in or reset your password.";
  if (message.includes("network") || message.includes("fetch") || message.includes("timeout"))
    return "We couldn't connect right now. Check your internet connection and try again.";
  if (message.includes("invalid json") || message.includes("invalid backend response"))
    return "Some information couldn't be refreshed. Please try again.";
  if (message.includes("permission") && message.includes("location"))
    return "Location access is off. Allow it in your device settings, or choose the place manually.";
  if (message.includes("rate") && message.includes("limit"))
    return "That was a little too quick. Wait a moment and try again.";
  if (message.includes("session") || message.includes("jwt") || message.includes("unauthorized"))
    return "Your session has ended. Sign in again to continue.";
  if (
    message.includes("maps adapter") ||
    message.includes("map provider") ||
    message.includes("server secret")
  )
    return "Address search is temporarily unavailable. You can still use your current location or place the pin manually.";
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
