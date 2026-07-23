'use client';

import { useState, useMemo, useEffect } from 'react';
import { Search, UserCheck, X, Check, Loader2, Users, RotateCcw } from 'lucide-react';
import { markAttendance, removeAttendance } from '@/lib/attendance-actions';
import { toast } from 'sonner';

interface Member {
  id: string;
  full_name: string;
  phone_number?: string;
}

export default function CheckInClient({
  churchSlug,
  eventId,
  members,
  initialAttendedIds,
  eventStatus
}: {
  churchSlug: string;
  eventId: string;
  members: Member[];
  initialAttendedIds: string[];
  eventStatus: string;
}) {
  const [search, setSearch] = useState('');
  const [attendedIds, setAttendedIds] = useState<Set<string>>(new Set(initialAttendedIds));
  const [isProcessing, setIsProcessing] = useState<string | null>(null);

  // Sync with server props when they change
  useEffect(() => {
    setAttendedIds(new Set(initialAttendedIds));
  }, [initialAttendedIds]);

  const filteredMembers = useMemo(() => {
    if (!search) return [];
    return members.filter(m => 
      m.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (m.phone_number || '').includes(search)
    ).slice(0, 10); // Top 10 for better usability
  }, [search, members]);

  // All attended members (to show list)
  const attendedList = useMemo(() => {
    return members.filter(m => attendedIds.has(m.id))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [members, attendedIds]);

  const handleCheckIn = async (memberId: string) => {
    setIsProcessing(memberId);
    try {
      const result = await markAttendance(churchSlug, eventId, memberId);
      if (result.success) {
        setAttendedIds(prev => new Set([...Array.from(prev), memberId]));
        setSearch(''); // Clear search after check-in
        toast.success('Member checked in');
      } else {
        toast.error(result.error || 'Failed to check in');
      }
    } catch (error) {
      toast.error('An unexpected error occurred');
    } finally {
      setIsProcessing(null);
    }
  };

  const handleUndo = async (memberId: string) => {
    setIsProcessing(memberId);
    try {
      const result = await removeAttendance(churchSlug, eventId, memberId);
      if (result.success) {
        setAttendedIds(prev => {
          const next = new Set(prev);
          next.delete(memberId);
          return next;
        });
        toast.success('Check-in removed');
      } else {
        toast.error(result.error || 'Failed to remove check-in');
      }
    } catch (error) {
      toast.error('An unexpected error occurred');
    } finally {
      setIsProcessing(null);
    }
  };

  const handleToggle = async (memberId: string, isCurrentlyAttended: boolean) => {
    if (isCurrentlyAttended) {
      await handleUndo(memberId);
    } else {
      await handleCheckIn(memberId);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Left Column: Search & Quick Check-in */}
      <div className="lg:col-span-1 space-y-6">
        <div className="bg-white border border-[#E9E1D2] rounded-3xl p-6 shadow-sm">
          <h3 className="text-xs font-bold text-[#1E1208] uppercase tracking-widest mb-4 flex items-center gap-2">
            <Search className="w-4 h-4 text-[#B5622A]" />
            Search Member
          </h3>
          
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9A7E65]" />
            <input 
              type="text"
              placeholder="Name or Phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-4 py-3.5 bg-[#FAF7F0] border border-[#E9E1D2] rounded-2xl text-[14px] focus:bg-white focus:border-[#B5622A] outline-none transition-all font-medium"
              autoFocus
            />
          </div>

          {search.length > 0 && (
            <div className="mt-4 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
              {filteredMembers.length === 0 ? (
                <p className="text-[12px] text-[#9A7E65] italic text-center py-4 bg-[#FAF7F0] rounded-xl border border-dashed border-[#E9E1D2]">
                  No members found mapping to &quot;{search}&quot;
                </p>
              ) : (
                filteredMembers.map(member => {
                  const isCheckedIn = attendedIds.has(member.id);
                  const processing = isProcessing === member.id;

                  return (
                    <button
                      key={member.id}
                      onClick={() => handleToggle(member.id, isCheckedIn)}
                      disabled={!!processing}
                      className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all text-left ${
                        isCheckedIn 
                        ? 'bg-[#FDE9D9] border-[#B5622A] shadow-sm' 
                        : 'bg-white border-[#E9E1D2] hover:border-[#B5622A] hover:bg-[#FAF7F0]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                         <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-black uppercase shadow-sm transition-colors ${
                           isCheckedIn ? 'bg-[#B5622A] text-white' : 'bg-[#FAF7F0] text-[#9A7E65] border border-[#E9E1D2]'
                         }`}>
                           {member.full_name.charAt(0)}
                         </div>
                         <div>
                            <p className={`text-[13px] font-bold transition-colors ${isCheckedIn ? 'text-[#1E1208]' : 'text-[#1E1208]'}`}>{member.full_name}</p>
                            <p className="text-[11px] text-[#9A7E65]">{member.phone_number || 'No Phone'}</p>
                         </div>
                      </div>
                      
                      {processing ? (
                        <Loader2 className="w-5 h-5 text-[#B5622A] animate-spin" />
                      ) : isCheckedIn ? (
                        <div className="flex items-center gap-2">
                           <span className="text-[10px] font-black uppercase text-[#B5622A] tracking-widest">Present</span>
                           <RotateCcw className="w-5 h-5 text-[#B5622A]" />
                        </div>
                      ) : (
                        <UserCheck className="w-5 h-5 text-[#9A7E65] group-hover:text-[#B5622A]" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Stats Snippet */}
        <div className="bg-[#1E1208] p-6 rounded-3xl text-white shadow-xl">
           <p className="text-[10px] font-bold opacity-40 uppercase tracking-widest mb-4">Real-time Stats</p>
           <div className="grid grid-cols-2 gap-4">
              <div>
                 <p className="text-3xl font-black">{attendedIds.size}</p>
                 <p className="text-[11px] opacity-60">Present</p>
              </div>
              <div>
                 <p className="text-3xl font-black opacity-30">{members.length - attendedIds.size}</p>
                 <p className="text-[11px] opacity-40">Unaccounted</p>
              </div>
           </div>
           
           <div className="mt-8 pt-6 border-t border-white/5 flex items-center gap-2">
              <Users className="w-4 h-4 text-[#B5622A]" />
              <p className="text-[11px] font-medium opacity-80">
                 {Math.round((attendedIds.size / (members.length || 1)) * 100)}% Member participation
              </p>
           </div>
        </div>
      </div>

      {/* Right Column: Attendance Feed */}
      <div className="lg:col-span-2">
        <div className="bg-white border border-[#E9E1D2] rounded-3xl shadow-sm overflow-hidden min-h-[500px] flex flex-col">
           <div className="p-6 border-b border-[#E9E1D2] flex justify-between items-center bg-[#FAF7F0]/50">
             <h3 className="text-xs font-bold text-[#1E1208] uppercase tracking-widest flex items-center gap-2">
               <UserCheck className="w-4 h-4 text-[#B5622A]" />
               Attendance Feed ({attendedIds.size})
             </h3>
           </div>

           <div className="flex-1 p-6">
              {attendedList.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50 grayscale">
                   <Users className="w-12 h-12 text-[#9A7E65]" />
                   <p className="text-[14px] text-[#9A7E65] max-w-[200px]">
                     No check-ins yet. Search a member to begin.
                   </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {attendedList.map(member => (
                    <div 
                      key={member.id} 
                      className="group flex items-center justify-between p-3 bg-[#FAF7F0] rounded-xl border border-[#E9E1D2] hover:border-[#B5622A]/30 transition-all shadow-sm"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-white text-[#B5622A] rounded-full flex items-center justify-center text-[11px] font-black border border-[#E9E1D2] group-hover:border-[#B5622A]/50 transition-colors shrink-0">
                           {member.full_name.charAt(0)}
                        </div>
                        <div className="text-left">
                           <p className="text-[14px] font-bold text-[#1E1208]">{member.full_name}</p>
                           <div className="flex items-center gap-2">
                             <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                             <p className="text-[10px] text-[#9A7E65] uppercase font-bold tracking-wider">Present</p>
                           </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => handleUndo(member.id)}
                          disabled={isProcessing === member.id}
                          className="p-2.5 text-[#9A7E65] hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                          title="Remove attendance"
                        >
                           {isProcessing === member.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
           </div>
        </div>
      </div>
    </div>
  );
}
