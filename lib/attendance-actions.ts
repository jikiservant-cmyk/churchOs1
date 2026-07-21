'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { ChurchEvent, AttendanceLog, AttendanceFlag, AttendanceFlagStatus } from './attendance-types';
import { SignJWT, jwtVerify } from 'jose';
import { sendSingleSMS } from './sms-actions';

function getJwtSecret(): Uint8Array {
  const jwtSecretValue = process.env.USHER_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!jwtSecretValue) {
    throw new Error('USHER_JWT_SECRET (or SUPABASE_SERVICE_ROLE_KEY) environment variable is not set. Cannot sign usher sessions.');
  }
  return new TextEncoder().encode(jwtSecretValue);
}

export async function validateUsherPasskey(churchSlug: string, passkey: string) {
  try {
    console.log('[validateUsherPasskey] Validating for slug:', churchSlug);
    const supabase = await createAdminClient();
    
    // Use ilike logic or explicit lowercase to ensure slug matches even if URL is mixed case
    const { data: church } = await supabase
      .schema('church')
      .from('churches')
      .select('id, name, passkey')
      .ilike('slug', churchSlug)
      .maybeSingle();

    if (!church) {
      console.error('[validateUsherPasskey] No church found for slug:', churchSlug);
      return { success: false, error: 'Church not found.' };
    }

    console.log('[validateUsherPasskey] Found church:', church.name, 'Expected Passkey:', church.passkey);

    if (church.passkey?.toUpperCase() !== passkey.toUpperCase()) {
      return { success: false, error: 'Invalid passkey. Please check and try again.' };
    }

    const churchId = church.id;
    const churchName = church.name;

    // 2. Create a cryptographically signed JWT for the session
    const token = await new SignJWT({
      church_id: churchId,
      church_name: churchName,
      church_slug: churchSlug.toLowerCase(),
      role: 'usher'
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(getJwtSecret());

    const cookieStore = await cookies();
    const cookieName = `usher_session_${churchSlug.toLowerCase()}`;
    
    cookieStore.set(cookieName, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 // 24 hours
    });

    revalidatePath(`/${churchSlug}/usher/dashboard`);
    return { success: true, churchName };

  } catch (error) {
    console.error('CRITICAL: validateUsherPasskey error:', error);
    return { 
      success: false, 
      error: 'An unexpected security or network error occurred' 
    };
  }
}

export async function getUsherSession(churchSlug: string) {
  const cookieStore = await cookies();
  const cookieName = `usher_session_${churchSlug.toLowerCase()}`;
  const token = cookieStore.get(cookieName)?.value;
  
  if (!token) return null;
  
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return payload as any;
  } catch (e) {
    console.error('Usher session verification failed:', e);
    return null;
  }
}

export async function logoutUsher(churchSlug: string) {
  const cookieStore = await cookies();
  const cookieName = `usher_session_${churchSlug.toLowerCase()}`;
  cookieStore.delete(cookieName);
  return { success: true };
}

export async function createEvent(formData: FormData, churchId: string, churchSlug: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    console.error('CreateEvent: No authenticated user found');
    return { error: 'You must be logged in to create services.' };
  }

  const name = formData.get('name') as string;
  const serviceType = formData.get('service_type') as 'sunday_service' | 'bible_study' | 'prayer_meeting' | 'youth_service';
  const eventDate = formData.get('event_date') as string;
  const startTime = formData.get('start_time') as string;
  const location = formData.get('location') as string;

  console.log('Creating event for church:', churchId, 'by user:', user.id);

  const { error } = await supabase
    .schema('church')
    .from('events')
    .upsert({
      church_id: churchId,
      name,
      service_type: serviceType,
      event_date: eventDate,
      start_time: startTime,
      location,
      status: 'upcoming',
      created_by: user.id
    }, { 
      onConflict: 'church_id,service_type,event_date,start_time' 
    });

  if (error) {
    console.error('Error creating event:', error);
    // If we get an RLS error, it usually manifests as a 42501 or just a generic failure
    return { error: error.message || 'Failed to create event. This might be due to a unique constraint or RLS policy.' };
  }

  revalidatePath(`/${churchSlug}/admin/attendance`);
  return { success: true };
}

