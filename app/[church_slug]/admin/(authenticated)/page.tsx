import { getChurchBySlug } from '@/lib/db';
import { createAdminClient } from '@/lib/supabase/server';
import { AdminCharts } from '@/components/AdminCharts';
import DashboardGreeting from '@/components/DashboardGreeting';

export default async function AdminDashboard({
  params,
}: {
  params: Promise<{ church_slug: string }>;
}) {
  const resolvedParams = await params;
  const church = await getChurchBySlug(resolvedParams.church_slug) || {
    id: 'unknown',
    name: resolvedParams.church_slug,
    slug: resolvedParams.church_slug,
    themeColor: 'bg-slate-90',
    logoUrl: `https://picsum.photos/seed/${resolvedParams.church_slug}/200/200`
  };

  const supabase = await createAdminClient();

  // Optimized Parallel Data Fetching
  const [userResult, memberCountResult, recentMembersResult, eventsResult, prayersResult, demographicsResult, convertsResult, donationsResult, lastMonthMembersResult, recentAttendanceResult, memberGrowthResult, allLogsResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase.schema('church').from('members').select('id', { count: 'exact', head: true }).eq('church_id', church.id),
    supabase.schema('church').from('members').select('full_name, created_at').eq('church_id', church.id).order('created_at', { ascending: false }).limit(5),
    supabase.schema('church').from('events').select('*').eq('church_id', church.id).order('event_date', { ascending: false }).limit(10),
    supabase.schema('church').from('prayers').select('*').eq('church_id', church.id).order('created_at', { ascending: false }).limit(5),
    supabase.schema('church').from('members').select('gender, is_youth').eq('church_id', church.id),
    supabase.schema('church').from('new_converts').select('created_at').eq('church_id', church.id).gte('created_at', new Date(new Date().setMonth(new Date().getMonth() - 5)).toISOString()),
    supabase.schema('church').from('donations').select('amount_cents, created_at').eq('church_id', church.id).gte('created_at', new Date(new Date().setMonth(new Date().getMonth() - 5)).toISOString()),
    supabase.schema('church').from('members').select('id', { count: 'exact', head: true }).eq('church_id', church.id).gte('created_at', new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString()),
    supabase.schema('church').from('attendance_logs').select('member_id', { count: 'exact', head: true }).eq('church_id', church.id).in('attendance_status', ['present', 'late']).gte('check_in_time', new Date(new Date().setDate(new Date().getDate() - 30)).toISOString()),
    supabase.schema('church').from('members').select('created_at').eq('church_id', church.id).gte('created_at', new Date(new Date().setMonth(new Date().getMonth() - 5)).toISOString()),
    supabase.schema('church').from('attendance_logs').select('event_id, attendance_status').eq('church_id', church.id).in('attendance_status', ['present', 'late'])
  ]);

  const { data: { user } } = userResult;
  const pastorName = user?.user_metadata?.full_name || 
                     user?.user_metadata?.name || 
                     user?.email?.split('@')[0].split('.').map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ') || 
                     'Pastor';

  const { count: memberCount } = memberCountResult;
  const { data: recentMembers } = recentMembersResult;
  const { data: dbEvents } = eventsResult;
  const { data: dbPrayers } = prayersResult;
  const { data: membersDemographics } = demographicsResult;
  const { data: recentConverts } = convertsResult;
  const { data: recentDonations } = donationsResult;
  const { count: lastMonthMemberCount } = lastMonthMembersResult;
  const { count: activeAttendeeCount } = recentAttendanceResult;
  const { data: memberGrowthData } = memberGrowthResult;
  const { data: allAttendanceLogs } = allLogsResult;

  const realMemberCount = memberCount || 0;
  const mappedMembers = recentMembers?.map(m => ({
    name: m.full_name,
    since: new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    role: 'Member'
  })) || [];

  const events = dbEvents || [];
  const mappedEvents = events.map(e => ({
    title: e.name,
    day: new Date(e.event_date).toLocaleDateString('en-US', { weekday: 'short' }),
    start_time: e.start_time?.slice(0, 5) || 'TBD',
    attending_count: e.attending_count || 0
  }));

  const prayers = dbPrayers?.map(p => {
    const diffHours = Math.floor((new Date().getTime() - new Date(p.created_at).getTime()) / (1000 * 60 * 60));
    const ago = diffHours < 24 ? `${diffHours}h ago` : diffHours < 48 ? 'Yesterday' : `${Math.floor(diffHours/24)}d ago`;
    return { name: p.submitter_name, text: p.body, ago, status: p.status };
  }) || [];

  let maleCount = 0;
  let femaleCount = 0;
  let youthCount = 0;
  let adultCount = 0;

  if (membersDemographics) {
    membersDemographics.forEach(m => {
      if (m.gender === 'male') maleCount++;
      if (m.gender === 'female') femaleCount++;
      if (m.is_youth) youthCount++;
      else adultCount++;
    });
  }
  const genderData = [
    { name: 'Men', value: maleCount, color: '#2B1A0E' },
    { name: 'Women', value: femaleCount, color: '#B5622A' }
  ];
  const youthData = [
    { name: 'Youth', value: youthCount, color: '#B5622A' },
    { name: 'Adults', value: adultCount, color: '#2B1A0E' }
  ];

  // Aggregate converts by month (last 6 months)
  const convertsByMonth: Record<string, number> = {};
  const donationsByMonth: Record<string, number> = {};
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1); // Set to 1st of month to avoid overflow issues (e.g. March 31 -> Feb 28/29)
    d.setMonth(d.getMonth() - i);
    const monthName = monthNames[d.getMonth()];
    convertsByMonth[monthName] = 0;
    donationsByMonth[monthName] = 0;
  }
  
  if (recentConverts) {
    recentConverts.forEach(c => {
      const d = new Date(c.created_at);
      const monthName = monthNames[d.getMonth()];
      if (convertsByMonth[monthName] !== undefined) {
        convertsByMonth[monthName]++;
      }
    });
  }
  const convertsData = Object.keys(convertsByMonth).map(month => ({ month, count: convertsByMonth[month] }));

  // Aggregate members by month (last 6 months)
  const membersByMonth: Record<string, number> = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const monthName = monthNames[d.getMonth()];
    membersByMonth[monthName] = 0;
  }

  if (memberGrowthData) {
    memberGrowthData.forEach((m: any) => {
      const d = new Date(m.created_at);
      const monthName = monthNames[d.getMonth()];
      if (membersByMonth[monthName] !== undefined) {
        membersByMonth[monthName]++;
      }
    });
  }
  const growthData = Object.keys(membersByMonth).map(month => ({ month, count: membersByMonth[month] }));

  if (recentDonations) {
    recentDonations.forEach(d => {
      const dateStr = new Date(d.created_at);
      const monthName = monthNames[dateStr.getMonth()];
      if (donationsByMonth[monthName] !== undefined) {
        donationsByMonth[monthName] += (d.amount_cents / 100);
      }
    });
  }
  const donationsData = Object.keys(donationsByMonth).map(month => ({ month, amount: donationsByMonth[month] }));

  // Attendance History - Calculate counts from logs for 100% accuracy
  const attendanceData = [...events].reverse().map(e => {
    const eventLogs = allAttendanceLogs?.filter((log: any) => log.event_id === e.id) || [];
    return {
      name: new Date(e.event_date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
      count: eventLogs.length
    };
  });
  
  const completedEvents = events.filter(e => e.status === 'completed' || e.status === 'active');
  const totalAttended = completedEvents.slice(0, 4).reduce((acc, curr) => {
    const eventLogs = allAttendanceLogs?.filter((log: any) => log.event_id === curr.id) || [];
    return acc + eventLogs.length;
  }, 0);
  const avgAttendance = completedEvents.length > 0 ? Math.round(totalAttended / Math.min(completedEvents.length, 4)) : 0;

  // New Analytics calculations
  const retentionRate = realMemberCount > 0 ? Math.round(((activeAttendeeCount || 0) / realMemberCount) * 100) : 0;
  const growthRate = lastMonthMemberCount || 0;
  const newConvertsCount = recentConverts?.length || 0;

  const topStats = [
    { label: "Total Members", value: realMemberCount.toLocaleString(), note: `${growthRate > 0 ? `+${growthRate}` : '0'} new this month` },
    { label: "New Converts", value: newConvertsCount.toLocaleString(), note: "Last 6 months total" },
    { label: "Avg Attendance", value: avgAttendance.toLocaleString(), note: "Based on last 4 services" },
    { label: "Retention Rate", value: `${retentionRate}%`, note: "Active in last 30 days" },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Greetings */}
      <DashboardGreeting pastorName={pastorName} />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {topStats.map((s, i) => (
          <div key={i} className="bg-[#F0E6D3] border border-[rgba(90,55,20,0.13)] rounded-2xl p-6 transition-all hover:translate-y-[-2px] hover:shadow-lg">
            <p className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest mb-3">
              {s.label}
            </p>
            <h3 style={{ fontFamily: "'Playfair Display', serif" }} className="text-2xl sm:text-3xl font-bold text-[#1E1208] leading-none mb-2">
              {s.value}
            </h3>
            <p className="text-[11px] text-[#9A7E65] font-medium">{s.note}</p>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="overflow-hidden">
        <AdminCharts genderData={genderData} youthData={youthData} convertsData={convertsData} donationsData={donationsData} attendanceData={attendanceData} growthData={growthData} />
      </div>

      {/* Events Row (Now full width since Small Groups is removed) */}
      <div>
        <div className="bg-[#F0E6D3] border border-[rgba(90,55,20,0.13)] rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-5 flex items-center justify-between">
            <h4 style={{ fontFamily: "'Playfair Display', serif" }} className="text-lg font-bold text-[#1E1208]">Upcoming Events</h4>
            <button className="text-[11px] font-bold text-[#9A7E65] hover:text-[#B5622A] transition-colors uppercase tracking-wider">View all</button>
          </div>
          <div className="border-t border-[rgba(90,55,20,0.08)] divide-y divide-[rgba(90,55,20,0.08)]">
            {mappedEvents.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <p className="text-[13px] text-[#9A7E65]">No upcoming events scheduled.</p>
              </div>
            ) : mappedEvents.map((e, index) => (
              <div key={index} className="px-6 py-4 flex items-center gap-4 hover:bg-[rgba(90,55,20,0.02)] transition-colors">
                <div className="w-11 h-11 flex flex-col items-center justify-center bg-[#F5EAD8] border border-[rgba(181,98,42,0.18)] rounded-xl shrink-0">
                  <span className="text-[9px] font-bold text-[#B5622A] uppercase tracking-widest leading-none mb-0.5">{e.day}</span>
                  <span className="text-[11px] font-bold text-[#9A7E65]">{e.start_time}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold text-[#1E1208] truncate">{e.title}</p>
                  <p className="text-[12px] text-[#9A7E65] mt-0.5">{e.start_time}</p>
                </div>
                <div className="text-right">
                   <p style={{ fontFamily: "'Playfair Display', serif" }} className="text-base font-bold text-[#1E1208]">{e.attending_count}</p>
                   <p className="text-[10px] text-[#C8B89A] font-medium leading-none">attending</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Members + Prayer Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* New Members */}
        <div className="lg:col-span-5 bg-[#F0E6D3] border border-[rgba(90,55,20,0.13)] rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-5 flex items-center justify-between">
            <h4 style={{ fontFamily: "'Playfair Display', serif" }} className="text-lg font-bold text-[#1E1208]">New Members</h4>
            <button className="text-[11px] font-bold text-[#9A7E65] hover:text-[#B5622A] transition-colors uppercase tracking-wider">View all</button>
          </div>
          <div className="border-t border-[rgba(90,55,20,0.08)] divide-y divide-[rgba(90,55,20,0.08)]">
            {mappedMembers.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <p className="text-[13px] text-[#9A7E65]">No new members this month.</p>
              </div>
            ) : mappedMembers.map((m, index) => (
              <div key={index} className="px-6 py-4 flex items-center gap-3 hover:bg-[rgba(90,55,20,0.02)] transition-colors">
                <div className="w-9 h-9 rounded-full bg-[rgba(90,55,20,0.12)] flex items-center justify-center text-[13px] font-bold text-[#7A4F30] shrink-0">
                  {m.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                   <p className="text-[14px] font-bold text-[#1E1208] truncate">{m.name}</p>
                   <p className="text-[12px] text-[#9A7E65]">Joined {m.since}</p>
                </div>
                <span className="px-2 py-0.5 bg-[rgba(90,55,20,0.08)] text-[10px] font-bold text-[#9A7E65] rounded-full uppercase tracking-wider shrink-0">Member</span>
              </div>
            ))}
          </div>
        </div>

        {/* Prayer Wall */}
        <div className="lg:col-span-7 bg-[#F0E6D3] border border-[rgba(90,55,20,0.13)] rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-5 flex items-center justify-between">
            <h4 style={{ fontFamily: "'Playfair Display', serif" }} className="text-lg font-bold text-[#1E1208]">Prayer Wall</h4>
            <button className="px-4 py-1.5 bg-[#2B1A0E] text-[#F5E6CE] text-[11px] font-bold rounded-lg hover:bg-[#3D2614] transition-colors uppercase tracking-widest">+ Add</button>
          </div>
          <div className="border-t border-[rgba(90,55,20,0.08)] divide-y divide-[rgba(90,55,20,0.08)]">
            {prayers.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <p className="text-[13px] text-[#9A7E65]">No open prayer requests.</p>
              </div>
            ) : prayers.map((p, index) => (
              <div key={index} className="px-6 py-4 flex flex-start gap-3 hover:bg-[rgba(90,55,20,0.02)] transition-colors">
                 <div className="mt-2 w-1.5 h-1.5 rounded-full bg-[rgba(90,55,20,0.2)] shrink-0" />
                 <div className="flex-1 min-w-0">
                   <div className="flex items-center justify-between">
                     <p className="text-[13px] font-bold text-[#1E1208]">{p.name}</p>
                     <span className="text-[10px] text-[#9A7E65] font-medium">{p.ago}</span>
                   </div>
                   <p className="text-[13px] text-[#9A7E65] mt-1 line-clamp-2 leading-relaxed italic">&quot;{p.text}&quot;</p>
                   <div className="flex items-center gap-4 mt-2">
                      <button className="text-[10px] font-bold text-[#B5622A] uppercase tracking-wider hover:opacity-70 transition-opacity flex items-center gap-1">
                        Praying
                      </button>
                      <button className="text-[10px] font-bold text-[#9A7E65] uppercase tracking-wider hover:opacity-70 transition-opacity">Archive</button>
                   </div>
                 </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
