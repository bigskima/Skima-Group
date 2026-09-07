import { ArrowUpRight, CheckCircle2, CircleDollarSign, KeyRound, Link2, ShieldCheck } from "lucide-react";

const providerOptions = [
  {
    name: "VTpass",
    fit: "Nigeria-focused bill payments",
    coverage: "Evaluate for electricity, airtime, data, television and other Nigerian bill categories.",
    signupUrl: "https://www.vtpass.com/register/",
    docsUrl: "https://www.vtpass.com/documentation/",
  },
  {
    name: "Reloadly",
    fit: "Airtime and data across multiple countries",
    coverage: "Evaluate when SKIMA needs airtime or data products beyond a single Nigerian provider.",
    signupUrl: "https://www.reloadly.com/signup",
    docsUrl: "https://developers.reloadly.com/airtime/docs",
  },
] as const;

export function AdminUtilityProviderGuide() {
  return (
    <div className="utility-guide">
      <section className="utility-guide__hero">
        <div><p className="admin-section-kicker">Start here</p><h2>How bill payments become available</h2><p>SKIMA does not need a separate agreement with every mobile network or electricity company. Start with a bill-payment provider that already connects to them, test the connection, then choose which services customers can see.</p></div>
        <ShieldCheck aria-hidden="true" />
      </section>
      <div className="utility-guide__steps">
        <GuideStep number="1" icon={Link2} title="Choose a provider" body="Compare coverage, pricing, prefunding, support, reporting, refunds and live-service reliability." />
        <GuideStep number="2" icon={KeyRound} title="Open a business account" body="Complete the provider's business checks and obtain test credentials before requesting live access." />
        <GuideStep number="3" icon={ShieldCheck} title="Connect securely" body="Ask the deployment owner to save the credentials securely. Credentials must never be pasted into this page or sent to customers." />
        <GuideStep number="4" icon={CheckCircle2} title="Test before launch" body="Verify customer lookup, successful payment, delayed responses, duplicate protection, refunds and daily reconciliation." />
        <GuideStep number="5" icon={CircleDollarSign} title="Publish services and offers" body="Add companies and plans, connect each plan, then make it available. Cashbacks are credited only after a successful payment." />
      </div>
      <section><div className="sk-panel__header"><div><p className="admin-section-kicker">Providers to evaluate</p><h2>Where to request access</h2><p>These are candidates, not automatic endorsements. Confirm current commercial terms and supported services directly with each provider.</p></div></div><div className="utility-provider-grid">{providerOptions.map(provider=><article key={provider.name}><div><strong>{provider.name}</strong><span>{provider.fit}</span></div><p>{provider.coverage}</p><div><a href={provider.signupUrl} target="_blank" rel="noreferrer">Open signup <ArrowUpRight size={14}/></a><a href={provider.docsUrl} target="_blank" rel="noreferrer">Read provider guide <ArrowUpRight size={14}/></a></div></article>)}</div></section>
      <section className="admin-notice"><strong>How customer money is protected</strong><p>Paystack can continue funding the SKIMA Wallet. The chosen bill-payment provider completes the bill. SKIMA records both sides separately, confirms the provider result before completing the purchase, and returns reserved money if the payment fails.</p></section>
    </div>
  );
}

function GuideStep({number,icon:Icon,title,body}:{number:string;icon:typeof Link2;title:string;body:string}) { return <article><span>{number}</span><Icon aria-hidden="true"/><div><strong>{title}</strong><p>{body}</p></div></article>; }
