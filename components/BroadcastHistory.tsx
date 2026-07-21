'use client';

import { useState } from 'react';
import { History, Smartphone, CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';

export default function BroadcastHistory({ broadcastDates }: { broadcastDates: any[] }) {
  const [openDates, setOpenDates] = useState<Record<string, boolean>>({});

  const toggleDate = (dateStr: string) => {
    setOpenDates(prev => ({
      ...prev,
      [dateStr]: !prev[dateStr]
    }));
  };

  if (broadcastDates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center flex-1">
        <div className="w-12 h-12 bg-[rgba(90,55,20,0.05)] rounded-full flex items-center justify-center mb-3">
          <Smartphone className="w-6 h-6 text-[#C8B89A]" />
        </div>
        <h3 className="text-[#1E1208] font-bold text-sm">No History</h3>
        <p className="text-[#9A7E65] text-xs mt-1 max-w-[200px]">
          You haven&apos;t sent any bulk SMS broadcasts recently.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {broadcastDates.map((group, groupIdx) => {
        const isOpen = openDates[group.dateStr];
        return (
          <div key={groupIdx} className="border border-[rgba(90,55,20,0.08)] rounded-xl overflow-hidden bg-white/50">
            <button 
              onClick={() => toggleDate(group.dateStr)}
              className="w-full flex items-center justify-between p-3 bg-[rgba(90,55,20,0.02)] hover:bg-[rgba(90,55,20,0.05)] transition-colors"
            >
              <h3 className="text-[11px] font-bold text-[#7A4F30] uppercase tracking-widest">
                {group.dateStr} <span className="ml-2 text-[#9A7E65] lowercase tracking-normal">({group.messages.length} broadcast{group.messages.length !== 1 ? 's' : ''})</span>
              </h3>
              {isOpen ? <ChevronUp className="w-4 h-4 text-[#9A7E65]" /> : <ChevronDown className="w-4 h-4 text-[#9A7E65]" />}
            </button>
            
            {isOpen && (
              <ul className="divide-y divide-[rgba(90,55,20,0.05)] bg-white">
                {group.messages.map((broadcast: any, idx: number) => (
                  <li key={idx} className="p-4">
                    <div className="flex justify-between items-start mb-1.5">
                      <span className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-wider">
                        {(() => {
                          try {
                            const d = new Date(broadcast.created_at);
                            if (isNaN(d.getTime())) return "";
                            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                          } catch (e) {
                            return "";
                          }
                        })()}
                      </span>
                      {broadcast.failedCount > 0 && broadcast.successCount === 0 ? (
                        <span className="flex items-center gap-1 text-[9px] font-bold text-[#B5622A] bg-red-50/50 px-2 py-0.5 rounded-full uppercase tracking-widest">
                          <XCircle className="w-3 h-3" /> Failed
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-700 bg-emerald-50/30 px-2 py-0.5 rounded-full uppercase tracking-widest">
                          <CheckCircle2 className="w-3 h-3" /> Delivered
                        </span>
                      )}
                    </div>
                    <p className="text-[13.5px] leading-relaxed font-medium text-[#1E1208] line-clamp-2">
                      {broadcast.message}
                    </p>
                    <p className="text-[11px] text-[#9A7E65] mt-2 font-medium">
                      Sent to {broadcast.count} member{broadcast.count !== 1 ? "s" : ""}
                      {broadcast.failedCount > 0 && (
                        <span className="text-[#B5622A]">
                          {" "}
                          ({broadcast.failedCount} failed)
                        </span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
