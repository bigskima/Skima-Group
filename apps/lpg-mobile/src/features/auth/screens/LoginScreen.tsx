import { type FormEvent, useState } from "react";

import { useSession } from "../../../app/providers/SessionProvider";
import { BrandLockup, PhoneStatus } from "../../../shared/ui/lpgComponents";

export function LoginScreen(props: { readonly onBack: () => void }) {
  const session = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await session.signIn(email, password);
  }

  return (
    <main className="lpg-app-shell">
      <section className="phone-frame login-screen">
        <PhoneStatus />
        <button type="button" className="back-button" onClick={props.onBack}>Back</button>
        <BrandLockup />
        <h1>Welcome back</h1>
        <p>Login to continue</p>
        <form className="auth-form" onSubmit={submit}>
          <label>
            Email
            <input
              autoComplete="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
            />
          </label>
          {session.error ? <p className="form-error">{session.error}</p> : null}
          <button type="submit" className="primary-button" disabled={session.status === "loading"}>
            Login
          </button>
        </form>
      </section>
    </main>
  );
}
