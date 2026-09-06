import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server client, bound to the request's cookies.
 *
 * Runs on the signed-in user's own token, never a service key — so every
 * query the app makes is still subject to the same row-level security a
 * malicious client would hit. A service key in the request path would make
 * every RLS policy in the schema decorative.
 */
export function createClient() {
  const store = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    }
  );
}
