import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Settings2, Truck } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";

import { createClientIdempotencyKey } from "@skima/frontend-core";
import { Button, ErrorState, LoadingState, StatusBadge } from "@skima/ui";

import { useSessionState } from "./session";

const FulfillmentConfigurationSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["marketplace_only", "internal_only", "hybrid"]),
  priority: z.enum(["marketplace_first", "internal_first"]),
  marketplaceFirstFallbackOnly: z.boolean(),
});

type FulfillmentPriority = "marketplace_first" | "internal_first";

export function AdminFulfillmentPriorityControl(props: {
  readonly onNavigate: (href: string) => void;
}) {
  const { supabase, status, context } = useSessionState();
  const queryClient = useQueryClient();
  const [selectedPriority, setSelectedPriority] = useState<FulfillmentPriority>("marketplace_first");
  const [notice, setNotice] = useState<string | null>(null);

  const canManageDispatch = context?.platformAdmin?.admin_kind === "super_admin" ||
    context?.permissions.includes("platform.dispatch.manage") ||
    false;

  const configuration = useQuery({
    queryKey: ["lpg-launch-assurance-configuration"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_lpg_launch_assurance_configuration");
      if (error) throw error;
      return FulfillmentConfigurationSchema.parse(data);
    },
  });

  useEffect(() => {
    if (!configuration.data) return;
    setSelectedPriority(configuration.data.priority);
  }, [configuration.data]);

  const savePriority = useMutation({
    mutationFn: async (priority: FulfillmentPriority) => {
      const current = configuration.data;
      if (!current) throw new Error("Fulfillment settings are not available yet.");

      const { data, error } = await supabase.rpc("set_lpg_launch_assurance_configuration", {
        target_enabled: current.enabled,
        target_idempotency_key: createClientIdempotencyKey(
          "admin.operations.fulfillment-priority",
          `${priority}:${current.mode}:${current.enabled}:${current.marketplaceFirstFallbackOnly}`,
        ),
        target_marketplace_first_fallback_only: current.marketplaceFirstFallbackOnly,
        target_mode: current.mode,
        target_priority: priority,
        target_reason: priority === "marketplace_first"
          ? "Operations set Partner Network as the first LPG fulfillment route"
          : "Operations set SKIMA Fleet as the first LPG fulfillment route",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (_data, priority) => {
      setNotice(priority === "marketplace_first"
        ? "New LPG orders will try the Partner Network first."
        : "New LPG orders will try the SKIMA Fleet first.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["lpg-launch-assurance-configuration"] }),
        queryClient.invalidateQueries({ queryKey: ["lpg-launch-assurance-readiness"] }),
      ]);
    },
  });

  if (configuration.isLoading) {
    return (
      <section className="sk-panel">
        <LoadingState label="Loading LPG order routing" />
      </section>
    );
  }

  if (configuration.error || !configuration.data) {
    return (
      <section className="sk-panel">
        <ErrorState
          title="Order routing unavailable"
          message={readError(configuration.error)}
          onRetry={() => void configuration.refetch()}
        />
      </section>
    );
  }

  const current = configuration.data;
  const currentPriorityLabel = current.priority === "marketplace_first"
    ? "Partner Network first"
    : "SKIMA Fleet first";
  const modeLabel = fulfillmentModeLabel(current.mode);
  const priorityIsActive = current.enabled && current.mode === "hybrid";
  const hasUnsavedChange = selectedPriority !== current.priority;

  return (
    <section className="sk-panel stack-md" aria-label="LPG order routing priority">
      <div className="sk-panel__header">
        <div>
          <span className="section-kicker">LPG order routing</span>
          <h2>Who should get new LPG orders first?</h2>
          <p className="skima-muted">
            Choose the first network SKIMA tries when both fulfillment routes are available. This does not change LPG prices, Driver pay, or settlement rules.
          </p>
        </div>
        <StatusBadge tone={priorityIsActive ? "success" : "neutral"}>{currentPriorityLabel}</StatusBadge>
      </div>

      <div className="skima-grid skima-grid--compact">
        <div className="sk-panel stack-sm">
          <div className="section-heading">
            <div>
              <Building2 size={20} aria-hidden="true" />
              <h3>Partner Network first</h3>
            </div>
          </div>
          <p className="skima-muted">
            Try registered LPG stations and Independent Drivers first. SKIMA Fleet remains available according to your fulfillment setup.
          </p>
          <Button
            variant={selectedPriority === "marketplace_first" ? undefined : "outline"}
            disabled={!canManageDispatch || savePriority.isPending}
            onClick={() => {
              setNotice(null);
              setSelectedPriority("marketplace_first");
            }}
          >
            {selectedPriority === "marketplace_first" ? "Selected" : "Choose Partner Network first"}
          </Button>
        </div>

        <div className="sk-panel stack-sm">
          <div className="section-heading">
            <div>
              <Truck size={20} aria-hidden="true" />
              <h3>SKIMA Fleet first</h3>
            </div>
          </div>
          <p className="skima-muted">
            Try SKIMA Managed Drivers using SKIMA-owned vehicles first. The Partner Network remains available according to your fulfillment setup.
          </p>
          <Button
            variant={selectedPriority === "internal_first" ? undefined : "outline"}
            disabled={!canManageDispatch || savePriority.isPending}
            onClick={() => {
              setNotice(null);
              setSelectedPriority("internal_first");
            }}
          >
            {selectedPriority === "internal_first" ? "Selected" : "Choose SKIMA Fleet first"}
          </Button>
        </div>
      </div>

      <div className="admin-inline-warning">
        <strong>Current availability:</strong> {modeLabel}. {priorityIsActive
          ? "The priority above is active now."
          : current.enabled
            ? "The saved priority becomes relevant when both routes are allowed."
            : "SKIMA Fleet fulfillment is currently off, so this priority is saved for when it is enabled."}
      </div>

      {notice ? <StatusBadge tone="success">{notice}</StatusBadge> : null}
      {savePriority.error ? <ErrorState title="Could not save order routing" message={readError(savePriority.error)} /> : null}

      <div className="skima-action-row">
        <Button
          disabled={!canManageDispatch || !hasUnsavedChange || savePriority.isPending}
          isLoading={savePriority.isPending}
          onClick={() => savePriority.mutate(selectedPriority)}
        >
          Save order priority
        </Button>
        <Button
          icon={Settings2}
          variant="outline"
          onClick={() => props.onNavigate("/money/pricing/launch-assurance")}
        >
          Fulfillment setup
        </Button>
      </div>

      {!canManageDispatch ? (
        <p className="skima-muted">You can view the active routing policy, but changing it requires dispatch-management access.</p>
      ) : null}
    </section>
  );
}

function fulfillmentModeLabel(mode: "marketplace_only" | "internal_only" | "hybrid"): string {
  if (mode === "marketplace_only") return "Partner Network only";
  if (mode === "internal_only") return "SKIMA Fleet only";
  return "Partner Network + SKIMA Fleet";
}

function readError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "SKIMA could not load or update the order routing policy.";
}
