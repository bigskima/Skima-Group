import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BadgeDollarSign, Building2, RefreshCcw } from "lucide-react";
import { z } from "zod";

import { createClientIdempotencyKey } from "@skima/frontend-core";
import { Button, ErrorState, LoadingState, PageHeader, StatusBadge, TextInput } from "@skima/ui";
import { useSessionState } from "./session";

const StationPricingSchema = z.object({
  stationBranchId: z.string().uuid(),
  stationName: z.string().min(1),
  organizationName: z.string().min(1),
  approvalStatus: z.string(),
  complianceStatus: z.string(),
  canSetPrice: z.boolean(),
  catalogItemId: z.string().uuid().optional(),
  currentPricePerKg: z.coerce.number().nonnegative().optional(),
  currencyCode: z.string().min(3).default("NGN"),
  priceConfigured: z.boolean(),
  priceUpdatedAt: z.string().optional(),
});

const StationPricingListSchema = z.array(StationPricingSchema);
type StationPricing = z.infer<typeof StationPricingSchema>;

export function AdminStationPricingWorkspace({
  route,
  onNavigate,
}: {
  readonly route: string;
  readonly onNavigate: (href: string) => void;
}) {
  const stationBranchId = stationIdFromPricingRoute(route);
  if (route === "/stations") return <StationList onNavigate={onNavigate} />;
  if (!stationBranchId) {
    return (
      <ErrorState
        title="Station pricing page unavailable"
        message="The selected station could not be identified. Return to Stations and choose Set price again."
        onRetry={() => onNavigate("/stations")}
      />
    );
  }
  return <StationPriceEditor stationBranchId={stationBranchId} onNavigate={onNavigate} />;
}

