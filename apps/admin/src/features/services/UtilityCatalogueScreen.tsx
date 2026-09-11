import { useMutation } from "@tanstack/react-query";
import { RefreshCcw, Settings2 } from "lucide-react";

import { Button, StatusBadge } from "@skima/ui";

import { useSessionState } from "../../session";
import { AdminV2PageHeader } from "../../shared/patterns/AdminV2Patterns";
import {
  UtilityPreviewSchema,
  friendlyUtilityText,
  utilityError,
  utilityFlag,
  utilityNumber,
  utilityText,
  type UtilitySnapshot,
} from "./utility-billing-v2-shared";

export function UtilityCatalogueScreen(props: {
  data: UtilitySnapshot;
  refresh: () => Promise<void>;
  onNavigate: (href: string) => void;
}) {
  const { api } = useSessionState();
  const sync = useMutation({
    mutationFn: (providerKey: string) => api.post(
      "/admin/utility-billing/catalog-sync/run",
      { providerKey },
      UtilityPreviewSchema,
    ),
    onSuccess: props.refresh,
  });

  const syncReady = props.data.providers.filter((provider) => utilityFlag(provider, "catalog_sync_ready"));

  return (
    <div className="utility-v2__screen">
      <AdminV2PageHeader
        eyebrow="Utility billing · Catalogue"
        title="Provider catalogue"
        description="Import provider service types, companies and plans instead of manually copying large catalogues into SKIMA. Manual creation remains available only as a fallback."
        actions={<Button icon={Settings2} variant="outline" onClick={() => props.onNavigate("/services/utility-billing/advanced")}>Manual fallback</Button>}
      />

      <section className="sk-panel">
        <div className="sk-panel__header"><div><h2>Catalogue-ready providers</h2><p className="skima-muted">Sync keeps the provider integration generic while SKIMA retains its own curated customer catalogue.</p></div><StatusBadge tone={syncReady.length ? "success" : "warning"}>{syncReady.length} ready</StatusBadge></div>
        <div className="utility-v2__record-list">
          {props.data.providers.map((provider) => {
            const key = utilityText(provider, "key");
            const ready = utilityFlag(provider, "catalog_sync_ready");
            return (
              <article className="utility-v2__record" key={utilityText(provider, "id") || key}>
                <span className="utility-v2__record-copy">
                  <strong>{utilityText(provider, "display_name") || key}</strong>
                  <small>{ready ? "Catalogue adapter installed" : "Catalogue adapter not installed"}</small>
                </span>
                <Button
                  icon={RefreshCcw}
                  size="sm"
                  variant="outline"
                  disabled={!ready}
                  isLoading={sync.isPending && sync.variables === key}
                  onClick={() => sync.mutate(key)}
                >
                  Sync catalogue
                </Button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="sk-panel">
        <div className="sk-panel__header"><div><h2>Recent sync activity</h2><p className="skima-muted">Imported items still require SKIMA economics and route activation before customer traffic.</p></div></div>
        <div className="utility-v2__record-list">
          {props.data.syncRuns.slice(0, 8).map((run) => (
            <article className="utility-v2__record" key={utilityText(run, "id")}>
              <span className="utility-v2__record-copy">
                <strong>{utilityText(run, "provider_name") || "Utility provider"}</strong>
                <small>{friendlyUtilityText(utilityText(run, "status") || "running")}</small>
              </span>
              <strong>{utilityNumber(run, "item_count")} items</strong>
            </article>
          ))}
          {props.data.syncRuns.length === 0 ? <p className="skima-muted">No catalogue sync has been recorded yet.</p> : null}
        </div>
      </section>

      {sync.data ? <section className="admin-notice"><strong>Catalogue sync completed</strong><p>Imported {utilityNumber(sync.data, "itemCount")} provider catalogue items. Review routing and economics before activating customer traffic.</p></section> : null}
      {sync.error ? <StatusBadge tone="danger">{utilityError(sync.error)}</StatusBadge> : null}
    </div>
  );
}
