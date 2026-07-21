'use client';

import { useState } from 'react';
import { runInactivityDetection } from '@/lib/attendance-actions';
import { RefreshCcw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface InactivityRefreshButtonProps {
  churchId: string;
  churchSlug: string;
}

export function InactivityRefreshButton({ churchId, churchSlug }: InactivityRefreshButtonProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const result = await runInactivityDetection(churchId, churchSlug);
      if ('error' in result) {
        toast.error('Failed to run inactivity detection: ' + result.error);
      } else {
        toast.success(`Inactivity detection complete. Created ${result.count} new flags.`);
      }
    } catch (error) {
      toast.error('An unexpected error occurred');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <button
      onClick={handleRefresh}
      disabled={isRefreshing}
      className="flex items-center gap-2 px-3 py-1.5 bg-[#F0E6D3] text-[#B5622A] rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-[#E9E1D2] transition-all disabled:opacity-50"
    >
      {isRefreshing ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <RefreshCcw className="w-3 h-3" />
      )}
      Scan Inactivity
    </button>
  );
}
