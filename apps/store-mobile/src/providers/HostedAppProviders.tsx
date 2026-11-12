import type { PropsWithChildren } from "react";
import { ThemeProvider } from "../theme/ThemeProvider";
import { SessionValueProvider, type SessionValue } from "../session/SessionProvider";
import { StoreGuideProvider } from "../onboarding/StoreGuideProvider";
import { StoreNotificationLifecycle } from "../notifications/StoreNotificationLifecycle";
import { PolicyConsentGate } from "../policies/PolicyConsentGate";

/**
 * Providers for mounting the complete Store workspace inside another SKIMA app.
 * Authentication and React Query are deliberately inherited from the host shell.
 */
export function StoreHostedAppProviders({
  sessionValue,
  children,
}: PropsWithChildren<{ readonly sessionValue: SessionValue }>) {
  return (
    <ThemeProvider>
      <SessionValueProvider value={sessionValue}>
        <PolicyConsentGate>
          <StoreGuideProvider>
            <StoreNotificationLifecycle />
            {children}
          </StoreGuideProvider>
        </PolicyConsentGate>
      </SessionValueProvider>
    </ThemeProvider>
  );
}
