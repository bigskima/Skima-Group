import { ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button, StatusBadge, TextInput } from "@skima/ui";

import { AdminBrandLogo } from "./admin-brand-logo";
import { useSessionState } from "./session";

export function AdminLoginView() {
  const { signIn, error } = useSessionState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      await signIn(email, password);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="skima-auth-page">
      <section className="skima-auth-panel skima-auth-panel--admin">
        <div className="admin-login-brand">
          <AdminBrandLogo className="admin-login-brand__logo" />
          <div>
            <h1>SKIMA</h1>
            <p>Operations & company control</p>
          </div>
        </div>
        <div className="admin-login-copy">
          <span className="admin-login-copy__eyebrow">Secure admin access</span>
          <h2>Welcome back</h2>
          <p>Sign in to manage SKIMA operations, service areas, partners, support, money, and platform settings.</p>
        </div>
        <form className="skima-form" onSubmit={submit}>
          <TextInput
            label="Email address"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            required
          />
          <TextInput
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            required
          />
          {error ? <StatusBadge tone="danger">{error}</StatusBadge> : null}
          <Button icon={ShieldCheck} isLoading={isSubmitting} type="submit">
            Continue to SKIMA Admin
          </Button>
          <small className="admin-login-security-note">Your permissions decide which tools you can access after sign-in.</small>
        </form>
      </section>
    </main>
  );
}
