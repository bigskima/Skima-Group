export function friendlyError(cause: unknown, fallback = "Something went wrong. Please try again.") {
  if (!(cause instanceof Error)) return fallback;
  const message = cause.message.toLowerCase();
  if (message.includes("invalid login") || message.includes("invalid credentials"))
    return "The email or password is incorrect. Check both and try again.";
  if (message.includes("already registered") || message.includes("already exists"))
    return "An account already uses this email. Sign in or reset your password.";
  if (message.includes("network") || message.includes("fetch") || message.includes("timeout"))
    return "We couldn’t connect right now. Check your internet connection and try again.";
  if (message.includes("permission") && message.includes("location"))
    return "Location access is off. Allow it in your device settings, or choose the place manually.";
  if (message.includes("rate") && message.includes("limit"))
    return "That was a little too quick. Wait a moment and try again.";
  if (message.includes("session") || message.includes("jwt") || message.includes("unauthorized"))
    return "Your session has ended. Sign in again to continue.";
  if (message.includes("maps adapter") || message.includes("map provider") || message.includes("server secret"))
    return "Address search is temporarily unavailable. You can still use your current location or place the pin manually.";
  return fallback;
}
