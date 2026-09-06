import { createBrowserClient } from '@supabase/ssr';

/** Browser client. Only ever sees the publishable key — RLS does the rest. */
export const createClient = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
