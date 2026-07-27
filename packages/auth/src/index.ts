import {
  type AuthError,
  createClient,
  type Session,
  type SupabaseClient,
  type SupabaseClientOptions,
  type User,
} from "npm:@supabase/supabase-js@2.110.9";

export interface SupabaseAuthClientConfig {
  readonly supabaseUrl: string;
  readonly anonKey: string;
  readonly options?: SupabaseClientOptions<"public">;
}

export interface EnvironmentReader {
  get(key: string): string | undefined;
}

export interface SignUpInput {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
  readonly redirectTo?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SignInInput {
  readonly email: string;
  readonly password: string;
}

export interface RefreshSessionInput {
  readonly refreshToken: string;
}

export interface AuthResult {
  readonly user: User | null;
  readonly session: Session | null;
}

export interface SupabaseAuthGateway {
  readonly client: SupabaseClient;
  signUp(input: SignUpInput): Promise<AuthResult>;
  signInWithPassword(input: SignInInput): Promise<AuthResult>;
  refreshSession(input: RefreshSessionInput): Promise<AuthResult>;
  getCurrentUser(): Promise<User>;
  signOut(): Promise<void>;
}

export function createSkimaSupabaseClient(config: SupabaseAuthClientConfig): SupabaseClient {
  return createClient(
    requireNonEmpty(config.supabaseUrl, "supabaseUrl"),
    requireNonEmpty(config.anonKey, "anonKey"),
    config.options,
  );
}

export function createSupabaseAuthGateway(client: SupabaseClient): SupabaseAuthGateway {
  return {
    client,
    signUp: (input) => signUp(client, input),
    signInWithPassword: (input) => signInWithPassword(client, input),
    refreshSession: (input) => refreshSession(client, input),
    getCurrentUser: () => getCurrentUser(client),
    signOut: () => signOut(client),
  };
}

export function getClientSafeSupabaseConfig(env: EnvironmentReader): SupabaseAuthClientConfig {
  return {
    supabaseUrl: requireNonEmpty(env.get("SUPABASE_URL"), "SUPABASE_URL"),
    anonKey: requireNonEmpty(env.get("SUPABASE_ANON_KEY"), "SUPABASE_ANON_KEY"),
  };
}

async function signUp(
  client: SupabaseClient,
  input: SignUpInput,
): Promise<AuthResult> {
  const { data, error } = await client.auth.signUp({
    email: requireNonEmpty(input.email, "email"),
    password: requireNonEmpty(input.password, "password"),
    options: {
      data: {
        ...input.metadata,
        ...(input.displayName ? { display_name: input.displayName } : {}),
      },
      emailRedirectTo: input.redirectTo,
    },
  });

  throwIfAuthError(error);

  return {
    user: data.user,
    session: data.session,
  };
}

async function signInWithPassword(
  client: SupabaseClient,
  input: SignInInput,
): Promise<AuthResult> {
  const { data, error } = await client.auth.signInWithPassword({
    email: requireNonEmpty(input.email, "email"),
    password: requireNonEmpty(input.password, "password"),
  });

  throwIfAuthError(error);

  return {
    user: data.user,
    session: data.session,
  };
}

async function refreshSession(
  client: SupabaseClient,
  input: RefreshSessionInput,
): Promise<AuthResult> {
  const { data, error } = await client.auth.refreshSession({
    refresh_token: requireNonEmpty(input.refreshToken, "refreshToken"),
  });

  throwIfAuthError(error);

  return {
    user: data.user,
    session: data.session,
  };
}

async function getCurrentUser(client: SupabaseClient): Promise<User> {
  const { data, error } = await client.auth.getUser();

  throwIfAuthError(error);

  if (!data.user) {
    throw new Error("Supabase Auth did not return a current user.");
  }

  return data.user;
}

async function signOut(client: SupabaseClient): Promise<void> {
  const { error } = await client.auth.signOut();

  throwIfAuthError(error);
}

function throwIfAuthError(error: AuthError | null): void {
  if (error) {
    throw error;
  }
}

function requireNonEmpty(value: string | undefined | null, fieldName: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${fieldName} is required.`);
  }

  return value;
}
