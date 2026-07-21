import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Return a dummy client that will fail gracefully instead of crashing on init if envs are missing
    // We provide basic mock methods to prevent "undefined is not a function" crashes if code tries to use it.
    return {
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        getUser: async () => ({ data: { user: null }, error: null }),
        getSession: async () => ({ data: { session: null }, error: null }),
      }
    } as any;
  }

  return createBrowserClient(
    url,
    key,
    {
      cookieOptions: {
        sameSite: 'none',
        secure: true,
      }
    }
  );
}
