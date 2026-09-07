import { assert, assertStringIncludes } from "jsr:@std/assert";

const root = new URL("../", import.meta.url);

async function read(path: string) {
  return Deno.readTextFile(new URL(path, root));
}

const [
  session,
  authShell,
  login,
  register,
  forgot,
  reset,
  html,
] = await Promise.all([
  read("apps/lpg-mobile/src/native/session/SessionProvider.tsx"),
  read("apps/lpg-mobile/src/native/ui/AuthShell.tsx"),
  read("apps/lpg-mobile/app/(auth)/login.tsx"),
  read("apps/lpg-mobile/app/(auth)/register.tsx"),
  read("apps/lpg-mobile/app/(auth)/forgot-password.tsx"),
  read("apps/lpg-mobile/app/(auth)/reset-password.tsx"),
  read("apps/lpg-mobile/app/+html.tsx"),
]);

Deno.test("LPG auth screens use one centralized Supabase session authority", () => {
  assertStringIncludes(session, "signInWithPassword");
  assertStringIncludes(session, "supabase.auth.signUp");
  assertStringIncludes(session, "resetPasswordForEmail");
  assertStringIncludes(session, "supabase.auth.updateUser");
  assertStringIncludes(session, "persistSession: true");
  assertStringIncludes(session, "autoRefreshToken: true");

  assertStringIncludes(login, "session.signIn(");
  assertStringIncludes(register, "session.signUp(");
  assertStringIncludes(forgot, "session.requestPasswordReset(");
  assertStringIncludes(reset, "session.updatePassword(");

  assert(
    !register.includes("session.supabase.auth.signUp"),
    "Registration must not bypass the centralized SKIMA auth session.",
  );
  assert(
    !forgot.includes("session.supabase.auth.resetPasswordForEmail"),
    "Password recovery must not bypass the centralized SKIMA auth session.",
  );
});

Deno.test("authenticated Supabase sessions are not rejected when role context is delayed", () => {
  assertStringIncludes(session, 'setStatus("authenticated")');
  assertStringIncludes(session, 'console.info("SKIMA session context refresh unavailable"');
  assertStringIncludes(session, "setContext(null)");
  assert(
    !session.includes('setStatus("unauthenticated");\n        return false;\n      } catch'),
    "A downstream context refresh failure must not invalidate a valid Supabase login.",
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
