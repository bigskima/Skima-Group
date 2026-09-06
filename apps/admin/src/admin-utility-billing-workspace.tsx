import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReceiptText, RefreshCcw, Save, Zap } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { Button, ErrorState, LoadingState, MetricTile, PageHeader, SelectInput, TextAreaInput, TextInput } from "@skima/ui";
import { useSessionState } from "./session";

const SnapshotSchema = z.object({ categories: z.array(z.record(z.unknown())), billers: z.array(z.record(z.unknown())), products: z.array(z.record(z.unknown())), routes: z.array(z.record(z.unknown())), promotions: z.array(z.record(z.unknown())), payments: z.array(z.record(z.unknown())) });
type Kind = "category" | "biller" | "product" | "route" | "promotion";
const examples: Record<Kind, object> = {
  category: { displayName: "Cable TV", description: "Television subscriptions", iconKey: "receipt", status: "active" },
  biller: { categoryKey: "electricity", displayName: "Electricity company", customerIdentifierLabel: "Meter number", validationMode: "provider", status: "draft" },
  product: { billerKey: "electricity-company", displayName: "Prepaid electricity", amountMode: "customer", minimumAmount: 100, maximumAmount: 100000, currencyCode: "NGN", status: "draft" },
  route: { productKey: "electricity-company-prepaid", providerAdapterKey: "provider.utility.example", providerProductCode: "PREPAID", priority: 100, status: "inactive", feeConfig: { fixedAmount: 0 } },
  promotion: { displayName: "Welcome bills offer", discountKind: "percentage", discountValue: 5, maximumDiscount: 500, minimumSpend: 1000, status: "draft" },
};

export function AdminUtilityBillingWorkspace() {
  const { supabase, status } = useSessionState(); const client = useQueryClient();
  const [kind, setKind] = useState<Kind>("biller"); const [key, setKey] = useState(""); const [configuration, setConfiguration] = useState(JSON.stringify(examples.biller, null, 2));
  const snapshot = useQuery({ queryKey: ["admin-utility-billing"], enabled: status === "authenticated", queryFn: async () => { const { data, error } = await supabase.rpc("read_utility_admin_configuration"); if (error) throw error; return SnapshotSchema.parse(data); } });
  const save = useMutation({ mutationFn: async () => { const parsed = JSON.parse(configuration) as Record<string, unknown>; const { error } = await supabase.rpc("configure_utility_catalog_item", { target_kind: kind, target_key: key.trim(), target_configuration: parsed }); if (error) throw error; }, onSuccess: async () => { setKey(""); await client.invalidateQueries({ queryKey: ["admin-utility-billing"] }); } });
  const changeKind = (value: Kind) => { setKind(value); setConfiguration(JSON.stringify(examples[value], null, 2)); };
  return <><PageHeader eyebrow="Commerce platform" title="Utility billing" description="Configure bill categories, billers, products, provider routes and promotions without changing application code." actions={<Button icon={RefreshCcw} variant="outline" onClick={() => void snapshot.refetch()}>Refresh</Button>} />
    {snapshot.isLoading ? <LoadingState label="Loading utility configuration" /> : snapshot.error ? <ErrorState title="Utility configuration unavailable" message={snapshot.error.message} onRetry={() => void snapshot.refetch()} /> : <section className="skima-grid skima-grid--compact"><MetricTile label="Catalog products" value={snapshot.data?.products.length ?? 0} icon={Zap} tone="info" /><MetricTile label="Provider routes" value={snapshot.data?.routes.length ?? 0} icon={ReceiptText} /><MetricTile label="Promotions" value={snapshot.data?.promotions.length ?? 0} icon={ReceiptText} /><MetricTile label="Payment requests" value={snapshot.data?.payments.length ?? 0} icon={ReceiptText} /></section>}
    <section className="sk-panel"><div className="sk-panel__header"><div><p className="admin-section-kicker">Configuration</p><h2>Add or update an item</h2><p>Routes remain inactive until a real utility provider adapter has been registered and tested. Never place provider secrets in this form.</p></div></div><div className="skima-form"><SelectInput label="Configuration type" value={kind} onChange={event => changeKind(event.currentTarget.value as Kind)} options={[{label:"Category",value:"category"},{label:"Biller",value:"biller"},{label:"Product",value:"product"},{label:"Provider route",value:"route"},{label:"Promotion",value:"promotion"}]} /><TextInput label="Stable key" value={key} onChange={event => setKey(event.currentTarget.value)} placeholder="example.prepaid" required /><TextAreaInput label="Configuration JSON" value={configuration} onChange={event => setConfiguration(event.currentTarget.value)} rows={14} required />{save.error ? <div className="admin-notice is-error" role="alert">{save.error.message}</div> : null}<Button icon={Save} isLoading={save.isPending} disabled={!key.trim()} onClick={() => save.mutate()}>Save configuration</Button></div></section>
    <section className="admin-notice"><strong>How money moves</strong><p>Paystack funds the SKIMA customer wallet through its existing payment adapter. A separate utility adapter fulfills the bill. SKIMA reserves the customer amount, then captures it only after provider confirmation or reverses it on failure. Provider settlement is reconciled independently against treasury or a prefunded provider balance.</p></section>
  </>;
}
