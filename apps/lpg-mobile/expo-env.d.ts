/// <reference types="expo/types" />

declare namespace NodeJS {
  interface ProcessEnv {
    readonly EXPO_PUBLIC_SUPABASE_URL?: string;
    readonly EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
    readonly EXPO_PUBLIC_API_GATEWAY_URL?: string;
    readonly EXPO_PUBLIC_EAS_PROJECT_ID?: string;
  }
}
