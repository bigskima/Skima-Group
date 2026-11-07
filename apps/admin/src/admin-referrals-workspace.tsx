import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Gift, Megaphone, Plus, Save, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

import { Button, ErrorState, LoadingState, PageHeader, StatusBadge, TextAreaInput, TextInput } from "@skima/ui";
import { useSessionState } from "./session";
import "./admin-referrals-workspace.css";

const CampaignSchema = z.object({
  id: z.string().uuid(),
  campaign_key: z.string(),
  display_name: z.string(),
  description: z.string(),
  status: z.string(),
  target_app_keys: z.array(z.string()),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  priority: z.coerce.number(),
  referrer_reward: z.record(z.unknown()),
  referred_reward: z.record(z.unknown()),
  terms: z.string().nullable(),
  maximum_referrals_per_user: z.number().nullable(),
  qualification_rules: z.record(z.unknown()).default({ event: "first_payment_or_delivery", minimum_amount: 0, currency_code: "NGN" }),
  created_at: z.string(),
}).passthrough();
const CampaignArraySchema = z.array(CampaignSchema);
type Campaign = z.infer<typeof CampaignSchema>;
type AppKey = "refill" | "store" | "logistics" | "bills";
type FormValue = {
  campaign_key: string;
  display_name: string;
  description: string;
  status: "draft" | "active" | "paused" | "ended";
  target_app_keys: AppKey[];
  starts_at: string;
  ends_at: string;
  priority: string;
  referrer_reward: string;
  referred_reward: string;
  terms: string;
  maximum_referrals_per_user: string;
  qualification_event: "first_payment" | "first_payment_or_delivery";
  minimum_amount: string;
};

const APPS: { key: AppKey; label: string }[] = [
  { key: "refill", label: "Refill" },
  { key: "store", label: "Store" },
  { key: "logistics", label: "Logistics" },
  { key: "bills", label: "Bills" },
];
const EMPTY_FORM: FormValue = {
  campaign_key: "",
  display_name: "",
  description: "",
  status: "draft",
  target_app_keys: ["refill","store","logistics","bills"],
  starts_at: "",
  ends_at: "",
  priority: "100",
  referrer_reward: "{}",
  referred_reward: "{}",
  terms: "",
  maximum_referrals_per_user: "",
  qualification_event: "first_payment_or_delivery",
  minimum_amount: "0",
};

function asDateInput(value: string | null) {
  return value ? new Date(value).toISOString().slice(0,16) : "";
}
function toForm(campaign: Campaign): FormValue {
  return {
    campaign_key: campaign.campaign_key,
    display_name: campaign.display_name,
    description: campaign.description,
    status: campaign.status as FormValue["status"],
    target_app_keys: campaign.target_app_keys.filter((key): key is AppKey => APPS.some((app) => app.key === key)),
    starts_at: asDateInput(campaign.starts_at),
    ends_at: asDateInput(campaign.ends_at),
    priority: String(campaign.priority),
    referrer_reward: JSON.stringify(campaign.referrer_reward,null,2),
    referred_reward: JSON.stringify(campaign.referred_reward,null,2),
    terms: campaign.terms ?? "",
    maximum_referrals_per_user: campaign.maximum_referrals_per_user === null ? "" : String(campaign.maximum_referrals_per_user),
    qualification_event: campaign.qualification_rules.event === "first_payment" ? "first_payment" : "first_payment_or_delivery",
    minimum_amount: String(campaign.qualification_rules.minimum_amount ?? 0),
  };
}
function toIso(value:string) {
  if(!value.trim()) return null;
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) throw new Error("Enter a valid campaign date.");
  return date.toISOString();
}
function readReward(value:string,label:string) {
  let parsed:unknown;
  try { parsed=JSON.parse(value || "{}"); } catch { throw new Error(label+" must be valid JSON."); }
  if(!parsed || typeof parsed!=="object" || Array.isArray(parsed)) throw new Error(label+" must be a JSON object.");
  return parsed as Record<string,unknown>;
}

