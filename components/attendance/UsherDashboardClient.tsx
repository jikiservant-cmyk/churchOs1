'use client';

import { useState, useMemo } from 'react';
import { ChurchEvent, AttendanceStatus } from '@/lib/attendance-types';
import { markAttendance, removeAttendance } from '@/lib/attendance-actions';
import { Search, User, Check, Trash2, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';

interface Member {
  id: string;
  full_name: string;
  phone_number: string | null;
  church_id: string;
}

interface UsherDashboardClientProps {
  churchSlug: string;
  event: ChurchEvent;
  members: Member[];
  initialLogs: { member_id: string; attendance_status: string }[];
}

export function UsherDashboardClient({ churchSlug, event, members, initialLogs }: UsherDashboardClientProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [logs, setLogs] = useState(initialLogs);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const presentCount = logs.filter(l => l.attendance_status === 'present' || l.attendance_status === 'late').length;
    return {
      total: members.length,
      present: presentCount
    };
  }, [logs, members]);

  const filteredMembers = useMemo(() => {
    if (!searchQuery) return members;
    const lowerQuery = searchQuery.toLowerCase();
    return members.filter(m => 
      m.full_name.toLowerCase().includes(lowerQuery) || 
      (m.phone_number || '').includes(lowerQuery)
    );
  }, [searchQuery, members]);

  const handleToggleAttendance = async (memberId: string) => {
    const existingLog = logs.find(l => l.member_id === memberId);
    setProcessingId(memberId);

    try {
      if (existingLog) {
        // Remove attendance
        const result = await removeAttendance(churchSlug, event.id, memberId);
        if ('error' in result) {
          toast.error(result.error);
        } else {
          setLogs(prev => prev.filter(l => l.member_id !== memberId));
          toast.success('Removed check-in');
        }
      } else {
        // Mark as present
        const result = await markAttendance(churchSlug, event.id, memberId, 'present');
        if ('error' in result) {
          toast.error(result.error);
        } else {
          setLogs(prev => [...prev, { member_id: memberId, attendance_status: 'present' }]);
          toast.success('Member checked in');
        }
      }
    } catch (error) {
      toast.error('Connection failed');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Search & Stats */}
      <div className="space-y-4">
        <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-[0.1em] text-[#9A7E65]">
           <span className="flex items-center gap-2">
             <Users className="w-3 h-3" />
             {stats.present} / {stats.total} Checked-in
           </span>
           <span className="text-[#B5622A]">
             {Math.round((stats.present / stats.total) * 100 || 0)}% Coverage
           </span>
        </div>
        
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#9A7E65] opacity-50" />
          <input
            type="text"
            placeholder="Search member name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-4 bg-white border border-[#E9E1D2] rounded-2xl text-sm focus:border-[#B5622A] outline-none transition-all shadow-sm"
          />
        </div>
      </div>

      {/* Member List */}
      <div className="space-y-3">
        {filteredMembers.map((member) => {
          const isPresent = logs.some(l => l.member_id === member.id && (l.attendance_status === 'present' || l.attendance_status === 'late'));
          const isProcessing = processingId === member.id;

          return (
            <div 
              key={member.id}
              className={`p-4 rounded-2xl border transition-all flex items-center justify-between ${
                isPresent 
                  ? 'bg-[#FDE9D9] border-[#B5622A] shadow-md' 
                  : 'bg-white border-[#E9E1D2] shadow-sm'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center border font-bold ${
                  isPresent ? 'bg-[#B5622A] text-white border-transparent' : 'bg-[#FAF7F0] text-[#9A7E65] border-[#E9E1D2]'
                }`}>
                  {member.full_name.charAt(0)}
                </div>
                <div>
                  <h3 className={`text-[14px] font-bold leading-tight ${isPresent ? 'text-[#1E1208]' : 'text-[#1E1208]'}`}>
                    {member.full_name}
                  </h3>
                  <p className="text-[10px] text-[#9A7E65] uppercase tracking-widest font-medium mt-0.5">
                    {member.phone_number || 'No Phone Registered'}
                  </p>
                </div>
              </div>

              <button
                onClick={() => handleToggleAttendance(member.id)}
                disabled={isProcessing}
                className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                  isPresent 
                    ? 'bg-white text-red-500 hover:bg-red-50' 
                    : 'bg-[#B5622A] text-white hover:bg-[#944F22]'
                } ${isProcessing ? 'opacity-50' : ''}`}
              >
                {isProcessing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : isPresent ? (
                  <Trash2 className="w-5 h-5" />
                ) : (
                  <Check className="w-6 h-6" />
                )}
              </button>
            </div>
          );
        })}

        {filteredMembers.length === 0 && (
          <div className="py-12 text-center text-[#9A7E65]">
             <p className="text-sm font-medium">No members found matching your search.</p>
          </div>
        )}
      </div>

      {/* Floating Done Button (optional for UX) */}
      <div className="fixed bottom-6 left-6 right-6 pointer-events-none">
        <div className="max-w-md mx-auto pointer-events-auto">
          <button 
             onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
             className="w-full py-4 bg-[#1E1208] text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-2xl flex items-center justify-center gap-2 border border-white/10"
          >
             Keep Syncing...
          </button>
        </div>
      </div>
    </div>
  );
}