export async function updateEventStatus(eventId: string, status: 'upcoming' | 'active' | 'completed', churchSlug: string) {
  try {
    const supabase = await createClient();
    
    // Auto-mark absentees when an event is finalized
    if (status === 'completed') {
      const adminClient = await createAdminClient();
      const { data: event } = await adminClient.schema('church').from('events').select('church_id').eq('id', eventId).single();
      
      if (event) {
        const { data: allMembers } = await adminClient.schema('church').from('members').select('id').eq('church_id', event.church_id).eq('status', 'active');
        const { data: logs } = await adminClient.schema('church').from('attendance_logs').select('member_id').eq('event_id', eventId);
        
        if (allMembers && logs) {
          const attendedIds = new Set(logs.map(l => l.member_id));
          const absentMembers = allMembers.filter(m => !attendedIds.has(m.id));
          
          if (absentMembers.length > 0) {
            const absentLogs = absentMembers.map(m => ({
              church_id: event.church_id,
              event_id: eventId,
              member_id: m.id,
              attendance_status: 'absent'
            }));
            
            // Use upsert to be safe and avoid unique constraint conflicts
            const { error: insertError } = await adminClient
              .schema('church')
              .from('attendance_logs')
              .upsert(absentLogs, { onConflict: 'member_id,event_id' });

            if (insertError) {
              console.error('[updateEventStatus] Failed to auto-mark absentees:', insertError);
            }
          }
        }
      }
    }

    const { error } = await supabase
      .schema('church')
      .from('events')
      .update({ status })
      .eq('id', eventId);

    if (error) return { error: error.message };
    
    revalidatePath(`/${churchSlug}/admin/attendance`);
    revalidatePath(`/${churchSlug}/admin/attendance/${eventId}`);
    revalidatePath(`/${churchSlug}/usher/dashboard`);
    return { success: true };
  } catch (error) {
    return { error: 'A network or server error occurred.' };
  }
}

export async function claimAdminAccess(churchId: string, churchSlug: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) return { error: 'Not authenticated' };
    
    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase.from('admin_profiles').upsert({
      id: user.id,
      tenant_id: churchId,
      email: user.email,
      role: 'pastor',
      full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Admin'
    });

    if (error) return { error: error.message };

    revalidatePath(`/${churchSlug}/admin/attendance`);
    return { success: true };
  } catch (error) {
    return { error: 'Failed to claim access.' };
  }
}

export async function updateChurchPasskey(churchId: string, newPasskey: string, churchSlug: string) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) return { error: 'Not authenticated' };

    // Verify Admin Access
    const { data: profile } = await supabase
      .from('admin_profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .eq('tenant_id', churchId)
      .maybeSingle();

    if (!profile) return { error: 'Access denied' };

    const adminSupabase = await createAdminClient();
    const { error } = await adminSupabase
      .schema('church')
      .from('churches')
      .update({ passkey: newPasskey })
      .eq('id', churchId);

    if (error) {
      console.error('[updateChurchPasskey] Error:', error);
      return { error: error.message };
    }

    revalidatePath(`/${churchSlug}/admin/attendance`);
    return { success: true };
  } catch (error) {
    console.error('[updateChurchPasskey] Unexpected error:', error);
    return { error: 'Failed to update passkey.' };
  }
}

