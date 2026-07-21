'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { provisionTenant, ProvisionState } from '@/lib/provision-actions';
import { Church, Loader2, Rocket, ArrowRight, ArrowLeft } from 'lucide-react';
import Image from 'next/image';

const initialState: ProvisionState = {};

export default function ProvisionPage() {
  const [state, formAction, isPending] = useActionState(provisionTenant, initialState);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const router = useRouter();

  useEffect(() => {
    if (state.success && state.slug) {
      router.push(`/${state.slug}/admin`);
    }
  }, [state, router]);

  const updateSlug = (val: string) => {
    setName(val);
    setSlug(val.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''));
  };

  return (
    <div 
      style={{ fontFamily: "'Outfit', sans-serif" }}
      className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden bg-[#2B1A0E]"
    >
      <Image
        src="https://images.unsplash.com/photo-1490730141103-6cac27aaab94?q=80&w=2070&auto=format&fit=crop"
        alt="background"
        fill
        className="object-cover opacity-20"
        priority
        referrerPolicy="no-referrer"
      />
      <div className="absolute inset-0 bg-gradient-to-br from-[#2B1A0E]/60 to-[#1E1208]/40" />

      <div className="relative z-10 w-full max-w-lg bg-[#F0E6D3] border border-[rgba(90,55,20,0.15)] rounded-2xl p-10 shadow-2xl transition-all duration-500">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-[#2B1A0E] rounded-xl shadow-lg">
              <Rocket className="h-6 w-6 text-[#F5E6CE]" />
            </div>
          </div>
          <h1 style={{ fontFamily: "'Playfair Display', serif" }} className="text-3xl font-bold text-[#1E1208] mb-3">Launch Your Church</h1>
          <p className="text-[14px] text-[#9A7E65] font-medium leading-relaxed">Let&apos;s set up your ministry portal</p>
        </div>

        {state.error && (
          <div className="mb-6 p-4 bg-[#B5622A]/10 border border-[#B5622A]/20 rounded-xl text-[#B5622A] text-xs font-bold leading-relaxed uppercase tracking-wider">
            {state.error}
          </div>
        )}

        <form action={formAction} className="space-y-6">
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">
                Church Name
              </label>
              <input
                type="text"
                name="name"
                value={name}
                onChange={(e) => updateSlug(e.target.value)}
                required
                className="w-full px-4 py-3.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.12)] rounded-xl text-[#1E1208] placeholder:text-[#C8B89A] focus:border-[#B5622A] outline-none transition-all font-medium"
                placeholder="e.g. Grace Fellowship"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Custom URL (Slug)</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[12px] font-medium text-[#C8B89A]">/</span>
                <input
                  type="text"
                  name="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  required
                  className="w-full pl-7 pr-4 py-3.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.12)] rounded-xl text-[#1E1208] focus:border-[#B5622A] outline-none transition-all font-medium text-[13px]"
                />
              </div>
              <p className="text-[10px] text-[#9A7E65] italic tracking-wide">This will be your workspace address</p>
            </div>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full py-4 bg-[#B5622A] text-white font-bold rounded-xl shadow-lg active:scale-[0.98] transition-all hover:bg-[#C6733B] flex justify-center items-center uppercase tracking-widest text-[12px] mt-6 gap-2"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Finish Setup
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
