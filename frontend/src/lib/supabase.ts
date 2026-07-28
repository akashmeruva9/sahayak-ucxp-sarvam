import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client for auth only.
 *
 * `@supabase/supabase-js` is pure JavaScript, so it needs no native module and
 * no `expo prebuild` — which matters here, because prebuild regenerates
 * `android/` and wipes the hand-patched node_modules the Gradle build depends
 * on (PLAN.md §7 #14).
 *
 * Sessions persist through AsyncStorage, already compiled into the APK.
 *
 * This client holds the **anon** key. It is public by design and safe in a
 * shipped bundle — row-level security is what protects data. The service_role
 * key must never appear here; it lives only in the runtime's server env.
 */
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

/** False when the build has no Supabase config — the app then runs signed-out. */
export const authConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase: SupabaseClient | null = authConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        // Keep the user signed in across restarts; refresh silently.
        persistSession: true,
        autoRefreshToken: true,
        // No URL-based session detection: there is no OAuth redirect to parse,
        // and on web this would try to read a hash fragment that never exists.
        detectSessionInUrl: false,
      },
    })
  : null;

if (__DEV__ && !authConfigured) {
  console.log(
    "[auth] Supabase not configured — set EXPO_PUBLIC_SUPABASE_URL and " +
      "EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.local to enable sign-in."
  );
}