export async function getEventAttendanceData(churchSlug: string, eventId: string) {
  try {
    const supabase = await createClient();

    // Fetch church first so we have the ID for the members query
    const { data: church } = await supabase
      .schema('church')
      .from('churches')
      .select('id, passkey, name')
      .eq('slug', churchSlug)
      .single();

    if (!church) return { error: 'Church not found.' };

    // Now run event and attendance queries in parallel using the resolved church ID
    const [eventResult, logsResult, membersResult] = await Promise.all([
      supabase.schema('church').from('events').select('*').eq('id', eventId).single(),
      supabase.schema('church').from('attendance_logs').select('member_id').eq('event_id', eventId).in('attendance_status', ['present', 'late']),
      supabase.schema('church').from('members').select('id, full_name, phone_number').eq('church_id', church.id).order('full_name')
    ]);

    const { data: event } = eventResult;
    const { data: logs } = logsResult;
    const { data: members } = membersResult;

    return { 
      church, 
      event, 
      members: members || [], 
      attendedMemberIds: logs?.map(l => l.member_id) || [] 
    };
  } catch (error) {
    console.error('[getEventAttendanceData] Error:', error);
    return { error: 'Failed to verify access.' };
  }
}

async function checkAuthorization(churchSlug: string, eventId: string) {
  const adminClient = await createAdminClient();
  const { data: event } = await adminClient.schema('church').from('events').select('church_id').eq('id', eventId).single();
  
  if (!event) {
    throw new Error('Event not found.');
  }
  
  // 1. Is there an usher session for this church?
  // We use ilike or normalize to lowercase to match the cookie name logic
  const usherSession = await getUsherSession(churchSlug.toLowerCase());
  if (usherSession && usherSession.church_slug === churchSlug.toLowerCase() && usherSession.church_id === event.church_id) {
    return { adminClient, allowed: true };
  }

  // 2. Is there a logged-in admin for this church?
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();

  if (user) {
      const { data: profile } = await adminClient.from('admin_profiles').select('tenant_id').eq('id', user.id).maybeSingle();
      if (profile && profile.tenant_id === event.church_id) {
         return { adminClient, allowed: true };
      }
    }

  throw new Error('Unauthorized to modify this event.');
}

export async function markAttendance(churchSlug: string, eventId: string, memberId: string, status: 'present' | 'late' | 'absent' | 'excused' = 'present') {
  try {
    console.log(`[markAttendance] Marking ${memberId} as ${status} for event ${eventId} (Slug: ${churchSlug})`);
    const { adminClient: supabase } = await checkAuthorization(churchSlug, eventId);
    
    // 1. Get the church_id from the event first
    const { data: eventData, error: eventError } = await supabase
      .schema('church')
      .from('events')
      .select('church_id')
      .eq('id', eventId)
      .single();

    if (eventError || !eventData) {
      throw new Error('Could not find event details.');
    }

    // 2. Direct upsert into attendance_logs using Admin Client (bypasses RLS)
    const { data: existingLog } = await supabase
      .schema('church')
      .from('attendance_logs')
      .select('attendance_status')
      .eq('member_id', memberId)
      .eq('event_id', eventId)
      .maybeSingle();

    const { error } = await supabase
      .schema('church')
      .from('attendance_logs')
      .upsert({
        church_id: eventData.church_id,
        member_id: memberId,
        event_id: eventId,
        attendance_status: status,
        check_in_time: new Date().toISOString()
      }, { onConflict: 'member_id,event_id' });

    if (error) {
      console.error('[markAttendance] Upsert Error:', error);
      return { error: `Database error: ${error.message}` };
    }

    // 3. Update the attendance count intelligently
    const wasPresent = existingLog?.attendance_status === 'present' || existingLog?.attendance_status === 'late';
    const isPresent = status === 'present' || status === 'late';

    if (!wasPresent && isPresent) {
      await supabase.schema('church').rpc('increment_event_attendance', { event_id: eventId });
    } else if (wasPresent && !isPresent) {
      await supabase.schema('church').rpc('decrement_event_attendance', { event_id: eventId });
    }

    revalidatePath(`/${churchSlug}/usher/dashboard`);
    revalidatePath(`/${churchSlug}/admin/attendance`);
    revalidatePath(`/${churchSlug}/admin/attendance/${eventId}`);
    return { success: true };
  } catch (error: any) {
    console.error('[markAttendance] Exception:', error);
    return { error: error.message || 'Failed to record check-in.' };
  }
}

