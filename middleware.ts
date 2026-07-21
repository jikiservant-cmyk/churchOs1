import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // Skip Supabase auth check if env vars are missing (for local dev without Supabase)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, { ...options, sameSite: 'none', secure: true })
          );
        },
      },
    }
  );

  // Refresh session if expired
  try {
    const { data: { user } } = await supabase.auth.getUser();

    // Protective Routing for Admin
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    
    // Check if we are in an admin route: /[slug]/admin/...
    if (pathParts.length >= 3 && pathParts[2] === 'admin' && pathParts[3] !== 'login') {
      if (!user) {
        return NextResponse.redirect(new URL(`/?error=Session Expired`, request.url));
      }
      
      // We can't easily check the DB in middleware without a performance hit, 
      // but we can at least ensure the user exists.
      // The Layout will still do the fine-grained role/church check, 
      // but the middleware will catch the most common "unauthenticated" case.
    }
  } catch (e) {
    console.error("Middleware Auth Error:", e);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
