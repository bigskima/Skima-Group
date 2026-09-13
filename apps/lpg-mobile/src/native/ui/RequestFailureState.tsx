import { AlertTriangle, LockKeyhole, ServerOff, WifiOff } from "lucide-react-native";
import type { ReactNode } from "react";
import { classifyRequestProblem, type RequestProblemKind } from "../utilities/requestProblem";
import { useAppTheme } from "../theme/ThemeProvider";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";

interface Copy {
  readonly title: string;
  readonly description: string;
}

const DEFAULT_COPY: Record<RequestProblemKind, Copy> = {
  network: {
    title: "Couldn’t connect",
    description: "Check your internet connection and try again.",
  },
  server: {
    title: "Something went wrong on our side",
    description: "SKIMA could not load this information right now. Please try again.",
  },
  missing: {
    title: "Information not available",
    description: "This information may have been removed, completed, reassigned, or is no longer available.",
  },
  permission: {
    title: "Access restricted",
    description: "You do not have permission to view this information.",
  },
  role: {
    title: "Role access required",
    description: "Your current role does not include access to this information.",
  },
  station_scope: {
    title: "Station access restricted",
    description: "This information belongs to another station or your station access has changed.",
  },
  service_unavailable: {
    title: "Temporarily unavailable",
    description: "This SKIMA service is temporarily unavailable. Please try again shortly.",
  },
  session: {
    title: "Sign in again",
    description: "Your session has ended. Sign in again to continue.",
  },
  unknown: {
    title: "Couldn’t load this information",
    description: "Please try again. If the problem continues, SKIMA can investigate the request internally.",
  },
};

export function RequestFailureState({
  error,
  onRetry,
  overrides,
}: {
  error: unknown;
  onRetry?: () => void;
  overrides?: Partial<Record<RequestProblemKind, Partial<Copy>>>;
}) {
  const { palette } = useAppTheme();
  const problem = classifyRequestProblem(error);
  const base = DEFAULT_COPY[problem.kind];
  const override = overrides?.[problem.kind];
  const title = override?.title ?? base.title;
  const description = override?.description ?? base.description;
  const icon: ReactNode = problem.kind === "permission" || problem.kind === "role" || problem.kind === "station_scope"
    ? <LockKeyhole color={palette.brand} size={27} />
    : problem.kind === "network"
      ? <WifiOff color={palette.brand} size={27} />
      : problem.kind === "server" || problem.kind === "service_unavailable"
        ? <ServerOff color={palette.brand} size={27} />
        : <AlertTriangle color={palette.brand} size={27} />;

  return (
    <EmptyState
      icon={icon}
      title={title}
      description={description}
      action={problem.retryable && onRetry ? <AppButton label="Try again" onPress={onRetry} /> : undefined}
    />
  );
}
