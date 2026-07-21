'use server';

import { createAdminClient, createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

export type ProvisionState = {
  error?: string;
  success?: boolean;
  tenantId?: string;
  slug?: string;
  appType?: 'church';
};

export async function provisionTenant(prevState: ProvisionState, formData: FormData): Promise<ProvisionState> {
  const name = (formData.get('name') as string || '').trim();
  const rawSlug = (formData.get('slug') as string || '').toLowerCase().trim();
  const appType = 'church';

  // IP detection for scam prevention
  const headerList = await headers();
  const ip = headerList.get('x-forwarded-for')?.split(',')[0] || 
             headerList.get('x-real-ip') || 
             'unknown';

  // 0. Robust Input Validation
  if (!name || name.length < 3 || name.length > 50) {
    return { error: 'Church name must be between 3 and 50 characters' };
  }

  // Regex for slug: lowercase letters, numbers, and single hyphens, no start/end hyphen
  const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  if (!rawSlug || !slugRegex.test(rawSlug) || rawSlug.length < 3 || rawSlug.length > 30) {
    return { error: 'Invalid workspace URL. Use lowercase letters, numbers and hyphens (e.g. grace-church)' };
  }

  // Simple Blacklist for slugs
  const blacklist = ['admin', 'portal', 'api', 'auth', 'signup', 'login', 'pastoros', 'root'];
  if (blacklist.includes(rawSlug)) {
    return { error: 'This workspace URL is reserved. Please choose another.' };
  }

  const supabase = await createClient();
  const adminSupabase = await createAdminClient();

  // 1. Get and Verify User
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: 'You must be logged in to provision a church.' };
  }

  // 1.1 Secure Rate Limiting: Check if user already has a tenant
  const { data: existingProfile } = await adminSupabase
    .from('admin_profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .maybeSingle();

  if (existingProfile?.tenant_id) {
    return { error: 'Your account is already associated with a ministry workspace.' };
  }

  // 1.2 IP Rate Limiting: Check if IP has already registered a church
  if (ip !== 'unknown' && ip !== '127.0.0.1' && ip !== '::1') {
    const { data: ipChurch } = await adminSupabase
      .schema('church')
      .from('churches')
      .select('id')
      .eq('ip_address', ip)
      .maybeSingle();

    if (ipChurch) {
      return { error: 'Only one church registration is allowed per network/location to prevent scams.' };
    }
  }

  let currentStep = 'initializing';
  try {
    // 0. Robust Input Sanitization (Unicode Normalization)
    const sanitizedName = name.normalize('NFKC');
    const sanitizedSlug = rawSlug.normalize('NFKC');

    currentStep = 'calling-rpc';
    
    // Use the atomic RPC to handle everything in one transaction
    const { data: tenantId, error: rpcError } = await adminSupabase
      .rpc('provision_church_v2', {
        p_user_id: user.id,
        p_name: sanitizedName,
        p_slug: sanitizedSlug,
        p_role: 'pastor'
      });

    if (rpcError) {
      const errorStr = JSON.stringify(rpcError, null, 2);
      console.error('[Provisioning] RPC error details:', errorStr);
      return { error: rpcError.message || `Provisioning failed: ${errorStr}` };
    }

    if (!tenantId) {
      throw new Error('Provisioning failed: No tenant ID returned');
    }

    console.log('[Provisioning] Success!', { tenantId, slug: sanitizedSlug });
    
    // We navigate on the client side to avoid some Next.js 15 action state issues with redirect
    return { 
      success: true, 
      tenantId, 
      slug: sanitizedSlug,
      appType 
    };

  } catch (err: any) {
    if (err.message === 'NEXT_REDIRECT' || err.__next_redirect) throw err;
    console.error(`[Provisioning] Error at step ${currentStep}:`, err);
    let errorMessage = 'An unknown error occurred';
    
    if (typeof err === 'string') {
      errorMessage = err;
    } else if (err instanceof Error) {
      errorMessage = err.message;
    } else if (err && typeof err === 'object') {
      // Handle Supabase PostgREST error objects
      errorMessage = err.message || err.details || err.hint || JSON.stringify(err);
    }
    
    return { error: `Provisioning failed: ${errorMessage}` };
  }
}
