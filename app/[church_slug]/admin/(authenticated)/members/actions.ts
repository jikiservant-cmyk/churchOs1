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

export async function addMember(formData: FormData) {
  let churchSlug = formData.get('churchSlug') as string;
  let searchParams = '';

  try {
    const { supabase, user, churchId: finalChurchId } = await checkChurchAdminAuth(churchSlug);
    
    const firstName = formData.get('firstName') as string;
    const lastName = formData.get('lastName') as string;
    const fullName = `${firstName} ${lastName}`.trim();
    const phone = formData.get('phone') as string;
    const email = formData.get('email') as string;
    const gender = formData.get('gender') as string;
    const birthday = formData.get('birthday') as string;
    const isYouth = formData.get('isYouth') === 'true';
      let formattedPhone = null;
      if (phone) {
        formattedPhone = normalizeUgPhone(phone);
        if (!formattedPhone) {
          searchParams = new URLSearchParams({ error: 'Invalid phone number format. Please enter a valid Ugandan number.' }).toString();
          redirect(`/${churchSlug}/admin/members?${searchParams}`);
        }
      }

      let hasConflict = false;
      if (formattedPhone) {
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
          // Silently ignore to avoid showing an error message as requested
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
      }

      if (!hasConflict) {
        const payload = {
          church_id: finalChurchId,
          full_name: fullName,
          phone_number: formattedPhone || '', // Use empty string instead of null to bypass NOT NULL constraints if empty
          email: email || null,
          gender: gender ? gender.toLowerCase() : null,
          birthday: birthday || null,
          is_youth: isYouth,
          status: 'active'
        };

        console.log('--- INSERTING NEW MEMBER ---', payload);
        console.log('User Role/Metadata payload:', user?.user_metadata);

        const { error } = await supabase
          .schema('church')
          .from('members')
          .insert(payload);

        if (error) {
           console.error('Error adding member:', error);
           searchParams = new URLSearchParams({
             error: `DB Insert Error: ${error.message}${error.details ? ` (${error.details})` : ''}`,
           }).toString();
        }
      }
  } catch (err: any) {
      console.error('Unhandled exception in addMember:', err);
      // Do not swallow NEXT_REDIRECT
      if (err.message === 'NEXT_REDIRECT') {
        throw err;
      }
      searchParams = new URLSearchParams({ error: 'Failed to add member due to application error.' }).toString();
  }

  if (searchParams) {
    redirect(`/${churchSlug}/admin/members?${searchParams}`);
  }

  revalidatePath(`/${churchSlug}/admin/members`);
}

export async function editMember(formData: FormData) {
  let churchSlug = formData.get('churchSlug') as string;
  let memberId = formData.get('memberId') as string;
  let searchParams = '';

  try {
    const { supabase, churchId: finalChurchId } = await checkChurchAdminAuth(churchSlug);
    
    const firstName = formData.get('firstName') as string;
    const lastName = formData.get('lastName') as string;
    const fullName = `${firstName} ${lastName}`.trim();
    const phone = formData.get('phone') as string;
    const gender = formData.get('gender') as string;
    const birthday = formData.get('birthday') as string;
    const isYouth = formData.get('isYouth') === 'true';

    let formattedPhone = phone || '';
    if (phone) {
      const normalized = normalizeUgPhone(phone);
      if (!normalized) {
        searchParams = new URLSearchParams({ error: 'Invalid phone number format. Please enter a valid Ugandan number.' }).toString();
        redirect(`/${churchSlug}/admin/members/edit/${memberId}?${searchParams}`);
      }
      formattedPhone = normalized!;
    }

    const payload = {
      full_name: fullName,
      phone_number: formattedPhone || '',
      gender: gender ? gender.toLowerCase() : null,
      birthday: birthday || null,
      is_youth: isYouth,
    };

    const { error } = await supabase
      .schema('church')
      .from('members')
      .update(payload)
      .eq('id', memberId);

    if (error) {
      console.error('Error updating member:', error);
      searchParams = new URLSearchParams({
        error: `DB Update Error: ${error.message}`,
      }).toString();
    }
  } catch (err: any) {
      console.error('Unhandled exception in editMember:', err);
      if (err.message === 'NEXT_REDIRECT') {
        throw err;
      }
      searchParams = new URLSearchParams({ error: 'Failed to update member.' }).toString();
  }

  if (searchParams) {
    redirect(`/${churchSlug}/admin/members/edit/${memberId}?${searchParams}`);
  }

  revalidatePath(`/${churchSlug}/admin/members`);
  redirect(`/${churchSlug}/admin/members`);
}

export async function bulkAddMembers(churchSlug: string, membersData: any[]) {
  try {
    const { supabase, churchId: finalChurchId } = await checkChurchAdminAuth(churchSlug);

    const payload = membersData.map((member) => {
       // Format phone if needed
       let formattedPhone = member.phone || member.phone_number || member.phoneNumber || '';
       if (formattedPhone) {
         formattedPhone = normalizeUgPhone(String(formattedPhone)) ?? String(formattedPhone).trim();
       }

       let gender = member.gender ? String(member.gender).toLowerCase() : null;
       if (gender !== 'male' && gender !== 'female') gender = null;
       
       let isYouth = member.is_youth || member.isYouth || member.youth || false;
       if (typeof isYouth === 'string') isYouth = isYouth.toLowerCase() === 'true' || isYouth === '1' || isYouth.toLowerCase() === 'yes';

       const firstName = member.first_name || member.firstName || '';
       const lastName = member.last_name || member.lastName || '';
       let fullName = member.full_name || member.fullName || member.name || '';
       
       if (!fullName && (firstName || lastName)) {
         fullName = `${firstName} ${lastName}`.trim();
       }

       return {
         church_id: finalChurchId,
         full_name: fullName || 'Unknown',
         phone_number: formattedPhone,
         email: member.email || null,
         gender,
         birthday: member.birthday || member.dob || null,
         is_youth: !!isYouth,
         status: 'active'
       };
    });

    const { error } = await supabase
      .schema('church')
      .from('members')
      .insert(payload);

    if (error) {
       console.error('Error in bulk insert:', error);
       return { error: `DB Bulk Insert Error: ${error.message}` };
    }
    
    revalidatePath(`/${churchSlug}/admin/members`);
    return { success: true };
  } catch (err: any) {
    console.error('Unhandled exception in bulkAddMembers:', err);
    return { error: 'Failed to bulk-add members due to application error.' };
  }
}
