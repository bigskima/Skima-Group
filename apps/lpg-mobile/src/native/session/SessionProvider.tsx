import "react-native-url-polyfill/auto";
import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  ApiGatewayClient,
  SessionContextSchema,
  type SessionContext,
} from "@skima/frontend-core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState, Platform } from "react-native";
import { stopDriverTracking } from "../device/driverTracking";
import { secureSessionStorage } from "../storage/secureStorage";
import { friendlyError } from "../utilities/friendlyError";
import {
  verifySkimaAuthRuntime,
  type AuthRuntimeState,
} from "./authRuntime";

type Status = "loading" | "authenticated" | "unauthenticated" | "error";

interface SignUpInput {
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
}

interface SignUpResult {
  readonly sessionStarted: boolean;
  readonly confirmationRequired: boolean;
}

interface SessionValue {
  status: Status;
  session: Session | null;
  context: SessionContext | null;
  error: string | null;
  authRuntimeStatus: AuthRuntimeState;
  authRuntimeMessage: string | null;
  api: ApiGatewayClient;
  supabase: SupabaseClient;
  clearAuthError(): void;
  signIn(email: string, password: string): Promise<boolean>;
  signUp(input: SignUpInput): Promise<SignUpResult>;
  requestPasswordReset(email: string, redirectTo: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
  verifyAuthRuntime(): Promise<boolean>;
}

const Context = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const config = useMemo(readConfig, []);
  const supabase = useMemo(
    () =>
      createClient(config.url, config.anonKey, {
        auth: {
          storage: Platform.OS === "web" ? undefined : secureSessionStorage,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: Platform.OS === "web",
        },
        global: { headers: { "x-skima-client": "lpg-expo" } },
      }),
    [config],
  );
  const sessionRef = useRef<Session | null>(null);
  const applyVersionRef = useRef(0);
  const authRuntimePromiseRef = useRef<Promise<void> | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [context, setContext] = useState<SessionContext | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [authRuntimeStatus, setAuthRuntimeStatus] = useState<AuthRuntimeState>("checking");
  const [authRuntimeMessage, setAuthRuntimeMessage] = useState<string | null>(null);
  const api = useMemo(
    () =>
      new ApiGatewayClient({
        apiGatewayUrl: config.gateway,
        anonKey: config.anonKey,
        getAccessToken: async () => sessionRef.current?.access_token ?? null,
        developmentLogger: __DEV__ ? console.info : undefined,
      }),
    [config],
  );

  const ensureAuthRuntime = useCallback(async () => {
    if (!authRuntimePromiseRef.current) {
      setAuthRuntimeStatus("checking");
      setAuthRuntimeMessage(null);
      authRuntimePromiseRef.current = verifySkimaAuthRuntime({
        supabaseUrl: config.url,
        anonKey: config.anonKey,
      });
    }

    try {
      await authRuntimePromiseRef.current;
      setAuthRuntimeStatus("ready");
      setAuthRuntimeMessage(null);
      return true;
    } catch (cause) {
      authRuntimePromiseRef.current = null;
      const message = friendlyError(
        cause,
        "SKIMA account access is temporarily unavailable. Please try again shortly.",
      );
      setAuthRuntimeStatus("unavailable");
      setAuthRuntimeMessage(message);
      return false;
    }
  }, [config.anonKey, config.url]);

  const apply = useCallback(
    async (next: Session | null) => {
      const applyVersion = ++applyVersionRef.current;
      sessionRef.current = next;
      setSession(next);
      setError(null);
      if (!next) {
        await stopDriverTracking().catch(() => undefined);
        if (applyVersion !== applyVersionRef.current) return false;
        setContext(null);
        setStatus("unauthenticated");
        return false;
      }

      // A valid Supabase session is sufficient to enter the customer app.
      // Role and organization context is hydrated immediately afterwards and
      // must never send an already-authenticated user back to the login page.
      setStatus("authenticated");
      try {
        const nextContext = await api.get(
          "/runtime/session-context",
          SessionContextSchema,
        );
        if (
          applyVersion !== applyVersionRef.current ||
          sessionRef.current?.access_token !== next.access_token
        )
          return false;
        setContext(nextContext);
        setStatus("authenticated");
        return true;
      } catch (cause) {
        if (applyVersion !== applyVersionRef.current) return false;
        if (__DEV__) console.info("SKIMA session context refresh unavailable", cause);
        setContext(null);
        setStatus("authenticated");
        return true;
      }
    },
    [api],
  );

