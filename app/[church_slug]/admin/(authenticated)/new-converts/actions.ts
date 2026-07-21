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

export async function addNewConvert(formData: FormData) {
  let searchParams = '';
  
  const name = formData.get('name') as string;
  const contact = formData.get('contact') as string;
  const churchSlug = formData.get('churchSlug') as string;
  
  try {
    const { supabase, churchId: finalChurchId } = await checkChurchAdminAuth(churchSlug);

    let formattedPhone = contact.trim();
    if (formattedPhone) {
      const normalized = normalizeUgPhone(formattedPhone);
      if (!normalized) {
        searchParams = new URLSearchParams({ error: 'Invalid phone number format. Please enter a valid Ugandan number.' }).toString();
        redirect(`/${churchSlug}/admin/new-converts?${searchParams}`);
      }
      formattedPhone = normalized!;

      let hasConflict = false;

      // Check if phone number already exists in members
      const { data: existingMember } = await supabase
        .schema('church')
        .from('members')
        .select('id')
        .eq('church_id', finalChurchId)
        .eq('phone_number', formattedPhone)
        .maybeSingle();

      if (existingMember) {
        hasConflict = true;
        // Silently ignore
      }

      if (!hasConflict) {
        // Check if phone number already exists in new_converts
        const { data: existingConvert } = await supabase
          .schema('church')
          .from('new_converts')
          .select('id')
          .eq('church_id', finalChurchId)
          .eq('contact', formattedPhone)
          .maybeSingle();
        
        if (existingConvert) {
          hasConflict = true;
          // Silently ignore
        }
      }

      if (!hasConflict) {
        const payload = {
          church_id: finalChurchId,
          name: name.trim(),
          contact: formattedPhone,
        };

        const { error } = await supabase
          .schema('church')
          .from('new_converts')
          .insert(payload);

        if (error) {
          console.error('Error adding new convert:', error);
          searchParams = new URLSearchParams({
            error: `DB Insert Error: ${error.message}${error.details ? ` (${error.details})` : ''}`,
          }).toString();
        }
      }
    }
  } catch (err: any) {
    console.error('Unhandled exception in addNewConvert:', err);
    if (err.message === 'NEXT_REDIRECT') throw err;
    searchParams = new URLSearchParams({ error: 'Failed to add new convert due to application error.' }).toString();
  }

  if (searchParams) {
    redirect(`/${churchSlug}/admin/new-converts?${searchParams}`);
  }

  revalidatePath(`/${churchSlug}/admin/new-converts`);
}

export async function editNewConvert(formData: FormData) {
  const churchSlug = formData.get('churchSlug') as string;
  const convertId = formData.get('convertId') as string;
  const name = formData.get('name') as string;
    const contact = formData.get('contact') as string;
  let searchParams = '';

  try {
    const { supabase } = await checkChurchAdminAuth(churchSlug);

    const payload = {
      name,
      contact,
    };

    const { error } = await supabase
      .schema('church')
      .from('new_converts')
      .update(payload)
      .eq('id', convertId);

    if (error) {
      console.error('Error updating new convert:', error);
      searchParams = new URLSearchParams({
        error: `DB Update Error: ${error.message}`,
      }).toString();
    }
  } catch (err: any) {
    console.error('Unhandled exception in editNewConvert:', err);
    if (err.message === 'NEXT_REDIRECT') {
      throw err;
    }
    searchParams = new URLSearchParams({ error: 'Failed to update convert.' }).toString();
  }

  if (searchParams) {
    redirect(`/${churchSlug}/admin/new-converts/edit/${convertId}?${searchParams}`);
  }

  revalidatePath(`/${churchSlug}/admin/new-converts`);
  redirect(`/${churchSlug}/admin/new-converts`);
}

export async function bulkAddNewConverts(churchSlug: string, convertsData: any[]) {
  try {
    const { supabase, churchId: finalChurchId } = await checkChurchAdminAuth(churchSlug);

    const payload = convertsData.map((convert) => {
       let formattedPhone = convert.contact || convert.phone || convert.phone_number || '';
       if (formattedPhone) {
         formattedPhone = String(formattedPhone).trim();
         try {
           formattedPhone = normalizeUgPhone(formattedPhone) ?? formattedPhone;
         } catch(e) {
           // keep original if something unexpected throws
         }
       }

       return {
         church_id: finalChurchId,
         name: String(convert.name || convert.full_name || convert.fullName || 'Unknown').trim(),
         contact: formattedPhone,
       };
    });

    const { error } = await supabase
      .schema('church')
      .from('new_converts')
      .insert(payload);

    if (error) {
       console.error('Error in bulk insert new converts:', error);
       return { error: `DB Bulk Insert Error: ${error.message}` };
    }
    
    revalidatePath(`/${churchSlug}/admin/new-converts`);
    return { success: true };
  } catch (err: any) {
    console.error('Unhandled exception in bulkAddNewConverts:', err);
    return { error: 'Failed to bulk-add new converts due to application error.' };
  }
}
