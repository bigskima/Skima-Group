import { useCallback, useMemo } from "react";
import { router } from "expo-router";
import { StoreHostedAppProviders } from "../../../store-mobile/src/providers/HostedAppProviders";
import { StoreApp } from "../../../store-mobile/src/screens/StoreApp";
import type { SessionValue as StoreSessionValue } from "../../../store-mobile/src/session/SessionProvider";
import { useSession } from "../session/SessionProvider";

/**
 * Full Store application workspace hosted by the Logistics mobile shell.
 * The host session is injected so users keep one identity and one secure session.
 */
export function EmbeddedStoreWorkspace() {
  const host = useSession();
  const sessionValue = useMemo<StoreSessionValue>(() => ({
    status: host.status,
    session: host.session,
    context: host.context,
    error: host.error,
    api: host.api,
    supabase: host.supabase,
    clearAuthError: () => undefined,
    signIn: (email, password) => host.signIn(email, password),
    signUp: async (input) => {
      const sessionStarted = await host.signUp(
        input.displayName,
        input.email,
        input.password,
        input.referralCode,
      );
      return { sessionStarted, confirmationRequired: !sessionStarted };
    },
    resendSignupConfirmation: async (email, redirectTo) => {
      const { error } = await host.supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
    },
    requestPasswordReset: async (email, redirectTo) => {
      const { error } = await host.supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
    },
    updatePassword: async (password) => {
      const { error } = await host.supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    signOut: () => host.signOut(),
    refresh: () => host.refresh(),
  }), [host]);

  const exit = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(customer)" as never);
  }, []);

  return (
    <StoreHostedAppProviders sessionValue={sessionValue}>
      <StoreApp onExit={exit} />
    </StoreHostedAppProviders>
  );
}
