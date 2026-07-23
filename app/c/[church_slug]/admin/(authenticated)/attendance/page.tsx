import { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Plus, Calendar, Clock, MapPin, CheckCircle2, ChevronRight, Activity, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { createEvent, getAttendanceFlags, updateEventStatus, claimAdminAccess } from '@/lib/attendance-actions';
import { ChurchEvent } from '@/lib/attendance-types';
import { InactivityRefreshButton } from '@/components/attendance/InactivityRefreshButton';
import { AttendanceAlerts } from '@/components/attendance/AttendanceAlerts';
import { CopyPortalLink } from '@/components/attendance/CopyPortalLink';
import { GlobalSendMissedMessagesButton } from '@/components/attendance/GlobalSendMissedMessagesButton';
import { PasskeyManager } from '@/components/attendance/PasskeyManager';

export const metadata: Metadata = {
  title: 'Attendance | pastorOs',
};

import { CreateEventForm } from '@/components/attendance/CreateEventForm';

export default async function AttendancePage(props: {
  params: Promise<{ church_slug: string }>;
}) {
  const resolvedParams = await props.params;
  const { church_slug } = resolvedParams;
  const supabase = await createAdminClient();

  // Get Admin Profile to verify access
  const { data: { user } } = await supabase.auth.getUser();
  
  const { data: church } = await supabase
    .schema('church')
    .from('churches')
    .select('id, name, passkey')
    .eq('slug', church_slug)
    .single();

  if (!church) notFound();

  // Verify Admin Access explicitly just in case
  const { data: adminProfile } = await supabase
    .from('admin_profiles')
    .select('*')
    .eq('id', user?.id)
    .eq('tenant_id', church.id)
    .maybeSingle();

  const { data: events } = await supabase
    .schema('church')
    .from('events')
    .select('*')
    .eq('church_id', church.id)
    .order('event_date', { ascending: false });

  const activeEvents = events?.filter(e => e.status === 'active') || [];
  const upcomingEvents = events?.filter(e => e.status === 'upcoming') || [];
  const completedEvents = events?.filter(e => e.status === 'completed') || [];

  const { data: flags } = await getAttendanceFlags(church.id);

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 style={{ fontFamily: "'Playfair Display', serif" }} className="text-2xl md:text-3xl font-bold text-[#1E1208]">
            Attendance Tracking
          </h1>
          <p className="text-[#9A7E65] mt-1 text-[11px] md:text-[13px] font-medium tracking-wide flex items-center gap-2 uppercase">
            <Activity className="w-3.5 h-3.5" />
            Manage services and check-ins
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-3 w-full md:w-auto">
           <div className="bg-[#FAF7F0] border border-[#E9E1D2] rounded-2xl p-4 shadow-sm flex-1">
             <p className="text-[9px] font-bold text-[#9A7E65] uppercase tracking-widest mb-1">Active</p>
             <p className="text-xl font-black text-[#B5622A]">{activeEvents.length}</p>
           </div>
           <div className="bg-[#FAF7F0] border border-[#E9E1D2] rounded-2xl p-4 shadow-sm flex-1">
             <p className="text-[9px] font-bold text-[#9A7E65] uppercase tracking-widest mb-1">Total Logs</p>
             <p className="text-xl font-black text-[#1E1208]">{events?.reduce((acc, e) => acc + (e.attending_count || 0), 0) || 0}</p>
           </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <CopyPortalLink churchSlug={church_slug} passkey={church.passkey || '1234'} />
      </div>

      <PasskeyManager 
        churchId={church.id} 
        initialPasskey={church.passkey || '1234'} 
        churchSlug={church_slug} 
      />

      {/* Action Bar */}
      <CreateEventForm churchId={church.id} churchSlug={church_slug} />

      {/* Admin Status Debug */}
      {!adminProfile && user && (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl space-y-3 text-amber-800">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5" />
            <div>
              <p className="font-bold">Access Warning</p>
              <p className="text-[13px]">You are logged in as <span className="font-mono text-[11px]">{user?.email || 'authenticated user'}</span>, but you aren&apos;t registered as an admin for this church.</p>
            </div>
          </div>
          <form action={async () => {
            'use server';
            await claimAdminAccess(church.id, church_slug);
          }}>
            <button type="submit" className="text-[11px] font-bold uppercase tracking-widest bg-amber-200 hover:bg-amber-300 px-4 py-2 rounded-lg transition-colors">
              Claim Admin Access for this Church
            </button>
          </form>
        </div>
      )}

      {/* Active Services (Checking In Now) */}
      {activeEvents.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-xs font-bold text-[#B5622A] uppercase tracking-widest flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 animate-pulse" />
            Active Services (Checking In)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeEvents.map((event: ChurchEvent) => (
              <EventCard key={event.id} event={event} churchSlug={church_slug} />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming Services */}
      <section className="space-y-4">
        <h3 className="text-xs font-bold text-[#9A7E65] uppercase tracking-widest flex items-center gap-2 border-b border-[#E9E1D2] pb-2">
          <ChevronRight className="w-4 h-4" />
          Upcoming Services
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {upcomingEvents.length === 0 ? (
            <p className="text-[13px] text-[#9A7E65] italic">No upcoming services scheduled.</p>
          ) : (
            upcomingEvents.map((event: ChurchEvent) => (
              <EventCard key={event.id} event={event} churchSlug={church_slug} />
            ))
          )}
        </div>
      </section>

      {/* Pastoral Attendance Alerts */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#FDE9D9] rounded-xl text-[#B5622A]">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-[#1E1208] tracking-tight lowercase first-letter:uppercase">Pastoral Attendance Alerts</h3>
              <p className="text-[12px] text-[#9A7E65]">Members identified as at-risk or inactive</p>
            </div>
          </div>
          <div className="flex gap-2">
            <GlobalSendMissedMessagesButton churchId={church.id} churchSlug={church_slug} />
            <InactivityRefreshButton churchId={church.id} churchSlug={church_slug} />
          </div>
        </div>

        <AttendanceAlerts flags={flags || []} churchSlug={church_slug} />
      </section>

      {/* Recent History */}
      <section className="space-y-4">
        <h3 className="text-xs font-bold text-[#9A7E65] uppercase tracking-widest flex items-center gap-2 border-b border-[#E9E1D2] pb-2">
          <CheckCircle2 className="w-4 h-4" />
          Recent Services (Completed)
        </h3>
        
        {/* Responsive Table/Cards */}
        <div className="bg-[#FAF7F0] border border-[#E9E1D2] rounded-2xl overflow-hidden shadow-sm">
          {/* Desktop View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-[#E9E1D2]/30">
                <tr>
                  <th className="px-6 py-3 text-left text-[10px] font-bold text-[#9A7E65] uppercase tracking-widest">Service</th>
                  <th className="px-6 py-3 text-left text-[10px] font-bold text-[#9A7E65] uppercase tracking-widest">Type</th>
                  <th className="px-6 py-3 text-left text-[10px] font-bold text-[#9A7E65] uppercase tracking-widest">Date</th>
                  <th className="px-6 py-3 text-center text-[10px] font-bold text-[#9A7E65] uppercase tracking-widest">Attendance</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E9E1D2]">
                {completedEvents.map((event: ChurchEvent) => (
                  <tr key={event.id} className="hover:bg-[#E9E1D2]/10 transition-colors">
                    <td className="px-6 py-4 font-bold text-[#1E1208]">{event.name}</td>
                    <td className="px-6 py-4 text-[#9A7E65]">{event.service_type.replace('_', ' ')}</td>
                    <td className="px-6 py-4 text-[#9A7E65]">{event.event_date}</td>
                    <td className="px-6 py-4 text-center">
                      <span className="bg-white px-2.5 py-1 rounded-full border border-[#E9E1D2] font-bold">
                        {event.attending_count}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                       <Link 
                        href={`/${church_slug}/admin/attendance/${event.id}`}
                        className="text-[#B5622A] hover:underline font-bold text-[11px] uppercase tracking-widest"
                       >
                        View Report
                       </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile View */}
          <div className="md:hidden divide-y divide-[#E9E1D2]">
            {completedEvents.map((event: ChurchEvent) => (
              <div key={event.id} className="p-5 space-y-3 bg-white hover:bg-[#FAF7F0] transition-colors">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-[#1E1208]">{event.name}</h4>
                    <p className="text-[10px] text-[#9A7E65] font-bold uppercase tracking-wider mt-0.5">
                      {event.service_type.replace('_', ' ')}
                    </p>
                  </div>
                  <span className="bg-[#FAF7F0] px-2.5 py-1 rounded-full border border-[#E9E1D2] text-xs font-black text-[#B5622A]">
                    {event.attending_count}
                  </span>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[#9A7E65] text-[11px] font-medium">
                    <Calendar className="w-3 h-3" />
                    {event.event_date}
                  </div>
                  <Link 
                    href={`/${church_slug}/admin/attendance/${event.id}`}
                    className="flex items-center gap-1 text-[#B5622A] font-black text-[10px] uppercase tracking-widest"
                  >
                    Details <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function EventCard({ event, churchSlug }: { event: ChurchEvent; churchSlug: string }) {
  const isUpcoming = event.status === 'upcoming';
  const isActive = event.status === 'active';

  return (
    <div className={`p-5 rounded-2xl border bg-white shadow-md transition-all group ${
      isActive ? 'border-[#B5622A] ring-1 ring-[#B5622A]/20' : 'border-[#E9E1D2]'
    }`}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
            isActive ? 'bg-[#B5622A] text-white' : 'bg-[#F0E6D3] text-[#9A7E65]'
          }`}>
            {event.service_type.replace('_', ' ')}
          </span>
          <h4 className="text-lg font-bold text-[#1E1208] mt-2 leading-tight">{event.name}</h4>
        </div>
        {isActive && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-green-50 text-green-700 rounded-full border border-green-200">
             <div className="w-1.5 h-1.5 bg-green-600 rounded-full animate-pulse" />
             <span className="text-[10px] font-bold uppercase tracking-wider">Live</span>
          </div>
        )}
      </div>

      <div className="space-y-2 mb-6">
        <div className="flex items-center gap-2 text-[#9A7E65] text-[12px]">
          <Calendar className="w-3.5 h-3.5" />
          {event.event_date}
        </div>
        <div className="flex items-center gap-2 text-[#9A7E65] text-[12px]">
          <Clock className="w-3.5 h-3.5" />
          {event.start_time}
        </div>
        {event.location && (
          <div className="flex items-center gap-2 text-[#9A7E65] text-[12px]">
            <MapPin className="w-3.5 h-3.5" />
            {event.location}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Link 
          href={`/${churchSlug}/admin/attendance/${event.id}`}
          className={`w-full py-2.5 rounded-xl font-bold text-[12px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-sm ${
            isActive 
              ? 'bg-[#B5622A] text-white hover:bg-[#944F22]' 
              : 'bg-[#F0E6D3] text-[#1E1208] hover:bg-[#E9E1D2]'
          }`}
        >
          {isActive ? 'Mark Attendance' : 'View Details'}
          <ChevronRight className="w-4 h-4" />
        </Link>
        
        {isUpcoming && (
          <form action={async () => {
            'use server';
            await updateEventStatus(event.id, 'active', churchSlug);
          }}>
            <button type="submit" className="w-full py-2 bg-green-600 text-white rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-green-700 transition-colors shadow-sm">
              Start Service (Live Now)
            </button>
          </form>
        )}

        {isActive && (
          <form action={async () => {
            'use server';
            await updateEventStatus(event.id, 'completed', churchSlug);
          }}>
            <button type="submit" className="w-full py-2 bg-[#1E1208] text-white rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-black transition-colors shadow-sm">
              Finish Service
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
