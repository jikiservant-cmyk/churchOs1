import { Loader2 } from 'lucide-react';

export default function Loading() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-screen bg-[#E4D5BC]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-10 h-10 text-[#B5622A] animate-spin" />
        <p className="text-[13px] font-bold text-[#7A4F30] uppercase tracking-widest animate-pulse">
          Loading Portal...
        </p>
      </div>
    </div>
  );
}
