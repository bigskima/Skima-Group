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
import { secureSessionStorage } from "../storage/secureStorage";
import { stopDriverTracking } from "../device/driverTracking";

type Status = "loading" | "authenticated" | "unauthenticated" | "error";
interface SessionValue {
  status: Status;
  session: Session | null;
  context: SessionContext | null;
  error: string | null;
  api: ApiGatewayClient;
  supabase: SupabaseClient;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
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
  const [session, setSession] = useState<Session | null>(null);
  const [context, setContext] = useState<SessionContext | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
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

  const apply = useCallback(
    async (next: Session | null) => {
      const applyVersion = ++applyVersionRef.current;
      sessionRef.current = next;
      setSession(next);
      setError(null);
      if (!next) {
        await stopDriverTracking().catch(() => undefined);
        if (applyVersion !== applyVersionRef.current) return;
        setContext(null);
        setStatus("unauthenticated");
        return;
      }
      setStatus("loading");
      try {
        const nextContext = await api.get(
          "/runtime/session-context",
          SessionContextSchema,
        );
        if (
          applyVersion !== applyVersionRef.current ||
          sessionRef.current?.access_token !== next.access_token
        )
          return;
        setContext(nextContext);
        setStatus("authenticated");
      } catch (cause) {
        if (applyVersion !== applyVersionRef.current) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Your account could not be loaded.",
        );
        setStatus("error");
      }
    },
    [api],
  );

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
      context,
      error,
      session,
      status,
      supabase,
      refresh: () => apply(sessionRef.current),
      signIn: async (email, password) => {
        setError(null);
        setStatus("loading");
        const { data, error: authError } =
          await supabase.auth.signInWithPassword({ email, password });
        if (authError) {
          setError(authError.message);
          setStatus("unauthenticated");
          return;
        }
        if (sessionRef.current?.access_token !== data.session?.access_token)
          await apply(data.session);
      },
      signOut: async () => {
        await supabase.auth.signOut();
        await apply(null);
      },
    }),
    [api, apply, context, error, session, status, supabase],
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
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey)
    throw new Error(
      "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are required.",
    );
  return {
    url,
    anonKey,
    gateway:
      process.env.EXPO_PUBLIC_API_GATEWAY_URL ??
      `${url.replace(/\/$/, "")}/functions/v1/api-gateway`,
  };
}