export function AdminReferralsWorkspace() {
  const { supabase, context, status } = useSessionState();
  const client=useQueryClient();
  const canManage=context?.platformAdmin?.admin_kind==="super_admin" || Boolean(context?.permissions.includes("platform.content.manage"));
  const [form,setForm]=useState<FormValue>(EMPTY_FORM);
  const [editingId,setEditingId]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [errorMessage,setErrorMessage]=useState<string|null>(null);

  const campaigns=useQuery({
    queryKey:["admin-referral-campaigns"],
    enabled:status==="authenticated" && canManage,
    retry:false,
    queryFn:async()=>{
      const {data,error}=await supabase.from("referral_campaigns")
        .select("id,campaign_key,display_name,description,status,target_app_keys,starts_at,ends_at,priority,referrer_reward,referred_reward,terms,maximum_referrals_per_user,qualification_rules,created_at")
        .order("priority",{ascending:true}).order("created_at",{ascending:false});
      if(error) throw error;
      return CampaignArraySchema.parse(data??[]);
    },
  });
  const rows=campaigns.data??[];
  const rewards=useQuery({
    queryKey:["admin-referral-reward-review"],
    enabled:status==="authenticated" && canManage,
    retry:false,
    queryFn:async()=>{
      const {data,error}=await supabase.from("referral_reward_entries")
        .select("id,referral_id,beneficiary_user_id,reward_side,reward_definition,status,created_at,metadata")
        .in("status",["pending","approved"])
        .order("created_at",{ascending:false}).limit(100);
      if(error)throw error;
      return Array.isArray(data)?data as Record<string,unknown>[]:[];
    },
  });
  const reviewReward=useMutation({
    mutationFn:async(input:{id:string;decision:"approved"|"rejected"})=>{
      const {data,error}=await supabase.rpc("review_skima_referral_reward",{
        target_reward_entry_id:input.id,
        target_decision:input.decision,
        target_reason:input.decision==="approved"?"Approved for manual reward fulfilment.":"Rejected during referral reward review.",
      });
      if(error)throw error;
      return input.decision;
    },
    onSuccess:async(decision)=>{
      setNotice(decision==="approved"?"Reward approved and ready for fulfilment. No wallet credit was posted.":"Reward rejected.");
      setErrorMessage(null);
      await client.invalidateQueries({queryKey:["admin-referral-reward-review"]});
    },
    onError:(cause)=>{setErrorMessage(cause instanceof Error?cause.message:"Reward review failed.");setNotice(null);},
  });

  const save=useMutation({
    mutationFn:async()=>{
      if(!/^[a-z][a-z0-9_.:-]{2,100}$/.test(form.campaign_key.trim())) throw new Error("Use a campaign key with lowercase letters, digits, dot, underscore, colon or hyphen.");
      if(form.display_name.trim().length<2) throw new Error("Add a campaign name.");
      if(form.target_app_keys.length===0) throw new Error("Choose at least one SKIMA app.");
      const starts=toIso(form.starts_at);
      const ends=toIso(form.ends_at);
      if(starts&&ends&&new Date(ends)<=new Date(starts)) throw new Error("The end date must be after the start date.");
      const max=form.maximum_referrals_per_user.trim()?Number(form.maximum_referrals_per_user):null;
      if(max!==null&&(!Number.isInteger(max)||max<1)) throw new Error("Maximum referrals must be a whole number greater than zero.");
      const minimumAmount=Number(form.minimum_amount);
      if(!Number.isFinite(minimumAmount)||minimumAmount<0) throw new Error("Minimum qualifying payment must be zero or greater.");
      const payload={
        campaign_key:form.campaign_key.trim(),
        display_name:form.display_name.trim(),
        description:form.description.trim(),
        status:form.status,
        target_app_keys:form.target_app_keys,
        starts_at:starts,
        ends_at:ends,
        priority:Number(form.priority)||100,
        referrer_reward:readReward(form.referrer_reward,"Referrer reward"),
        referred_reward:readReward(form.referred_reward,"New customer reward"),
        terms:form.terms.trim()||null,
        maximum_referrals_per_user:max,
        qualification_rules:{event:form.qualification_event,minimum_amount:minimumAmount,currency_code:"NGN"},
        updated_by:context?.user.id??null,
        updated_at:new Date().toISOString(),
        ...(editingId?{}:{created_by:context?.user.id??null}),
      };
      const result=editingId
        ? await supabase.from("referral_campaigns").update(payload).eq("id",editingId)
        : await supabase.from("referral_campaigns").insert(payload);
      if(result.error) throw result.error;
    },
    onSuccess:async()=>{
      setNotice(editingId?"Campaign updated.":"Campaign created.");
      setErrorMessage(null);
      setForm(EMPTY_FORM);setEditingId(null);
      await client.invalidateQueries({queryKey:["admin-referral-campaigns"]});
    },
    onError:(cause)=>{setErrorMessage(cause instanceof Error?cause.message:"Campaign could not be saved.");setNotice(null);},
  });

  const activeCount=useMemo(()=>rows.filter(row=>row.status==="active").length,[rows]);
  const setApp=(key:AppKey,checked:boolean)=>{
    setForm(current=>({...current,target_app_keys:checked?[...new Set([...current.target_app_keys,key])]:current.target_app_keys.filter(item=>item!==key)}));
  };

  if(!canManage) return <ErrorState title="Referral campaign access restricted" message="Campaign configuration requires platform content-management permission." />;
  if(campaigns.isPending) return <LoadingState label="Loading shared referral campaigns…" />;
  if(campaigns.error) return <ErrorState title="Referral campaigns unavailable" message={campaigns.error instanceof Error?campaigns.error.message:"Unable to load campaign settings."} onRetry={()=>void campaigns.refetch()}/>;

  return (
    <div className="admin-referrals">
      <PageHeader eyebrow="Experience · Growth" title="Shared referrals & campaigns"
        description="One referral code works across all four SKIMA apps. Configure campaign eligibility and reward definitions here; sign-up attribution is recorded centrally and referrals never require a code."
        actions={<Button icon={Plus} onClick={()=>{setEditingId(null);setForm(EMPTY_FORM);setErrorMessage(null);}}>New campaign</Button>}/>
      <div className="admin-referrals__metrics">
        <div><span>Campaigns</span><strong>{rows.length}</strong></div>
        <div><span>Active campaigns</span><strong>{activeCount}</strong></div>
        <div><span>App coverage</span><strong>4 SKIMA apps</strong></div>
      </div>
      {notice?<StatusBadge tone="success">{notice}</StatusBadge>:null}
      {errorMessage?<StatusBadge tone="danger">{errorMessage}</StatusBadge>:null}
      <div className="admin-referrals__layout">
        <section className="admin-referrals__editor">
          <div className="admin-referrals__heading"><Megaphone size={19}/><div><h2>{editingId?"Edit campaign":"Create campaign"}</h2><p>Set target apps, dates and reward instructions.</p></div></div>
          <form onSubmit={(event)=>{event.preventDefault();save.mutate();}}>
            <div className="admin-referrals__fields">
              <TextInput label="Campaign key" value={form.campaign_key} disabled={Boolean(editingId)} onChange={(event)=>setForm({...form,campaign_key:event.currentTarget.value})} placeholder="e.g. end-of-year-referrals"/>
              <TextInput label="Campaign name" value={form.display_name} onChange={(event)=>setForm({...form,display_name:event.currentTarget.value})} placeholder="Invite friends to SKIMA"/>
              <TextAreaInput label="Description" rows={2} value={form.description} onChange={(event)=>setForm({...form,description:event.currentTarget.value})}/>
              <label className="admin-referrals__select"><span>Status</span><select value={form.status} onChange={(event)=>setForm({...form,status:event.currentTarget.value as FormValue["status"]})}><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="ended">Ended</option></select></label>
            </div>
            <div className="admin-referrals__app-picker"><strong>Which apps can use this campaign?</strong><div>{APPS.map(app=><label key={app.key}><input type="checkbox" checked={form.target_app_keys.includes(app.key)} onChange={(event)=>setApp(app.key,event.currentTarget.checked)}/>{app.label}</label>)}</div></div>
            <div className="admin-referrals__fields">
              <TextInput label="Starts at" type="datetime-local" value={form.starts_at} onChange={(event)=>setForm({...form,starts_at:event.currentTarget.value})}/>
              <TextInput label="Ends at" type="datetime-local" value={form.ends_at} onChange={(event)=>setForm({...form,ends_at:event.currentTarget.value})}/>
              <TextInput label="Priority (lower is earlier)" type="number" value={form.priority} onChange={(event)=>setForm({...form,priority:event.currentTarget.value})}/>
              <TextInput label="Maximum referrals per referrer (optional)" type="number" value={form.maximum_referrals_per_user} onChange={(event)=>setForm({...form,maximum_referrals_per_user:event.currentTarget.value})}/>
            </div>
            <div className="admin-referrals__fields">
              <label className="admin-referrals__select"><span>How does a referral qualify?</span><select value={form.qualification_event} onChange={(event)=>setForm({...form,qualification_event:event.currentTarget.value as FormValue["qualification_event"]})}><option value="first_payment_or_delivery">First posted payment or completed delivery</option><option value="first_payment">First posted payment only</option></select></label>
              <TextInput label="Minimum qualifying transaction (NGN)" type="number" min="0" value={form.minimum_amount} onChange={(event)=>setForm({...form,minimum_amount:event.currentTarget.value})}/>
            </div>
            <div className="admin-referrals__reward-grid">
              <TextAreaInput label="Referrer reward definition (JSON)" rows={4} value={form.referrer_reward} onChange={(event)=>setForm({...form,referrer_reward:event.currentTarget.value})}/>
              <TextAreaInput label="New customer reward definition (JSON)" rows={4} value={form.referred_reward} onChange={(event)=>setForm({...form,referred_reward:event.currentTarget.value})}/>
            </div>
            <TextAreaInput label="Campaign terms" rows={3} value={form.terms} onChange={(event)=>setForm({...form,terms:event.currentTarget.value})}/>
            <p className="admin-referrals__hint"><Gift size={15}/> Reward definitions are configuration only. The campaign does not credit wallets automatically; qualifying rewards require an approved fulfilment and financial-posting workflow.</p>
            <div className="admin-referrals__buttons">
              <Button type="submit" icon={Save} isLoading={save.isPending}>{editingId?"Save changes":"Create campaign"}</Button>
              {editingId?<Button variant="outline" onClick={()=>{setEditingId(null);setForm(EMPTY_FORM);}}>Cancel edit</Button>:null}
            </div>
          </form>
        </section>
        <section className="admin-referrals__campaigns">
          <div className="admin-referrals__heading"><UsersRound size={19}/><div><h2>Campaign register</h2><p>Current shared referral campaigns.</p></div></div>
          {rows.length===0?<div className="admin-referrals__empty">No campaigns have been created yet.</div>:rows.map(row=><article className="admin-referrals__campaign" key={row.id}>
            <div className="admin-referrals__campaign-top"><div><strong>{row.display_name}</strong><small>{row.campaign_key}</small></div><StatusBadge tone={row.status==="active"?"success":row.status==="paused"?"warning":"neutral"}>{row.status}</StatusBadge></div>
            <p>{row.description}</p>
            <div className="admin-referrals__chips">{row.target_app_keys.map(key=><span key={key}>{APPS.find(app=>app.key===key)?.label??key}</span>)}</div>
            <div className="admin-referrals__campaign-foot"><small><CalendarClock size={13}/> {row.starts_at?new Date(row.starts_at).toLocaleDateString():"No start"} – {row.ends_at?new Date(row.ends_at).toLocaleDateString():"No end"}</small><Button variant="outline" size="sm" onClick={()=>{setEditingId(row.id);setForm(toForm(row));setNotice(null);setErrorMessage(null);}}>Edit</Button></div>
          </article>)}
        </section>
      </div>
      <section className="admin-referrals__editor">
        <div className="admin-referrals__heading"><Gift size={19}/><div><h2>Reward review & fulfilment</h2><p>Qualification creates a pending reward. Approval does not itself move money; the wallet/finance posting must be fulfilled separately.</p></div></div>
        {rewards.isPending ? <LoadingState label="Loading pending referral rewards…"/> : rewards.error ? <ErrorState title="Reward queue unavailable" message={rewards.error instanceof Error?rewards.error.message:"Could not load reward entries."} onRetry={()=>void rewards.refetch()}/> : rewards.data?.length ? (
          <div className="admin-referrals__reward-list">
            {rewards.data.map((reward)=>{
              const definition=reward.reward_definition && typeof reward.reward_definition==="object" ? reward.reward_definition as Record<string,unknown> : {};
              const json=JSON.stringify(definition);
              return <article key={String(reward.id)} className="admin-referrals__campaign">
                <div className="admin-referrals__campaign-top"><div><strong>{String(reward.reward_side??"").toUpperCase()} reward</strong><small>{String(reward.beneficiary_user_id??"")}</small></div><StatusBadge tone={reward.status==="approved"?"success":"warning"}>{String(reward.status)}</StatusBadge></div>
                <p>{json}</p>
                {reward.status==="pending"?<div className="admin-referrals__buttons">
                  <Button size="sm" disabled={reviewReward.isPending} onClick={()=>reviewReward.mutate({id:String(reward.id),decision:"approved"})}>Approve for fulfilment</Button>
                  <Button size="sm" variant="outline" disabled={reviewReward.isPending} onClick={()=>reviewReward.mutate({id:String(reward.id),decision:"rejected"})}>Reject</Button>
                </div>:<small>Approved; awaiting separate fulfilment and financial posting.</small>}
              </article>;
            })}
          </div>
        ) : <div className="admin-referrals__empty">No referral rewards are waiting for review.</div>}
      </section>
    </div>
  );
}
