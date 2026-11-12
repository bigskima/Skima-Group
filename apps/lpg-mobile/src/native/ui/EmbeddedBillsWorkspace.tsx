import { useCallback, useMemo } from "react";
import { router } from "expo-router";
import { BillsHostedAppProviders } from "../../../../bills-mobile/src/providers/HostedAppProviders";
import { BillsApp } from "../../../../bills-mobile/src/screens/BillsApp";
import type { SessionValue as BillsSessionValue } from "../../../../bills-mobile/src/session/SessionProvider";
import { useSession } from "../session/SessionProvider";

/**
 * Full Bills application workspace hosted by the Refill mobile shell.
 * The host session is injected so users keep one identity and one secure session.
 */
export function EmbeddedBillsWorkspace() {
  const host = useSession();
  const sessionValue = useMemo<BillsSessionValue>(() => ({
    status: host.status,
    session: host.session,
    context: host.context,
    error: host.error,
    api: host.api,
    supabase: host.supabase,
    clearAuthError: host.clearAuthError,
    signIn: (email, password) => host.signIn(email, password),
    signUp: (input) => host.signUp({
      displayName: input.displayName,
      email: input.email,
      password: input.password,
      referralCode: input.referralCode,
    }),
    resendSignupConfirmation: async (email, redirectTo) => {
      const { error } = await host.supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
    },
    requestPasswordReset: (email, redirectTo) => host.requestPasswordReset(email, redirectTo),
    updatePassword: (password) => host.updatePassword(password),
    signOut: () => host.signOut(),
    refresh: () => host.refresh(),
  }), [host]);

  const exit = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(customer)" as never);
  }, []);

  return (
    <BillsHostedAppProviders sessionValue={sessionValue}>
      <BillsApp onExit={exit} />
    </BillsHostedAppProviders>
  );
}
