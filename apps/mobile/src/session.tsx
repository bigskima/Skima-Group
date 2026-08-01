import {
  type ApiGatewayClient,
  ApiGatewayError,
  createApiGatewayClient,
  createSkimaSupabaseClient,
  readClientRuntimeConfig,
  type SessionContext,
  SessionContextSchema,
} from "@skima/frontend-core";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type SessionStatus = "loading" | "authenticated" | "unauthenticated" | "error";

export interface SessionState {
  readonly status: SessionStatus;
  readonly session: Session | null;
  readonly context: SessionContext | null;
  readonly error: string | null;
  readonly supabase: SupabaseClient;
  readonly api: ApiGatewayClient;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly refreshContext: () => Promise<void>;
}

const SessionStateContext = createContext<SessionState | null>(null);
let cachedSessionRuntime: ReadySessionRuntime | FailedSessionRuntime | null = null;

export function MobileSessionProvider(props: { readonly children: ReactNode }) {
  const runtime = useMemo(createSessionRuntime, []);

  if (!runtime.ok) {
    return <MobileConfigurationError message={runtime.message} />;
  }

  return <ReadySessionProvider runtime={runtime} children={props.children} />;
}

function ReadySessionProvider(
  props: { readonly runtime: ReadySessionRuntime; readonly children: ReactNode },
) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [context, setContext] = useState<SessionContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);

  const api = useMemo(
    () =>
      createApiGatewayClient({
        apiGatewayUrl: props.runtime.config.apiGatewayUrl,
        anonKey: props.runtime.config.supabaseAnonKey,
        getAccessToken: async () => sessionRef.current?.access_token ?? null,
        developmentLogger: import.meta.env.DEV ? console.info : undefined,
      }),
    [props.runtime.config.apiGatewayUrl, props.runtime.config.supabaseAnonKey],
  );

  const refreshContext = useCallback(async () => {
    if (!sessionRef.current) {
      setContext(null);
      return;
    }

    const sessionContext = await api.get("/runtime/session-context", SessionContextSchema);
    setContext(sessionContext);
  }, [api]);

  const applySession = useCallback(async (nextSession: Session | null) => {
    sessionRef.current = nextSession;
    setSession(nextSession);
    setError(null);

    if (!nextSession) {
      setContext(null);
      setStatus("unauthenticated");
      return;
    }

    setStatus("loading");

    try {
      const sessionContext = await api.get("/runtime/session-context", SessionContextSchema);
      setContext(sessionContext);
      setStatus("authenticated");
    } catch (sessionError) {
      setContext(null);
      setError(readableSessionError(sessionError));
      setStatus("error");
    }
  }, [api]);

  useEffect(() => {
    let isActive = true;

    props.runtime.supabase.auth.getSession().then(({ data, error: authError }) => {
      if (!isActive) {
        return;
      }

      if (authError) {
        setError(authError.message);
        setStatus("error");
        return;
      }

      void applySession(data.session);
    });

    const { data: subscription } = props.runtime.supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!isActive) {
          return;
        }

        void applySession(nextSession);
      },
    );

    return () => {
      isActive = false;
      subscription.subscription.unsubscribe();
    };
  }, [applySession, props.runtime.supabase.auth]);

  const signIn = useCallback(async (email: string, password: string) => {
    setStatus("loading");
    setError(null);

    try {
      const { data, error: signInError } = await props.runtime.supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setStatus("unauthenticated");
        return;
      }

      await applySession(data.session);
    } catch (signInError) {
      setError(readableSessionError(signInError));
      setStatus("unauthenticated");
    }
  }, [applySession, props.runtime.supabase.auth]);

  const signOut = useCallback(async () => {
    await props.runtime.supabase.auth.signOut();
    sessionRef.current = null;
    setSession(null);
    setContext(null);
    setStatus("unauthenticated");
  }, [props.runtime.supabase.auth]);

  const value: SessionState = {
    status,
    session,
    context,
    error,
    supabase: props.runtime.supabase,
    api,
    signIn,
    signOut,
    refreshContext,
  };

  return (
    <SessionStateContext.Provider value={value}>
      {props.children}
    </SessionStateContext.Provider>
  );
}

interface ReadySessionRuntime {
  readonly ok: true;
  readonly config: ReturnType<typeof readClientRuntimeConfig>;
  readonly supabase: SupabaseClient;
}

interface FailedSessionRuntime {
  readonly ok: false;
  readonly message: string;
}

function createSessionRuntime(): ReadySessionRuntime | FailedSessionRuntime {
  if (cachedSessionRuntime) {
    return cachedSessionRuntime;
  }

  try {
    const config = readClientRuntimeConfig(import.meta.env);

    cachedSessionRuntime = {
      ok: true,
      config,
      supabase: createSkimaSupabaseClient(config),
    };

    return cachedSessionRuntime;
  } catch (error) {
    cachedSessionRuntime = {
      ok: false,
      message: error instanceof Error ? error.message : "App configuration is invalid.",
    };

    return cachedSessionRuntime;
  }
}

function MobileConfigurationError(props: { readonly message: string }) {
  return (
    <main className="mobile-app">
      <section className="mobile-shell mobile-auth-shell" role="alert">
        <div className="mobile-auth-card">
          <div className="mobile-brand mobile-brand--large">
            <span>S</span>
            <strong>Skima</strong>
          </div>
          <h1>App unavailable</h1>
          <p>{props.message}</p>
        </div>
      </section>
    </main>
  );
}

export function useMobileSession(): SessionState {
  const context = useContext(SessionStateContext);

  if (!context) {
    throw new Error("useMobileSession must be used within MobileSessionProvider.");
  }

  return context;
}

function readableSessionError(error: unknown): string {
  if (error instanceof ApiGatewayError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "The session could not be loaded.";
}
