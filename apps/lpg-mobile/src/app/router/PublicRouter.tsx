import { useState } from "react";

import { LoginScreen } from "../../features/auth/screens/LoginScreen";
import { OnboardingScreen } from "../../features/onboarding/screens/OnboardingScreen";
import { WelcomeScreen } from "../../features/onboarding/screens/WelcomeScreen";

type PublicRoute = "welcome" | "onboarding" | "login";

export function PublicRouter() {
  const [route, setRoute] = useState<PublicRoute>("welcome");

  if (route === "onboarding") return <OnboardingScreen onComplete={() => setRoute("login")} />;
  if (route === "login") return <LoginScreen onBack={() => setRoute("welcome")} />;
  return <WelcomeScreen onGetStarted={() => setRoute("onboarding")} onLogin={() => setRoute("login")} />;
}
