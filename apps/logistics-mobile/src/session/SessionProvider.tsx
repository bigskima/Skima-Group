import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { ApiGatewayClient, SessionContextSchema, type SessionContext } from "@skima/frontend-core";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";
interface SessionValue {
  status: AuthStatus;
  session: Session | null;
  context: SessionContext | null;
  api: ApiGatewayClient;
  supabase: SupabaseClient;
  error: string | null;
  signIn(email: string, password: string): Promise<boolean>;
  signUp(name: string, email: string, password: string, referralCode?: string): Promise<boolean>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}
const SessionContextValue = createContext<SessionValue | null>(null);

function readConfig() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const gateway = process.env.EXPO_PUBLIC_API_GATEWAY_URL?.trim();
  if (!url || !anonKey) {
    throw new Error("EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are required.");
  }
  return { url: url.replace(/\/$/, ""), anonKey, gateway: gateway || `${url.replace(/\/$/, "")}/functions/v1/api-gateway` };
}
const secureStorage = {
  getItem: (key: string) => Platform.OS === "web" ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => Platform.OS === "web" ? AsyncStorage.setItem(key, value) : SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => Platform.OS === "web" ? AsyncStorage.removeItem(key) : SecureStore.deleteItemAsync(key),
};

export function SessionProvider({ children }: PropsWithChildren) {
  const config = useMemo(readConfig, []);
  const sessionRef = useRef<Session | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [context, setContext] = useState<SessionContext | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(config.url, config.anonKey, {
    auth: {
      storage: secureStorage, persistSession: true, autoRefreshToken: true,
      detectSessionInUrl: Platform.OS === "web",
    },
    global: { headers: { "x-skima-client": "skima-logistics-expo" } },
  }), [config]);
  const api = useMemo(() => new ApiGatewayClient({
    apiGatewayUrl: config.gateway, anonKey: config.anonKey,
    getAccessToken: async () => sessionRef.current?.access_token ?? null,
    developmentLogger: __DEV__ ? console.info : undefined,
  }), [config]);

  const apply = useCallback(async (next: Session | null) => {
    sessionRef.current = next;
    setSession(next);
    setError(null);
    if (!next) {
      setContext(null);
      setStatus("unauthenticated");
      return;
    }
    setStatus("authenticated");
    try {
      const nextContext = await api.get("/runtime/session-context", SessionContextSchema);
      if (sessionRef.current?.access_token !== next.access_token) return;
      setContext(nextContext);
    } catch (cause) {
      if (__DEV__) console.info("SKIMA Logistics session context unavailable", cause);
      setContext(null);
    }
  }, [api]);

  useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => { if (alive) void apply(data.session); })
      .catch(() => { if (alive) setStatus("unauthenticated"); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { if (alive) void apply(next); });
    const appState = Platform.OS === "web" ? null : AppState.addEventListener("change", (state) => {
      if (state === "active") supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    return () => { alive = false; data.subscription.unsubscribe(); appState?.remove(); };
  }, [apply, supabase]);

  const value = useMemo<SessionValue>(() => ({
    status, session, context, api, supabase, error,
    signIn: async (email, password) => {
      setError(null);
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (authError || !data.session) {
        setError(authError?.message ?? "We couldn't start your secure session. Try again.");
        return false;
      }
      await apply(data.session);
      return true;
    },
    signUp: async (name, email, password, referralCode) => {
      setError(null);
      const { data, error: authError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(), password,
        options: { data: {
          display_name: name.trim(),
          source: "skima.logistics.mobile",
          referral_code: referralCode?.trim().toUpperCase() || null,
          referral_app_key: "logistics",
        } },
      });
      if (authError) { setError(authError.message); return false; }
      if (data.session) await apply(data.session);
      return Boolean(data.session);
    },
    signOut: async () => {
      setError(null);
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) {
        setError(signOutError.message);
        throw signOutError;
      }
      await apply(null);
    },
    refresh: async () => {
      const current = sessionRef.current;
      if (!current) { await apply(null); return; }
      const { data, error: refreshError } = await supabase.auth.refreshSession({ refresh_token: current.refresh_token });
      if (refreshError || !data.session) { setError("Your secure session could not be refreshed. Check your connection and try again."); return; }
      await apply(data.session);
    },
  }), [status, session, context, api, supabase, error, apply]);

  return <SessionContextValue.Provider value={value}>{children}</SessionContextValue.Provider>;
}

export function useSession() {
  const value = useContext(SessionContextValue);
  if (!value) throw new Error("useSession must be used within SessionProvider.");
  return value;
}