export async function removeAttendance(churchSlug: string, eventId: string, memberId: string) {
  try {
    const { adminClient: supabase } = await checkAuthorization(churchSlug, eventId);
    
    // 1. Get event data to verify tenant scope
    const { data: eventData } = await supabase
      .schema('church')
      .from('events')
      .select('church_id')
      .eq('id', eventId)
      .single();

    if (!eventData) throw new Error('Event not found');

    // 2. Direct delete from attendance_logs using Admin Client (bypasses RLS)
    // We include church_id for extra safety in multi-tenant environment
    const { error } = await supabase
      .schema('church')
      .from('attendance_logs')
      .delete()
      .match({ 
        member_id: memberId, 
        event_id: eventId,
        church_id: eventData.church_id 
      });

    if (error) {
      console.error('[removeAttendance] Delete Error:', error);
      return { error: `Database error: ${error.message}` };
    }

    // 3. Update the attendance count using the RPC
    await supabase.schema('church').rpc('decrement_event_attendance', { event_id: eventId });

    revalidatePath(`/${churchSlug}/usher/dashboard`);
    revalidatePath(`/${churchSlug}/admin/attendance`);
    revalidatePath(`/${churchSlug}/admin/attendance/${eventId}`);
    
    return { success: true };
  } catch (error: any) {
    console.error('[removeAttendance] Exception:', error);
    return { error: error.message || 'Failed to remove check-in.' };
  }
}

export async function runInactivityDetection(churchId: string, churchSlug: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('church')
    .rpc('refresh_inactive_30_days', { p_church_id: churchId });

  if (error) return { error: error.message };
  
  revalidatePath(`/${churchSlug}/admin/attendance`);
  return { success: true, count: data };
}

export async function getAttendanceFlags(churchId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('church')
    .from('attendance_flags')
    .select(`
      *,
      members:member_id (
        full_name,
        phone_number
      )
    `)
    .eq('church_id', churchId)
    .in('status', ['open', 'followed_up'])
    .order('created_at', { ascending: false });

  if (error) return { error: error.message };
  return { data };
}

export async function updateAttendanceFlagStatus(flagId: string, status: AttendanceFlagStatus, churchSlug: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .schema('church')
    .from('attendance_flags')
    .update({ status })
    .eq('id', flagId);

  if (error) return { error: error.message };
  
  revalidatePath(`/${churchSlug}/admin/attendance`);
  return { success: true };
}

