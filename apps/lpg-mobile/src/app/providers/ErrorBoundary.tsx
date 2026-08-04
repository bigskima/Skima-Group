import { Component, type ErrorInfo, type ReactNode } from "react";

import { StateScreen } from "../../shared/ui/lpgComponents";

interface ErrorBoundaryState {
  readonly failed: boolean;
}

export class ErrorBoundary extends Component<{ readonly children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error("LPG mobile render failure", error, info);
  }

  override render() {
    if (this.state.failed) {
      return (
        <StateScreen
          title="This screen could not open"
          message="Your account is safe. Reload the app to try again."
          actionLabel="Reload"
          onAction={() => window.location.reload()}
        />
      );
    }

    return this.props.children;
  }
}
