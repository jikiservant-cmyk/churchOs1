import { getChurchBySlug } from '@/lib/db';
import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';

export async function requireTenant(churchSlug: string) {
  const church = await getChurchBySlug(churchSlug);
  if (!church) {
    notFound();
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect(`/?error=Session Expired`);
  }

  const { data: profile } = await supabase
    .from('admin_profiles')
    .select('role, tenant_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || profile.role !== 'pastor' || !profile.tenant_id) {
    redirect(`/?error=Access Denied`);
  }

  if (profile.tenant_id !== church.id) {
    const { data: correctChurch } = await supabase
      .schema('church')
      .from('churches')
      .select('slug')
      .eq('id', profile.tenant_id)
      .maybeSingle();

    if (correctChurch?.slug && correctChurch.slug !== churchSlug) {
      redirect(`/${correctChurch.slug}/admin`);
    } else {
      redirect(`/?error=Church Mismatch`);
    }
  }

  return { church, user, profile, supabase };
}

export async function assertChurchAdminAuth(churchSlug: string) {
  const canonical = churchSlug.toLowerCase().trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(canonical)) {
    throw new Error('Invalid church identifier');
  }

  const church = await getChurchBySlug(canonical);
  if (!church) throw new Error('Church not found');

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Unauthenticated');

  const { data: profile } = await supabase
    .from('admin_profiles')
    .select('role, tenant_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || profile.tenant_id !== church.id) {
    throw new Error('Unauthorized to perform this action for this church');
  }

  return { supabase, user, church, churchId: church.id };
}