  useEffect(() => {
    void ensureAuthRuntime();
  }, [ensureAuthRuntime]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data } = supabase.auth.onAuthStateChange(
      (_event, next) => void apply(next),
    );
    const appState =
      Platform.OS === "web"
        ? null
        : AppState.addEventListener("change", (state) => {
            if (state === "active") {
              supabase.auth.startAutoRefresh();
              void apply(sessionRef.current);
            } else supabase.auth.stopAutoRefresh();
          });
    return () => {
      data.subscription.unsubscribe();
      appState?.remove();
    };
  }, [apply, supabase]);

  const value = useMemo<SessionValue>(
    () => ({
      api,
      authRuntimeMessage,
      authRuntimeStatus,
      context,
      error,
      session,
      status,
      supabase,
      clearAuthError: () => setError(null),
      verifyAuthRuntime: ensureAuthRuntime,
      refresh: async () => {
        await apply(sessionRef.current);
      },
      signIn: async (email, password) => {
        setError(null);
        if (!(await ensureAuthRuntime())) {
          setError(
            authRuntimeMessage ??
              "SKIMA account access is temporarily unavailable. Please try again shortly.",
          );
          setStatus("unauthenticated");
          return false;
        }

        setStatus("loading");
        const { data, error: authError } =
          await supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password,
          });

        if (authError) {
          setError(
            friendlyError(
              authError,
              "We couldn't sign you in. Check your details and try again.",
            ),
          );
          setStatus("unauthenticated");
          return false;
        }

        if (!data.session) {
          setError("We couldn't start your secure session. Please try again.");
          setStatus("unauthenticated");
          return false;
        }

        sessionRef.current = data.session;
        setSession(data.session);
        setStatus("authenticated");
        void apply(data.session);
        return true;
      },
      signUp: async ({ displayName, email, password }) => {
        setError(null);
        if (!(await ensureAuthRuntime())) {
          throw new Error(
            authRuntimeMessage ??
              "SKIMA account access is temporarily unavailable. Please try again shortly.",
          );
        }

        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            data: {
              display_name: displayName.trim(),
              source: "skima.lpg.mobile",
            },
          },
        });

        if (authError) {
          throw new Error(
            friendlyError(
              authError,
              "We couldn't create your account. Check your details or sign in if you already use SKIMA.",
            ),
          );
        }

        if (data.session) {
          sessionRef.current = data.session;
          setSession(data.session);
          setStatus("authenticated");
          void apply(data.session);
        }

        return {
          sessionStarted: Boolean(data.session),
          confirmationRequired: !data.session,
        };
      },
      requestPasswordReset: async (email, redirectTo) => {
        setError(null);
        if (!(await ensureAuthRuntime())) {
          throw new Error(
            authRuntimeMessage ??
              "SKIMA account access is temporarily unavailable. Please try again shortly.",
          );
        }

        const { error: authError } = await supabase.auth.resetPasswordForEmail(
          email.trim().toLowerCase(),
          { redirectTo },
        );
        if (authError) {
          throw new Error(
            friendlyError(
              authError,
              "We couldn't send the reset email. Check your connection and try again.",
            ),
          );
        }
      },
      updatePassword: async (password) => {
        setError(null);
        if (!(await ensureAuthRuntime())) {
          throw new Error(
            authRuntimeMessage ??
              "SKIMA account access is temporarily unavailable. Please try again shortly.",
          );
        }

        const { error: authError } = await supabase.auth.updateUser({ password });
        if (authError) {
          throw new Error(
            friendlyError(
              authError,
              "We couldn't update your password. Open the newest reset email and try again.",
            ),
          );
        }
      },
      signOut: async () => {
        await supabase.auth.signOut();
        await apply(null);
      },
    }),
    [
      api,
      apply,
      authRuntimeMessage,
      authRuntimeStatus,
      context,
      ensureAuthRuntime,
      error,
      session,
      status,
      supabase,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSession() {
  const value = useContext(Context);
  if (!value)
    throw new Error("useSession must be used within SessionProvider.");
  return value;
}

function readConfig() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const configuredGateway = process.env.EXPO_PUBLIC_API_GATEWAY_URL?.trim();

  if (!url || !anonKey)
    throw new Error(
      "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are required.",
    );

  return {
    url: url.replace(/\/$/, ""),
    anonKey,
    gateway:
      configuredGateway ||
      `${url.replace(/\/$/, "")}/functions/v1/api-gateway`,
  };
}
