import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.110.9";

import { jsonResponse } from "./http.ts";

export interface AuthenticatedUserResult {
  readonly user: User;
}

export interface AuthenticationFailureResult {
  readonly response: Response;
}

export async function requireAuthenticatedUser(
  request: Request,
  requestId: string,
): Promise<AuthenticatedUserResult | AuthenticationFailureResult> {
  const authorization = request.headers.get("authorization");

  if (!authorization || !/^bearer\s+\S+$/i.exec(authorization)) {
    return unauthorizedResponse(requestId);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !anonKey) {
    return {
      response: jsonResponse(
        {
          ok: false,
          error: "server_misconfigured",
          requestId,
        },
        500,
      ),
    };
  }

  const supabase = createRequestSupabaseClient(request, supabaseUrl, anonKey);

  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return unauthorizedResponse(requestId);
  }

  return { user: data.user };
}

function unauthorizedResponse(requestId: string): AuthenticationFailureResult {
  return {
    response: jsonResponse(
      {
        ok: false,
        error: "unauthorized",
        requestId,
      },
      401,
      { "WWW-Authenticate": "Bearer" },
    ),
  };
}

export function createRequestSupabaseClient(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
): SupabaseClient {
  const authorization = request.headers.get("authorization") ?? "";

  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: authorization,
      },
    },
  });
}
