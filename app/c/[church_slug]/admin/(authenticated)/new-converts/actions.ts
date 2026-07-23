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

    let finalContact = contact.trim();
    let hasConflict = false;

    // Try to normalize as phone for conflict checks, but if it's not a valid phone, just use the raw input
    let normalizedPhone = null;
    if (finalContact) {
      normalizedPhone = normalizeUgPhone(finalContact);
      
      if (normalizedPhone) {
        // Only check for conflicts if it's a valid phone number
        // Check if phone number already exists in members
        const { data: existingMember } = await supabase
          .schema('church')
          .from('members')
          .select('id')
          .eq('church_id', finalChurchId)
          .eq('phone_number', normalizedPhone)
          .maybeSingle();

        if (existingMember) {
          hasConflict = true;
        }

        if (!hasConflict) {
          // Check if phone number already exists in new_converts
          const { data: existingConvert } = await supabase
            .schema('church')
            .from('new_converts')
            .select('id')
            .eq('church_id', finalChurchId)
            .eq('contact', normalizedPhone)
            .maybeSingle();
          
          if (existingConvert) {
            hasConflict = true;
          }
        }
      }
    }

    if (!hasConflict) {
      // Save the raw contact input, not just normalized phone!
      const payload = {
        church_id: finalChurchId,
        name: name.trim(),
        contact: finalContact || null,
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
       let rawContact = convert.contact || convert.phone || convert.phone_number || '';
       let finalContact = rawContact.trim() || null;
       
       // No need to normalize for bulk insert, just save the raw contact
       return {
         church_id: finalChurchId,
         name: String(convert.name || convert.full_name || convert.fullName || 'Unknown').trim(),
         contact: finalContact,
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
