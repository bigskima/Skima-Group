import type { SessionContext } from "@skima/frontend-core";
import type { ReactNode } from "react";

import { useSession } from "../providers/SessionProvider";
import { StateScreen } from "../../shared/ui/lpgComponents";

export function AuthenticationGuard(props: {
  readonly publicExperience: ReactNode;
  readonly children: (context: SessionContext) => ReactNode;
}) {
  const session = useSession();

  if (session.status === "loading") {
    return <StateScreen title="Preparing Skima LPG" message="Loading your secure account." />;
  }

  if (session.status === "unauthenticated") return props.publicExperience;

  if (session.status === "error" || !session.context) {
    return (
      <StateScreen
        title="Session unavailable"
        message={session.error ?? "Your account could not be loaded."}
        actionLabel="Retry"
        onAction={session.refreshContext}
      />
    );
  }

  return props.children(session.context);
}
