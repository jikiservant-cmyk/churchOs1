'use client';

import { AttendanceFlag } from '@/lib/attendance-types';
import { AlertCircle, User, Phone, Calendar, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { updateAttendanceFlagStatus } from '@/lib/attendance-actions';
import { toast } from 'sonner';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface AttendanceAlertsProps {
  flags: AttendanceFlag[];
  churchSlug: string;
}

export function AttendanceAlerts({ flags, churchSlug }: AttendanceAlertsProps) {
  const router = useRouter();
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleUpdateStatus = async (flagId: string, status: 'followed_up' | 'resolved') => {
    setProcessingId(flagId);
    try {
      const result = await updateAttendanceFlagStatus(flagId, status, churchSlug);
      if ('error' in result) {
        toast.error('Failed to update status: ' + result.error);
      } else {
        toast.success(`Flag marked as ${status === 'followed_up' ? 'followed up' : 'resolved'}`);
        router.refresh(); // Ensure the UI updates
      }
    } catch (error) {
      toast.error('An unexpected error occurred');
    } finally {
      setProcessingId(null);
    }
  };

  const activeFlags = flags
    .filter(f => f.status === 'open')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (activeFlags.length === 0) {
    return (
      <div className="bg-white border border-[#E9E1D2] rounded-3xl p-8 text-center">
        <div className="w-12 h-12 bg-[#FAF7F0] rounded-full flex items-center justify-center mx-auto text-[#9A7E65] mb-4">
          <AlertCircle className="w-6 h-6 opacity-40" />
        </div>
        <p className="text-[13px] text-[#9A7E65]">No urgent attendance alerts at this time.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
      {activeFlags.map((flag) => (
        <div
          key={flag.id}
          className="bg-white border border-[#E9E1D2] rounded-2xl p-5 shadow-sm hover:shadow-md transition-all border-l-4 border-l-[#B5622A]"
        >
          <div className="flex justify-between items-start mb-3">
            <div className="flex flex-col gap-1">
              <span className="px-2 py-0.5 bg-[#FFF4E5] text-[#B5622A] text-[9px] font-bold uppercase tracking-widest rounded-full w-fit">
                {flag.flag_type === 'inactive_30_days' ? 'Inactive (30 Days)' : 'Missed 3 Sundays'}
              </span>
            </div>
            <span className="text-[10px] text-[#9A7E65] font-medium flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {format(new Date(flag.created_at), 'MMM d, yyyy')}
            </span>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#FAF7F0] rounded-full flex items-center justify-center text-[#B5622A] border border-[#E9E1D2]">
                <User className="w-5 h-5" />
              </div>
              <div>
                <h5 className="text-[14px] font-bold text-[#1E1208] leading-tight">
                  {flag.members?.full_name || 'Unknown Member'}
                </h5>
                <div className="flex items-center gap-1 text-[11px] text-[#9A7E65]">
                  <Phone className="w-3 h-3" />
                  {flag.members?.phone_number || 'No Phone'}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-[#F5F1E8] flex gap-2">
              <button 
                onClick={() => handleUpdateStatus(flag.id, 'followed_up')}
                disabled={processingId === flag.id}
                className="flex-1 px-3 py-2 bg-[#B5622A] text-white rounded-xl text-[11px] font-bold uppercase tracking-wider hover:bg-[#944F22] transition-all flex items-center justify-center gap-2"
              >
                {processingId === flag.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Mark Followed'}
              </button>
              <button 
                onClick={() => handleUpdateStatus(flag.id, 'resolved')}
                disabled={processingId === flag.id}
                className="px-3 py-2 bg-white border border-[#E9E1D2] text-[#9A7E65] rounded-xl text-[11px] font-bold uppercase tracking-wider hover:bg-[#FAF7F0] transition-all flex items-center justify-center gap-2"
              >
                {processingId === flag.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Resolved'}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
