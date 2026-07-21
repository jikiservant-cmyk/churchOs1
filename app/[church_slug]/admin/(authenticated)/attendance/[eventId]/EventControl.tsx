'use client';

import { useState } from 'react';
import { updateEventStatus } from '@/lib/attendance-actions';
import { Play, Archive, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export function EventControl({ 
  eventId, 
  status, 
  churchSlug 
}: { 
  eventId: string; 
  status: string; 
  churchSlug: string;
}) {
  const [isUpdating, setIsUpdating] = useState(false);

  const handleUpdateStatus = async () => {
    setIsUpdating(true);
    const nextStatus = status === 'upcoming' ? 'active' : 'completed';
    try {
      const result = await updateEventStatus(eventId, nextStatus as any, churchSlug);
      if (result.success) {
        toast.success(`Service status updated to ${nextStatus}`);
      } else {
        toast.error(result.error || 'Failed to update status');
      }
    } catch (err) {
      toast.error('An unexpected error occurred');
    } finally {
      setIsUpdating(false);
    }
  };

  if (status === 'completed') {
    return (
      <div className="flex items-center gap-2 bg-[#FAF7F0] text-[#9A7E65] px-6 py-3 rounded-2xl font-bold text-[13px] uppercase tracking-widest border border-[#E9E1D2]">
        <CheckCircle2 className="w-4 h-4 text-green-600" />
        Completed
      </div>
    );
  }

  return (
    <button 
      onClick={handleUpdateStatus}
      disabled={isUpdating}
      className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-[13px] uppercase tracking-widest transition-all shadow-md disabled:opacity-50 ${
        status === 'upcoming' 
          ? 'bg-[#B5622A] text-white hover:bg-[#944F22]' 
          : 'bg-[#1E1208] text-white hover:bg-black'
      }`}
    >
      {isUpdating ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : status === 'upcoming' ? (
        <Play className="w-4 h-4 fill-current" />
      ) : (
        <Archive className="w-4 h-4" />
      )}
      {status === 'upcoming' ? 'Start Check-in' : 'Close & Finalize'}
    </button>
  );
}