function StationList({ onNavigate }: { readonly onNavigate: (href: string) => void }) {
  const query = useStationPricingQuery(null);
  return (
    <>
      <PageHeader
        eyebrow="Station operations"
        title="Stations"
        description="Review each station's current LPG selling price and open a station-specific price editor."
        actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void query.refetch()}>Refresh</Button>}
      />
      {query.isLoading ? <LoadingState label="Loading stations" /> : null}
      {query.error ? <ErrorState title="Stations unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} /> : null}
      {query.data && !query.error ? (
        <section className="sk-panel">
          <div className="sk-panel__header">
            <div><p className="admin-section-kicker">LPG pricing</p><h2>Station prices</h2></div>
            <StatusBadge>{query.data.length} stations</StatusBadge>
          </div>
          {query.data.length ? (
            <div style={{ display: "grid", gap: "0.8rem" }}>
              {query.data.map((station) => (
                <article
                  key={station.stationBranchId}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", border: "1px solid var(--sk-border, #d0d5dd)", borderRadius: 14, padding: "1rem" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", minWidth: 0 }}>
                    <Building2 aria-hidden="true" size={22} />
                    <div>
                      <strong>{station.stationName}</strong>
                      <p className="skima-muted" style={{ margin: "0.2rem 0 0" }}>{station.organizationName}</p>
                      <p style={{ margin: "0.35rem 0 0" }}>
                        {station.priceConfigured && station.currentPricePerKg !== undefined
                          ? `${formatPrice(station.currentPricePerKg, station.currencyCode)} / kg`
                          : "No current LPG price"}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                    {!station.canSetPrice ? <StatusBadge tone="warning">Approval or compliance required</StatusBadge> : null}
                    <Button
                      icon={BadgeDollarSign}
                      disabled={!station.canSetPrice}
                      onClick={() => onNavigate(`/stations/${station.stationBranchId}/pricing`)}
                    >
                      Set price
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="skima-muted">No station branches are available.</p>
          )}
        </section>
      ) : null}
    </>
  );
}

function StationPriceEditor({
  stationBranchId,
  onNavigate,
}: {
  readonly stationBranchId: string;
  readonly onNavigate: (href: string) => void;
}) {
  const queryClient = useQueryClient();
  const { supabase } = useSessionState();
  const query = useStationPricingQuery(stationBranchId);
  const station = query.data?.[0];
  const [price, setPrice] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (station?.currentPricePerKg !== undefined) setPrice(String(station.currentPricePerKg));
  }, [station?.currentPricePerKg]);

  const updatePrice = useMutation({
    mutationFn: async ({ itemId, amount }: { itemId: string; amount: number }) => {
      const result = await supabase.rpc("configure_lpg_station_catalog_price", {
        target_station_branch_id: stationBranchId,
        target_item_id: itemId,
        target_price_per_kg: amount,
        target_effective_from: new Date().toISOString(),
        target_idempotency_key: createClientIdempotencyKey("admin.station-price", stationBranchId),
        target_effective_until: null,
        target_metadata: { sourceSurface: "admin.station.pricing" },
        target_source: "skima.admin.station_catalog_price",
      });
      if (result.error) throw result.error;
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-station-pricing"] });
      await query.refetch();
      setSaved(true);
      setNotice("Price updated successfully.");
    },
    onError: (error) => {
      setSaved(false);
      setNotice(readError(error));
    },
  });

  const save = () => {
    setNotice(null);
    setSaved(false);
    const amount = Number(price);
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice("Enter a price greater than zero.");
      return;
    }
    if (!station?.catalogItemId) {
      setNotice("This station's LPG service is not ready for pricing yet.");
      return;
    }
    updatePrice.mutate({ itemId: station.catalogItemId, amount });
  };

  return (
    <>
      <PageHeader
        eyebrow="Station operations"
        title="LPG Pricing"
        description="Set the selling price per kilogram for the selected station. SKIMA fees remain separate."
        actions={<Button icon={ArrowLeft} variant="outline" onClick={() => onNavigate("/stations")}>Back to stations</Button>}
      />
      {query.isLoading ? <LoadingState label="Loading station price" /> : null}
      {query.error ? <ErrorState title="Station price unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} /> : null}
      {!query.isLoading && !query.error && !station ? (
        <ErrorState title="Station not found" message="The selected station is unavailable or you do not have access to it." onRetry={() => onNavigate("/stations")} />
      ) : null}
      {station ? (
        <section className="sk-panel" style={{ maxWidth: 720 }}>
          <div className="sk-panel__header">
            <div><p className="admin-section-kicker">Selected station</p><h2>{station.stationName}</h2><p className="skima-muted">{station.organizationName}</p></div>
            <StatusBadge tone={station.canSetPrice ? "success" : "warning"}>{station.canSetPrice ? "Ready" : "Unavailable"}</StatusBadge>
          </div>
          <div style={{ display: "grid", gap: "1rem", maxWidth: 520 }}>
            <div style={{ border: "1px solid var(--sk-border, #d0d5dd)", borderRadius: 14, padding: "1rem" }}>
              <span className="skima-muted">Current LPG price</span>
              <div style={{ fontSize: "1.75rem", fontWeight: 800, marginTop: "0.35rem" }}>
                {station.priceConfigured && station.currentPricePerKg !== undefined
                  ? `${formatPrice(station.currentPricePerKg, station.currencyCode)} / kg`
                  : "Not set"}
              </div>
            </div>
            <TextInput
              label="New price per kg"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={price}
              disabled={!station.canSetPrice || updatePrice.isPending}
              onChange={(event) => setPrice(event.currentTarget.value)}
              required
            />
            <Button
              icon={BadgeDollarSign}
              isLoading={updatePrice.isPending}
              disabled={!station.canSetPrice || updatePrice.isPending}
              onClick={save}
            >
              Save price
            </Button>
            {notice ? (
              <div
                role={saved ? "status" : "alert"}
                style={{ borderRadius: 12, padding: "0.8rem 0.9rem", background: saved ? "rgba(16, 185, 129, 0.10)" : "rgba(239, 68, 68, 0.10)", fontWeight: 650 }}
              >
                {notice}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}

function useStationPricingQuery(stationBranchId: string | null) {
  const { status, supabase } = useSessionState();
  return useQuery({
    queryKey: ["admin-station-pricing", stationBranchId ?? "all"],
    enabled: status === "authenticated",
    queryFn: async (): Promise<StationPricing[]> => {
      const result = await supabase.rpc("read_lpg_admin_station_pricing", {
        target_station_branch_id: stationBranchId,
      });
      if (result.error) throw result.error;
      return StationPricingListSchema.parse(result.data ?? []);
    },
  });
}

export function stationIdFromPricingRoute(route: string): string | null {
  const match = route.match(/^\/stations\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/pricing\/?$/i);
  return match?.[1] ?? null;
}

function formatPrice(amount: number, currencyCode: string) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function readError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return String((error as { message: string }).message);
  }
  return "The station pricing action could not be completed. Please try again.";
}
