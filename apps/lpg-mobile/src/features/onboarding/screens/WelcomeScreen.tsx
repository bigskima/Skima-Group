import { BrandLockup, PhoneStatus } from "../../../shared/ui/lpgComponents";

export function WelcomeScreen(props: {
  readonly onGetStarted: () => void;
  readonly onLogin: () => void;
}) {
  return (
    <main className="lpg-app-shell">
      <section className="phone-frame splash-screen">
        <PhoneStatus />
        <div className="splash-content">
          <BrandLockup size="large" />
          <div>
            <h1>Skima LPG. Refills handled safely.</h1>
            <p>Register your real cylinder, order a refill, track every scan, and verify delivery.</p>
          </div>
          <div className="night-road" aria-hidden="true"><span /><i /><b /></div>
          <button type="button" className="primary-button" onClick={props.onGetStarted}>
            Get Started
          </button>
          <button type="button" className="outline-on-dark" onClick={props.onLogin}>
            Login
          </button>
        </div>
      </section>
    </main>
  );
}
