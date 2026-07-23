'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export type AuthState = {
  error?: string;
  success?: boolean;
  redirectTo?: string;
};

export async function login(prevState: AuthState, formData: FormData): Promise<AuthState> {
  const email = (formData.get('email') as string || '').trim();
  const password = formData.get('password') as string;
  const churchSlug = formData.get('churchSlug') as string;

  if (!email || !password) {
    return { error: 'Email and password are required' };
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { error: 'Supabase not configured' };
  }

  try {
    const supabase = await createClient();
    
    // 1. Sign in with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.user) {
      return { error: authError?.message || 'Login failed' };
    }

    // 2. Verify Role and find Church Slug in admin_profiles
    let profile = null;
    let profileError = null;

    console.log(`[Auth] Looking for admin profile for user: ${authData.user.id} (${email})`);

    // Attempt 1: Fetch by ID
    const { data: idData, error: idError } = await supabase
      .from('admin_profiles')
      .select('role, tenant_id, email, app_type')
      .eq('id', authData.user.id)
      .maybeSingle();
    
    console.log(`[Auth] Attempt 1 (by ID): data=`, idData, `error=`, idError);
    
    if (idData) {
      profile = idData;
    } else {
      profileError = idError;
    }

    // Attempt 2: Fallback to Email
    if (!profile && !profileError) {
      const { data: emailData, error: emailError } = await supabase
        .from('admin_profiles')
        .select('role, tenant_id, email, app_type')
        .eq('email', email)
        .maybeSingle();
      
      console.log(`[Auth] Attempt 2 (by Email): data=`, emailData, `error=`, emailError);
      
      if (emailData) {
        profile = emailData;
      } else {
        profileError = emailError;
      }
    }

    if (profileError || !profile) {
      await supabase.auth.signOut();
      return { error: 'Access Denied: You are not authorized to access this portal.' };
    }

    // Allow strictly pastor roles for this app
    const authorizedRoles = ['pastor'];
    if (!authorizedRoles.includes(profile.role.toLowerCase())) {
      await supabase.auth.signOut();
      return { error: `Access Denied: Role '${profile.role}' does not have admin access.` };
    }

    // 3. Get the correct slug from churches
    let targetSlug = churchSlug;
    const tenantId = profile.tenant_id;
    const appType = profile.app_type;
    
    console.log(`[Auth] Profile found! role=${profile.role}, tenant_id=${tenantId}, app_type=${appType}, initial targetSlug=${targetSlug}`);
    
    if (tenantId) {
      if (appType === 'church' || (!appType && profile.role === 'pastor')) {
        // Use Admin Client to query church schema, bypassing RLS!
        const adminSupabase = await createAdminClient();
        const { data: church, error: churchError } = await adminSupabase
          .schema('church')
          .from('churches')
          .select('slug')
          .eq('id', tenantId)
          .maybeSingle();
        
        console.log(`[Auth] Church lookup (Admin Client): id=${tenantId}, data=`, church, `error=`, churchError);
        
        if (church?.slug) {
          targetSlug = church.slug;
          console.log(`[Auth] Updated targetSlug to ${targetSlug}`);
        }
      }
    }

    console.log(`[Auth] User authorized. Redirecting to /${targetSlug}/admin`);
    redirect(`/${targetSlug}/admin`);
  } catch (err: any) {
    if (err.message === 'NEXT_REDIRECT' || err.__next_redirect) throw err;
    console.error('[Auth] Login exception:', err);
    return { error: err.message || 'An unexpected error occurred during login.' };
  }
}

export async function signup(prevState: AuthState, formData: FormData): Promise<AuthState> {
  const email = (formData.get('email') as string || '').trim();
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Email and password are required' };
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { error: 'Auth service not configured properly' };
  }

  try {
    const supabase = await createClient();
    console.log('[Auth] Attempting signup for:', email);
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      console.error('[Auth] Signup error:', error.message);
      if (error.message.toLowerCase().includes('already registered')) {
        return { error: 'This email is already registered. Please login instead.' };
      }
      return { error: error.message };
    }

    if (!data.user) {
      return { error: 'Account creation failed. Please try again.' };
    }

    console.log('[Auth] Signup success for:', email);
    return { success: true, redirectTo: '/signup/provision' };
  } catch (err: any) {
    if (err.message === 'NEXT_REDIRECT' || err.__next_redirect) throw err;
    console.error('[Auth] Critical signup exception:', err);
    return { error: 'An unexpected error occurred. Please try again later.' };
  }
}

export async function logout(formData: FormData) {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  
  redirect(`/`);
}
