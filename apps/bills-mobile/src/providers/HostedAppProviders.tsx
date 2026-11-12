import type { PropsWithChildren } from "react";
import { ThemeProvider } from "../theme/ThemeProvider";
import { SessionValueProvider, type SessionValue } from "../session/SessionProvider";
import { BillsGuideProvider } from "../onboarding/BillsGuideProvider";
import { BillsNotificationLifecycle } from "../notifications/BillsNotificationLifecycle";
import { PolicyConsentGate } from "../policies/PolicyConsentGate";

/**
 * Providers for mounting the complete Bills workspace inside another SKIMA app.
 * Authentication and React Query are deliberately inherited from the host shell.
 */
export function BillsHostedAppProviders({
  sessionValue,
  children,
}: PropsWithChildren<{ readonly sessionValue: SessionValue }>) {
  return (
    <ThemeProvider>
      <SessionValueProvider value={sessionValue}>
        <PolicyConsentGate>
          <BillsGuideProvider>
            <BillsNotificationLifecycle />
            {children}
          </BillsGuideProvider>
        </PolicyConsentGate>
      </SessionValueProvider>
    </ThemeProvider>
  );
}
