'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { normalizeUgPhone } from '@/lib/utils';

async function checkChurchAdminAuth(churchSlug: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthenticated');

  const adminSupabase = await createAdminClient();
  const { data: church } = await adminSupabase.schema('church').from('churches').select('id').eq('slug', churchSlug).single();
  if (!church) throw new Error('Church not found');

  const { data: profile } = await adminSupabase.from('admin_profiles').select('tenant_id').eq('id', user.id).eq('tenant_id', church.id).single();
  if (!profile) throw new Error('Unauthorized to perform this action for this church');

  return { supabase, user, churchId: church.id };
}

export async function addVisitor(formData: FormData) {
  let churchSlug = formData.get('churchSlug') as string;
  let searchParams = '';

  try {
    const { supabase, churchId: finalChurchId } = await checkChurchAdminAuth(churchSlug);

    const fullName = formData.get('fullName') as string;
    const phoneNumber = formData.get('phoneNumber') as string;
    const email = formData.get('email') as string;
    const gender = formData.get('gender') as string;
    const birthday = formData.get('birthday') as string;
    const visitorType = formData.get('visitorType') as string;
    const source = formData.get('source') as string;
    const homeChurchName = formData.get('homeChurchName') as string;
    const homeChurchCity = formData.get('homeChurchCity') as string;
    const homeChurchPastor = formData.get('homeChurchPastor') as string;
    const notes = formData.get('notes') as string;

    let formattedPhone = phoneNumber.trim() || null;
    if (phoneNumber) {
      const normalized = normalizeUgPhone(phoneNumber);
      if (normalized) {
        formattedPhone = normalized;
      }
    }

    const payload = {
      church_id: finalChurchId,
      full_name: fullName,
      phone_number: formattedPhone,
      email: email || null,
      gender: gender ? gender.toLowerCase() : null,
      birthday: birthday || null,
      visitor_type: visitorType || 'first_time',
      source: source || null,
      home_church_name: homeChurchName || null,
      home_church_city: homeChurchCity || null,
      home_church_pastor: homeChurchPastor || null,
      notes: notes || null
    };

    const { error } = await supabase
      .schema('church')
      .from('visitors')
      .insert(payload);

    if (error) {
      console.error('Error adding visitor:', error);
      searchParams = new URLSearchParams({
        error: `DB Insert Error: ${error.message}${error.details ? ` (${error.details})` : ''}`,
      }).toString();
    }
  } catch (err: any) {
    console.error('Unhandled exception in addVisitor:', err);
    if (err.message === 'NEXT_REDIRECT') {
      throw err;
    }
    searchParams = new URLSearchParams({ error: 'Failed to add visitor due to application error.' }).toString();
  }

  if (searchParams) {
    redirect(`/${churchSlug}/admin/visitors?${searchParams}`);
  }

  revalidatePath(`/${churchSlug}/admin/visitors`);
}

export async function editVisitor(formData: FormData) {
  let churchSlug = formData.get('churchSlug') as string;
  let visitorId = formData.get('visitorId') as string;
  let searchParams = '';

  try {
    const { supabase, churchId: finalChurchId } = await checkChurchAdminAuth(churchSlug);

    const fullName = formData.get('fullName') as string;
    const phoneNumber = formData.get('phoneNumber') as string;
    const email = formData.get('email') as string;
    const gender = formData.get('gender') as string;
    const birthday = formData.get('birthday') as string;
    const visitorType = formData.get('visitorType') as string;
    const source = formData.get('source') as string;
    const homeChurchName = formData.get('homeChurchName') as string;
    const homeChurchCity = formData.get('homeChurchCity') as string;
    const homeChurchPastor = formData.get('homeChurchPastor') as string;
    const notes = formData.get('notes') as string;

    let formattedPhone = phoneNumber.trim() || null;
    if (phoneNumber) {
      const normalized = normalizeUgPhone(phoneNumber);
      if (normalized) {
        formattedPhone = normalized;
      }
    }

    const payload = {
      full_name: fullName,
      phone_number: formattedPhone,
      email: email || null,
      gender: gender ? gender.toLowerCase() : null,
      birthday: birthday || null,
      visitor_type: visitorType || 'first_time',
      source: source || null,
      home_church_name: homeChurchName || null,
      home_church_city: homeChurchCity || null,
      home_church_pastor: homeChurchPastor || null,
      notes: notes || null
    };

    const { error } = await supabase
      .schema('church')
      .from('visitors')
      .update(payload)
      .eq('id', visitorId);

    if (error) {
      console.error('Error updating visitor:', error);
      searchParams = new URLSearchParams({
        error: `DB Update Error: ${error.message}`,
      }).toString();
    }
  } catch (err: any) {
    console.error('Unhandled exception in editVisitor:', err);
    if (err.message === 'NEXT_REDIRECT') {
      throw err;
    }
    searchParams = new URLSearchParams({ error: 'Failed to update visitor.' }).toString();
  }

  if (searchParams) {
    redirect(`/${churchSlug}/admin/visitors/edit/${visitorId}?${searchParams}`);
  }

  revalidatePath(`/${churchSlug}/admin/visitors`);
  redirect(`/${churchSlug}/admin/visitors`);
}

export async function bulkAddVisitors(churchSlug: string, visitorsData: any[]) {
  try {
    const { supabase, churchId: finalChurchId } = await checkChurchAdminAuth(churchSlug);

    const payload = visitorsData.map((visitor) => {
      let rawPhone = visitor.phoneNumber || visitor.phone_number || '';
      let formattedPhone = rawPhone.trim() || null;
      
      if (rawPhone) {
        const normalized = normalizeUgPhone(String(rawPhone));
        if (normalized) {
          formattedPhone = normalized;
        }
      }

      let gender = visitor.gender ? String(visitor.gender).toLowerCase() : null;
      if (gender !== 'male' && gender !== 'female') gender = null;

      return {
        church_id: finalChurchId,
        full_name: visitor.fullName || visitor.full_name || visitor.name || 'Unknown',
        phone_number: formattedPhone,
        email: visitor.email || null,
        gender,
        birthday: visitor.birthday || null,
        visitor_type: visitor.visitorType || visitor.visitor_type || 'first_time',
        source: visitor.source || null,
        home_church_name: visitor.homeChurchName || visitor.home_church_name || null,
        home_church_city: visitor.homeChurchCity || visitor.home_church_city || null,
        home_church_pastor: visitor.homeChurchPastor || visitor.home_church_pastor || null,
        notes: visitor.notes || null
      };
    });

    const { error } = await supabase
      .schema('church')
      .from('visitors')
      .insert(payload);

    if (error) {
      console.error('Error in bulk insert:', error);
      return { error: `DB Bulk Insert Error: ${error.message}` };
    }

    revalidatePath(`/${churchSlug}/admin/visitors`);
    return { success: true };
  } catch (err: any) {
    console.error('Unhandled exception in bulkAddVisitors:', err);
    return { error: 'Failed to bulk-add visitors due to application error.' };
  }
}
