import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import { 
  ArrowLeft, 
  Search, 
  UserCheck, 
  Clock, 
  MapPin, 
  Play, 
  Archive, 
  Users,
  CheckCircle2,
  X
} from 'lucide-react';
import Link from 'next/link';
import { updateEventStatus } from '@/lib/attendance-actions';
import { ChurchEvent } from '@/lib/attendance-types';
import CheckInClient from './CheckInClient';
import { SendMissedMessagesButton } from './SendMissedMessagesButton';
import { EventControl } from './EventControl';

export default async function EventAttendancePage(props: {
  params: Promise<{ church_slug: string; eventId: string }>;
}) {
  const resolvedParams = await props.params;
  const { church_slug, eventId } = resolvedParams;
  const supabase = await createClient();

  // Optimized parallel fetching
  const [eventResult, churchResult, logsResult] = await Promise.all([
    supabase.schema('church').from('events').select('*').eq('id', eventId).single(),
    supabase.schema('church').from('churches').select('id').eq('slug', church_slug).single(),
    supabase.schema('church').from('attendance_logs').select('member_id, attendance_status, check_in_time').eq('event_id', eventId)
  ]);

  const { data: event } = eventResult;
  const { data: church } = churchResult;
  const { data: logs } = logsResult;

  if (!event) notFound();
  if (!church) notFound();

  // Fetch members only after we have church ID
  const { data: members } = await supabase
    .schema('church')
    .from('members')
    .select('*')
    .eq('church_id', church.id)
    .order('full_name');

  const attendedLogs = logs?.filter(l => l.attendance_status === 'present' || l.attendance_status === 'late') || [];
  const attendedMemberIdsArray = attendedLogs.map(l => l.member_id);

  return (
    <div className="max-w-5xl mx-auto pb-12">
      {/* Top Navigation */}
      <Link 
        href={`/${church_slug}/admin/attendance`}
        className="inline-flex items-center gap-2 text-[#9A7E65] hover:text-[#B5622A] text-[13px] font-bold mb-6 transition-colors group"
      >
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
        Back to Attendance Dashboard
      </Link>

      {/* Event Header Card */}
      <div className="bg-[#FAF7F0] border border-[#E9E1D2] rounded-3xl p-8 mb-8 shadow-sm">
        <div className="flex flex-col md:flex-row justify-between gap-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 bg-[#B5622A] text-white text-[10px] font-bold uppercase tracking-widest rounded-full shadow-sm">
                {event.service_type.replace('_', ' ')}
              </span>
              {event.status === 'active' && (
                <span className="flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-[10px] font-bold uppercase tracking-widest rounded-full border border-green-200">
                  <div className="w-1.5 h-1.5 bg-green-600 rounded-full animate-pulse" />
                  Live Check-in
                </span>
              )}
            </div>
            
            <h1 style={{ fontFamily: "'Playfair Display', serif" }} className="text-4xl font-bold text-[#1E1208]">
              {event.name}
            </h1>

            <div className="flex flex-wrap gap-6 text-[#9A7E65] text-[13px] font-medium">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 opacity-70" />
                {event.event_date} @ {event.start_time}
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 opacity-70" />
                {event.location || 'Main Sanctuary'}
              </div>
              <div className="flex items-center gap-2 text-[#1E1208] font-bold">
                <Users className="w-4 h-4 text-[#B5622A]" />
                {event.attending_count} Members Present
              </div>
            </div>
          </div>

          <div className="flex items-start">
            <EventControl eventId={eventId} status={event.status} churchSlug={church_slug} />
          </div>
        </div>
      </div>

      {/* Main Check-In Interface */}
      {event.status === 'active' ? (
        <CheckInClient 
          churchSlug={church_slug}
          eventId={eventId} 
          members={members || []} 
          initialAttendedIds={attendedMemberIdsArray}
          eventStatus={event.status}
        />
      ) : event.status === 'completed' ? (
        <div className="bg-white border border-[#E9E1D2] rounded-3xl p-8 text-center space-y-4">
           <div className="w-16 h-16 bg-[#FAF7F0] rounded-full flex items-center justify-center mx-auto text-green-600 border border-green-100 shadow-inner">
             <CheckCircle2 className="w-8 h-8" />
           </div>
           <h3 className="text-xl font-bold text-[#1E1208]">Service Finalized</h3>
           <p className="text-[#9A7E65] text-[14px] max-w-sm mx-auto">
             Attendance check-in for this service is closed. You can view the final attendance list below.
           </p>

           <SendMissedMessagesButton eventId={eventId} churchId={church.id} churchSlug={church_slug} />
           
           <div className="mt-8 border-t border-[#E9E1D2] pt-8 overflow-hidden">
             <h4 className="text-[10px] font-bold text-[#9A7E65] uppercase tracking-widest mb-6">Final Attendance List</h4>
             
             {attendedLogs.length === 0 ? (
                <div className="py-12 text-center bg-[#FAF7F0] rounded-2xl border border-dashed border-[#E9E1D2]">
                  <Users className="w-8 h-8 text-[#9A7E65] mx-auto mb-3 opacity-30" />
                  <p className="text-[13px] text-[#9A7E65] font-medium">No members were marked as present for this service.</p>
                </div>
             ) : (
                <div className="grid grid-cols-1 gap-2">
                  {attendedLogs.map(log => {
                    const member = members?.find(m => m.id === log.member_id);
                    return (
                      <div key={log.member_id} className="flex items-center justify-between p-3 bg-[#FAF7F0] rounded-xl border border-[#E9E1D2]">
                         <div className="flex items-center gap-4">
                           <div className="w-10 h-10 bg-[#B5622A] text-white rounded-full flex items-center justify-center text-[11px] font-black uppercase shadow-sm">
                             {member?.full_name?.charAt(0)}
                           </div>
                           <div className="text-left">
                             <p className="text-[14px] font-bold text-[#1E1208]">{member?.full_name}</p>
                             <p className="text-[10px] text-[#9A7E65] font-medium">Recorded at {new Date(log.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                           </div>
                         </div>
                         <div className="flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 text-[10px] font-bold uppercase tracking-widest rounded-lg border border-green-100">
                           Present
                         </div>
                      </div>
                    );
                  })}
                </div>
             )}
           </div>
        </div>
      ) : (
        <div className="bg-white border border-[#E9E1D2] rounded-3xl p-12 text-center space-y-4 shadow-sm">
           <div className="w-16 h-16 bg-[#FAF7F0] rounded-full flex items-center justify-center mx-auto text-[#B5622A] opacity-50">
             <Play className="w-8 h-8 fill-current translate-x-0.5" />
           </div>
           <h3 className="text-xl font-bold text-[#1E1208]">Service hasn&apos;t started yet</h3>
           <p className="text-[#9A7E65] text-[14px]">
             Click the &quot;Start Check-in&quot; button above to begin taking attendance.
           </p>
        </div>
      )}
    </div>
  );
}