export async function sendMissedYouMessages(churchId: string, churchSlug: string, eventId?: string, customMessage?: string) {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      return { error: 'Not authenticated' };
    }

    // Sync the 3 consecutive Sundays missed flags by calling the deployed edge function
    try {
      await supabase.functions.invoke('sync_missed_3_sundays_flags', {
        method: 'POST'
      });
    } catch (e) {
      console.error('Failed to invoke edge function:', e);
    }

    const memberIdsToMessage = new Set<string>();
    
    // If no eventId provided, try to find the most recent completed event from the last 7 days
    let targetEventId = eventId;
    if (!targetEventId) {
      const { data: latestEvent } = await supabase
        .schema('church')
        .from('events')
        .select('id')
        .eq('church_id', churchId)
        .eq('status', 'completed')
        .order('event_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (latestEvent) {
        targetEventId = latestEvent.id;
      }
    }
    
    // Fetch members who were absent for the target event
    if (targetEventId) {
      const { data: absentLogs, error: absentError } = await supabase
        .schema('church')
        .from('attendance_logs')
        .select('member_id')
        .eq('event_id', targetEventId)
        .eq('attendance_status', 'absent');

      if (absentError) return { error: absentError.message };
      if (absentLogs) {
        absentLogs.forEach(log => memberIdsToMessage.add(log.member_id));
      }
    }

    // Fetch members who have an active 'missed_3_sundays' flag
    const { data: openFlags, error: flagsError } = await supabase
      .schema('church')
      .from('attendance_flags')
      .select('id, member_id')
      .eq('church_id', churchId)
      .eq('flag_type', 'missed_3_sundays')
      .eq('status', 'open');

    if (flagsError) return { error: flagsError.message };

    // Fetch members who were PRESENT for the target event to EXCLUDE them
    const presentMemberIds = new Set<string>();
    if (targetEventId) {
      const { data: presentLogs } = await supabase
        .schema('church')
        .from('attendance_logs')
        .select('member_id')
        .eq('event_id', targetEventId)
        .in('attendance_status', ['present', 'late']);
      
      if (presentLogs) {
        presentLogs.forEach(log => presentMemberIds.add(log.member_id));
      }
    }

    // Add flagged members, but ONLY if they weren't present at the current event
    const flagsByMemberId = new Map<string, string>(); // member_id -> flag_id
    if (openFlags) {
      openFlags.forEach(flag => {
        if (!presentMemberIds.has(flag.member_id)) {
          memberIdsToMessage.add(flag.member_id);
          flagsByMemberId.set(flag.member_id, flag.id);
        }
      });
    }

    if (memberIdsToMessage.size === 0) {
      return { success: true, count: 0 };
    }

    const memberIds = Array.from(memberIdsToMessage);

    // Fetch the actual members to get phone_number and full_name
    const { data: members, error: membersError } = await supabase
      .schema('church')
      .from('members')
      .select('id, full_name, phone_number')
      .in('id', memberIds);

    if (membersError) return { error: membersError.message };
    if (!members || members.length === 0) return { success: true, count: 0 };

    // Get church config and balance once
    const { data: church } = await supabase
      .schema('church')
      .from('churches')
      .select('sender_id')
      .eq('id', churchId)
      .maybeSingle();

    const { data: balance } = await supabase
      .schema('public')
      .from('wallets')
      .select('balance, sms_rate')
      .eq('tenant_id', churchId)
      .maybeSingle();

    if (!balance) return { error: 'Billing account not found' };

    const isSandbox = process.env.AT_USERNAME?.toLowerCase() === 'sandbox';
    const senderId = (!isSandbox && church?.sender_id) ? church.sender_id.trim() : '';

    let sentCount = 0;

    for (const member of members) {
      if (!member.phone_number) continue;

      // Re-fetch balance from DB each iteration to avoid stale reads from concurrent deductions
      const { data: freshBalance } = await supabase
        .schema('public')
        .from('wallets')
        .select('balance, sms_rate')
        .eq('tenant_id', churchId)
        .maybeSingle();

      if (!freshBalance || freshBalance.balance < freshBalance.sms_rate) {
        console.warn('[sendMissedYouMessages] Halted: Insufficient balance');
        break;
      }

      const firstName = member.full_name.split(' ')[0] || 'there';
      const defaultMessage = `Hello ${firstName}! we missed you  at church today. We pray you are well and hope to see you again next time. Blessings from your church family.`;
      
      const message = customMessage 
        ? customMessage.replace(/{name}/gi, member.full_name).replace(/{first_name}/gi, firstName)
        : defaultMessage;
      
      try {
        const result = await sendSingleSMS({
          supabase,
          phoneNumber: member.phone_number,
          message,
          churchId,
          idempotencyKey: `missed_${churchId.slice(0, 8)}_${member.id}_${Date.now()}`,
          senderId,
          balance: freshBalance
        });

        if (result.success) {
          sentCount++;
          // Close the flag if they had one
          const flagId = flagsByMemberId.get(member.id);
          if (flagId) {
            await supabase
              .schema('church')
              .from('attendance_flags')
              .update({ status: 'followed_up' })
              .eq('id', flagId);
          }
        }
      } catch (err) {
        console.error(`Failed to send SMS to ${member.phone_number}:`, err);
      }
      
      // Small delay to avoid hitting AT rate limits
      await new Promise(r => setTimeout(r, 100));
    }

    return { success: true, count: sentCount };
  } catch (error) {
    console.error('sendMissedYouMessages Error:', error);
    return { error: 'Failed to send messages.' };
  }
}
