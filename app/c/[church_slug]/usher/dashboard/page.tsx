import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getUsherSession } from '@/lib/attendance-actions';
import { createAdminClient } from '@/lib/supabase/server';
import { UsherDashboardClient } from '@/components/attendance/UsherDashboardClient';
import { LogOut, Activity } from 'lucide-react';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Usher Dashboard | pastorOs',
  description: 'Fast check-in portal for church ushers'
};

export default async function UsherDashboard({ params }: { params: Promise<{ church_slug: string }> }) {
  const { church_slug } = await params;
  const session = await getUsherSession(church_slug);

  if (!session) {
    redirect(`/${church_slug}/usher`);
  }

  // Use Admin Client to bypass RLS since ushers are authenticated via custom passkey session
  const supabase = await createAdminClient();

  // 1. Get today's active event or create it
  const { data: activeEvents } = await supabase
    .schema('church')
    .from('events')
    .select('*')
    .eq('church_id', session.church_id)
    .eq('status', 'active')
    .order('event_date', { ascending: false })
    .limit(1);

  const activeEvent = activeEvents?.[0];

  // 2. Fetch members for this church
  const { data: members } = await supabase
    .schema('church')
    .from('members')
    .select('*')
    .eq('church_id', session.church_id)
    .order('full_name', { ascending: true });

  // 3. Fetch attendance logs for the active event
  let attendanceLogs: any[] = [];
  if (activeEvent) {
    const { data: logs } = await supabase
      .schema('church')
      .from('attendance_logs')
      .select('member_id, attendance_status')
      .eq('event_id', activeEvent.id)
      .in('attendance_status', ['present', 'late']);
    attendanceLogs = logs || [];
  }

  return (
    <div className="min-h-screen bg-[#FAF7F0] pb-20">
      {/* Header */}
      <header className="bg-white border-b border-[#E9E1D2] px-6 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#B5622A] rounded-2xl flex items-center justify-center text-white shadow-md">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-black text-[#1E1208] leading-tight uppercase tracking-tight">Usher Portal</h1>
              <p className="text-[10px] text-[#9A7E65] font-bold uppercase tracking-widest">{session.church_name}</p>
            </div>
          </div>
          
          <Link 
            href={`/${church_slug}/usher`} 
            className="p-2 text-[#9A7E65] hover:text-red-500 transition-colors"
          >
            <LogOut className="w-5 h-5" />
          </Link>
        </div>
      </header>

      <main className="max-w-md mx-auto p-6 space-y-6">
        {!activeEvent ? (
          <div className="bg-white border border-[#E9E1D2] rounded-3xl p-10 text-center space-y-4">
            <div className="w-16 h-16 bg-[#FAF7F0] rounded-full flex items-center justify-center mx-auto text-[#9A7E65] opacity-40">
              <Activity className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-bold text-[#1E1208]">No Active Service</h2>
              <p className="text-sm text-[#9A7E65]">There is no active session right now. Please ask the administrator to start a check-in session from the main dashboard.</p>
            </div>
          </div>
        ) : (
          <UsherDashboardClient 
            churchSlug={church_slug}
            event={activeEvent}
            members={members || []}
            initialLogs={attendanceLogs}
          />
        )}
      </main>
    </div>
  );
}
