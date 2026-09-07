import { assert, assertStringIncludes } from "jsr:@std/assert";

const root = new URL("../", import.meta.url);

async function read(path: string) {
  return Deno.readTextFile(new URL(path, root));
}

const [
  session,
  authRuntime,
  authShell,
  login,
  register,
  forgot,
  reset,
  html,
  health,
  supabaseConfig,
] = await Promise.all([
  read("apps/lpg-mobile/src/native/session/SessionProvider.tsx"),
  read("apps/lpg-mobile/src/native/session/authRuntime.ts"),
  read("apps/lpg-mobile/src/native/ui/AuthShell.tsx"),
  read("apps/lpg-mobile/app/(auth)/login.tsx"),
  read("apps/lpg-mobile/app/(auth)/register.tsx"),
  read("apps/lpg-mobile/app/(auth)/forgot-password.tsx"),
  read("apps/lpg-mobile/app/(auth)/reset-password.tsx"),
  read("apps/lpg-mobile/app/+html.tsx"),
  read("supabase/functions/health/index.ts"),
  read("supabase/config.toml"),
]);

Deno.test("LPG auth verifies the SKIMA backend before credential operations", () => {
  assertStringIncludes(authRuntime, 'service !== "skima-platform"');
  assertStringIncludes(authRuntime, 'backend !== "supabase"');
  assertStringIncludes(authRuntime, "/functions/v1/health");
  assertStringIncludes(session, "verifySkimaAuthRuntime");
  assertStringIncludes(session, "await ensureAuthRuntime()");
  assertStringIncludes(health, 'service: "skima-platform"');
  assert(
    /\[functions\.health\][\s\S]*?verify_jwt\s*=\s*false/.test(supabaseConfig),
    "The pre-auth SKIMA health identity must remain public and non-secret.",
  );
});

Deno.test("LPG auth screens use centralized session actions", () => {
  assertStringIncludes(session, "signInWithPassword");
  assertStringIncludes(session, "supabase.auth.signUp");
  assertStringIncludes(session, "resetPasswordForEmail");
  assertStringIncludes(session, "supabase.auth.updateUser");
  assertStringIncludes(login, "session.signIn(");
  assertStringIncludes(register, "session.signUp(");
  assertStringIncludes(forgot, "session.requestPasswordReset(");
  assertStringIncludes(reset, "session.updatePassword(");
  assert(
    !register.includes("session.supabase.auth.signUp"),
    "Registration must not bypass the centralized SKIMA auth runtime.",
  );
});

Deno.test("LPG auth keeps the premium mode switch and browser autofill hardening", () => {
  assertStringIncludes(authShell, 'activeMode === "login"');
  assertStringIncludes(authShell, 'activeMode === "register"');
  assertStringIncludes(authShell, "BlurView");
  assertStringIncludes(login, 'activeMode="login"');
  assertStringIncludes(register, 'activeMode="register"');
  assertStringIncludes(html, "input:-webkit-autofill");
});
