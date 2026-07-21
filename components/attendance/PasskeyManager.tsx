'use client';

import { useState } from 'react';
import { Key, Save, Loader2, CheckCircle2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export function PasskeyManager({ 
  churchId, 
  initialPasskey,
  churchSlug 
}: { 
  churchId: string; 
  initialPasskey: string;
  churchSlug: string;
}) {
  const [passkey, setPasskey] = useState(initialPasskey);
  const [isSaving, setIsSaving] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const generatePasskey = () => {
    // Generate a 6-character random uppercase alphanumeric string
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars like 0, O, I, 1
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleUpdate = async (newPasskey: string) => {
    if (newPasskey.length < 4) {
      toast.error('Passkey must be at least 4 characters');
      return;
    }

    setIsSaving(true);
    setIsSuccess(false);

    try {
      const { updateChurchPasskey } = await import('@/lib/attendance-actions');
      const result = await updateChurchPasskey(churchId, newPasskey, churchSlug);

      if (result.success) {
        setPasskey(newPasskey);
        setIsSuccess(true);
        toast.success('Passkey updated successfully!');
        setTimeout(() => setIsSuccess(false), 3000);
      } else {
        toast.error(result.error || 'Failed to update passkey');
      }
    } catch (err) {
      toast.error('An unexpected error occurred');
    } finally {
      setIsSaving(false);
    }
  };

  const onAutoGen = () => {
    const newKey = generatePasskey();
    handleUpdate(newKey);
  };

  return (
    <div className="bg-[#FAF7F0] border border-[#E9E1D2] rounded-2xl p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#FDE9D9] rounded-xl text-[#B5622A]">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-black text-[#1E1208] tracking-tight">Usher Passkey</h3>
            <p className="text-[12px] text-[#9A7E65]">The current code for ushers to access the portal</p>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-white border border-[#E9E1D2] rounded-xl px-4 py-2.5 shadow-sm">
          <span className="text-lg font-black text-[#B5622A] tracking-[0.3em] font-mono">{passkey}</span>
          <div className="w-px h-6 bg-[#E9E1D2] mx-1" />
          <button
            onClick={onAutoGen}
            disabled={isSaving}
            type="button"
            className="flex items-center gap-2 text-[#2B1A0E] hover:text-[#B5622A] transition-colors disabled:opacity-50"
            title="Generate new passkey"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="text-[11px] font-bold uppercase tracking-widest">Regenerate</span>
          </button>
        </div>
      </div>
    </div>
  );
}
