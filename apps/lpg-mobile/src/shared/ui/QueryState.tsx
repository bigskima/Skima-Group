import type { ReactNode } from "react";
import { AlertTriangle, LoaderCircle } from "lucide-react";

import { PolishedEmpty } from "./lpgComponents";

export function QueryState(props: {
  readonly children: ReactNode;
  readonly error: unknown;
  readonly loading: boolean;
  readonly onRetry?: () => void;
}) {
  if (props.loading) {
    return (
      <section className="polished-empty" aria-live="polite">
        <span><LoaderCircle aria-hidden="true" /></span>
        <h2>Loading</h2>
        <p>Getting the latest information for this screen.</p>
      </section>
    );
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
