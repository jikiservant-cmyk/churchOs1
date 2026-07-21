import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Return a dummy client that will fail on actual requests but won't crash the server during boot/SSR
    return createServerClient(
      'https://placeholder.supabase.co',
      'placeholder-key',
      { cookies: { getAll: () => [], setAll: () => {} } }
    );
  }

  return createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              // Force SameSite=None and Secure for iframe support
              cookieStore.set(name, value, { ...options, sameSite: 'none', secure: true })
            });
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  );
}

export async function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    // Return a dummy client that will fail on actual requests but won't crash the server during boot/SSR
    return createServerClient(
      'https://placeholder.supabase.co',
      'placeholder-key',
      { cookies: { getAll: () => [], setAll: () => {} } }
    );
  }

  return createServerClient(
    url,
    key,
    {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
    }
  );
}
