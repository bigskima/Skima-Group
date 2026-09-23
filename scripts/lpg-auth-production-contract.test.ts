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
  frontendCore,
] = await Promise.all([
  read("apps/lpg-mobile/src/native/session/SessionProvider.tsx"),
  read("apps/lpg-mobile/src/native/ui/AuthShell.tsx"),
  read("apps/lpg-mobile/app/(auth)/login.tsx"),
  read("apps/lpg-mobile/app/(auth)/register.tsx"),
  read("apps/lpg-mobile/app/(auth)/forgot-password.tsx"),
  read("apps/lpg-mobile/app/(auth)/reset-password.tsx"),
  read("apps/lpg-mobile/app/+html.tsx"),
  read("packages/frontend-core/src/index.ts"),
]);

Deno.test("LPG auth screens use one centralized Supabase session authority", () => {
  assertStringIncludes(session, "signInWithPassword");
  assertStringIncludes(session, "supabase.auth.signUp");
  assertStringIncludes(session, "resetPasswordForEmail");
  assertStringIncludes(session, "supabase.auth.updateUser");
  assertStringIncludes(session, "persistSession: true");
  assertStringIncludes(session, "autoRefreshToken: true");
  assertStringIncludes(session, "Linking.getInitialURL");
  assertStringIncludes(session, "supabase.auth.setSession");
  assertStringIncludes(session, "exchangeCodeForSession");
  assertStringIncludes(forgot, '"skima-lpg://reset-password"');

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

Deno.test("LPG auth stays premium without duplicating onboarding content", () => {
  assertStringIncludes(authShell, "BlurView");
  assertStringIncludes(authShell, "<BrandMark compact />");
  assert(!authShell.includes("RoleSignal"), "Auth must not duplicate role/onboarding cards.");
  assert(!authShell.includes("ONE IDENTITY · EVERY SKIMA WORKSPACE"), "Auth must remain focused on account fields.");
  assertStringIncludes(login, 'title="Welcome back"');
  assertStringIncludes(register, 'title="Create your account"');
  assertStringIncludes(register, 'body="A few details and you\'re ready."');
  assertStringIncludes(html, "input:-webkit-autofill");
});


Deno.test("native LPG gateway does not require browser crypto.randomUUID", () => {
  assertStringIncludes(frontendCore, "function createRuntimeUuid()");
  assertStringIncludes(frontendCore, "runtimeCrypto?.randomUUID");
  assertStringIncludes(frontendCore, "runtimeCrypto?.getRandomValues");
  assertStringIncludes(frontendCore, "const requestId = createRuntimeUuid();");
  assert(
    !frontendCore.includes("const requestId = crypto.randomUUID();"),
    "React Native gateway requests must not depend on the browser Web Crypto randomUUID API.",
  );
});
