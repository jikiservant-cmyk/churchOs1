'use client';

import { useState } from 'react';
import { Wallet, AlertCircle } from 'lucide-react';
import TopUpModal from '@/components/TopUpModal';

interface SMSWalletWidgetProps {
  remainingSMS: number;
  balanceUgx: number;
  leftoverUGX: number;
  churchId: string;
}

export default function SMSWalletWidget({ 
  remainingSMS, 
  balanceUgx, 
  leftoverUGX, 
  churchId 
}: SMSWalletWidgetProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <div className="bg-[#F0E6D3] border border-[rgba(90,55,20,0.13)] rounded-2xl p-4 shadow-sm flex items-center gap-4 min-w-[280px]">
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center ${remainingSMS < 20 ? "bg-red-50 text-[#B5622A]" : "bg-[rgba(90,55,20,0.05)] text-[#B5622A]"}`}
        >
          <Wallet className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">
                SMS Balance
              </p>
              <h3 className="text-lg font-black text-[#1E1208] leading-tight">
                {remainingSMS}{" "}
                <span className="text-sm font-bold text-[#C8B89A]">
                  SMS remaining
                </span>
              </h3>
              <p className="text-[10px] font-medium text-[#9A7E65] mt-0.5">
                UGX {balanceUgx.toLocaleString()} ({leftoverUGX} leftover)
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {remainingSMS < 50 && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[#B5622A]/10 border border-[#B5622A]/20 rounded-full animate-pulse">
                  <AlertCircle className="w-3 h-3 text-[#B5622A]" />
                  <span className="text-[9px] font-black text-[#B5622A] uppercase tracking-tighter">
                    Low Balance
                  </span>
                </div>
              )}
              <button
                onClick={() => setIsModalOpen(true)}
                className="px-4 py-1.5 bg-[#2B1A0E] text-[#F5E6CE] rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-[#3D2614] transition-all shadow-sm active:scale-95"
              >
                Top Up
              </button>
            </div>
          </div>
        </div>
      </div>

      <TopUpModal 
        churchId={churchId} 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
    </>
  );
}
