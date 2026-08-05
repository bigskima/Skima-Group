import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import { PolishedEmpty } from "./lpgComponents";

export function QueryState(props: {
  readonly children: ReactNode;
  readonly error: unknown;
  readonly loading: boolean;
  readonly onRetry?: () => void;
  readonly skeleton: ReactNode;
}) {
  if (props.loading) {
    return props.skeleton;
  }

  if (props.error) {
    return (
      <PolishedEmpty
        icon={<AlertTriangle />}
        title="Could not load this screen"
        message="Check your connection and try again."
        actionLabel={props.onRetry ? "Try Again" : undefined}
        onAction={props.onRetry}
      />
    );
  }

  return props.children;
}
