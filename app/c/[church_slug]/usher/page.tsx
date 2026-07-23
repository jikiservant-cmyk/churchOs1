'use client';

import { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { validateUsherPasskey } from '@/lib/attendance-actions';
import { KeyRound, ShieldCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function UsherEntryPage({ params }: { params: Promise<{ church_slug: string }> }) {
  const { church_slug } = use(params);
  const [passkey, setPasskey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passkey || passkey.length < 4) return;

    setIsLoading(true);
    try {
      console.log('Attempting login for:', church_slug);
      const result = await validateUsherPasskey(church_slug, passkey);
      console.log('Login result:', result);
      
      if (result.success) {
        toast.success('Access granted');
        setTimeout(() => {
          router.push(`/${church_slug}/usher/dashboard`);
        }, 300);
      } else {
        toast.error(result.error || 'Invalid passkey');
      }
    } catch (error) {
      console.error('Portal Login Error:', error);
      toast.error('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF7F0] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-white rounded-3xl flex items-center justify-center mx-auto shadow-sm border border-[#E9E1D2]">
            <ShieldCheck className="w-8 h-8 text-[#B5622A]" />
          </div>
          <h1 className="text-2xl font-black text-[#1E1208] tracking-tight">Usher Portal</h1>
          <p className="text-[#9A7E65] text-sm italic">Enter your church passkey to start check-in</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white p-8 rounded-3xl shadow-xl border border-[#E9E1D2] space-y-6">
          <div className="space-y-4">
            <div className="relative">
              <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#9A7E65] opacity-50" />
              <input
                type="text"
                maxLength={6}
                value={passkey}
                onChange={(e) => setPasskey(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())}
                placeholder="XXXXXX"
                className="w-full pl-12 pr-4 py-4 bg-[#FAF7F0] border-2 border-transparent rounded-2xl text-2xl font-black text-center tracking-[0.5em] focus:border-[#B5622A] focus:bg-white outline-none transition-all placeholder:text-[#E9E1D2] placeholder:tracking-normal uppercase"
                autoFocus
              />
            </div>
            
            <button
              type="submit"
              disabled={isLoading || passkey.length < 4}
              className="w-full bg-[#B5622A] text-white py-4 rounded-2xl font-black text-[14px] uppercase tracking-widest shadow-lg shadow-[#B5622A]/20 hover:bg-[#944F22] transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-3"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                'Unlock Portal'
              )}
            </button>
          </div>
          
          <p className="text-center text-[10px] text-[#9A7E65] uppercase font-bold tracking-widest">
            Identity Verified per Church Session
          </p>
        </form>
      </div>
    </div>
  );
}
