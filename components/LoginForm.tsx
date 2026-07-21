'use client';

import Link from 'next/link';
import { login } from '@/lib/auth-actions';
import { useEffect, useState, useActionState, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

export default function LoginForm({ church, churchSlug, error: urlError }: { church: any; churchSlug: string; error?: string }) {
  const router = useRouter();
  const redirected = useRef(false);
  const [mountData, setMountData] = useState<{
    inIframe: boolean;
    particles: { x: number; y: number; duration: number }[];
  }>({
    inIframe: false,
    particles: []
  });
  
  const [state, formAction, pending] = useActionState(login, { error: urlError, success: false });

  useEffect(() => {
    if (state?.success && state?.redirectTo && !redirected.current) {
      redirected.current = true;
      router.replace(state.redirectTo);
      router.refresh();
    }
  }, [state, router]);

  useEffect(() => {
    const isFrame = typeof window !== 'undefined' && window !== window.top;
    const newParticles = Array.from({ length: 18 }).map(() => ({
      x: Math.random() * 1000,
      y: Math.random() * 800,
      duration: 10 + Math.random() * 10
    }));
    
    const raf = requestAnimationFrame(() => {
      setMountData({
        inIframe: isFrame,
        particles: newParticles
      });
    });

    return () => cancelAnimationFrame(raf);
  }, []);

  const displayError = state?.error;
  const isMounted = mountData.particles.length > 0;

  return (
    <div 
      style={{ fontFamily: "'Outfit', sans-serif" }}
      className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden bg-[#2B1A0E]"
    >
      <Image
        src="https://images.unsplash.com/photo-1438232992991-995b7058bbb3?q=80&w=2073&auto=format&fit=crop"
        alt="church background"
        fill
        className="object-cover opacity-20"
        priority
        referrerPolicy="no-referrer"
      />
      <div className="absolute inset-0 bg-gradient-to-br from-[#2B1A0E]/60 to-[#1E1208]/40" />

      <div className="relative z-10 w-full max-w-sm bg-[#F0E6D3] border border-[rgba(90,55,20,0.15)] rounded-2xl p-10 shadow-2xl transition-all duration-500">
        <div className="text-center mb-10">
          <h1 style={{ fontFamily: "'Playfair Display', serif" }} className="text-3xl font-bold text-[#1E1208] mb-3">Welcome back</h1>
          <p className="text-[14px] text-[#9A7E65] font-medium leading-relaxed">pastorOs</p>
        </div>

        {displayError && (
          <div className="mb-8 p-4 bg-[#B5622A]/10 border border-[#B5622A]/20 rounded-xl text-[#B5622A] text-xs font-bold leading-relaxed uppercase tracking-wider">
            {displayError}
          </div>
        )}

        <form action={formAction} className="space-y-5">
          <input type="hidden" name="churchSlug" value={churchSlug} />
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Email Address</label>
            <input
              type="email"
              name="email"
              required
              className="w-full px-4 py-3.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.12)] rounded-xl text-[#1E1208] placeholder:text-[#C8B89A] focus:border-[#B5622A] outline-none transition-all font-medium"
              placeholder="name@email.com"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Password</label>
            </div>
            <input
              type="password"
              name="password"
              required
              className="w-full px-4 py-3.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.12)] rounded-xl text-[#1E1208] placeholder:text-[#C8B89A] focus:border-[#B5622A] outline-none transition-all font-medium"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full py-4 bg-[#2B1A0E] text-[#F5E6CE] font-bold rounded-xl shadow-lg active:scale-[0.98] transition-all hover:bg-[#3D2614] flex justify-center items-center uppercase tracking-widest text-[12px] mt-4"
          >
            {pending ? <div className="w-5 h-5 border-2 border-[rgba(245,230,206,0.3)] border-t-[#F5E6CE] rounded-full animate-spin" /> : 'Enter Portal'}
          </button>
          <div className="text-center mt-6 pt-4 border-t border-[rgba(90,55,20,0.08)]">
            <p className="text-[11px] text-[#9A7E65] mb-3 uppercase tracking-widest font-bold opacity-60">New to the family?</p>
            <Link 
              href="/signup" 
              className="inline-block w-full py-3 px-6 bg-[rgba(181,98,42,0.08)] border border-[rgba(181,98,42,0.2)] text-[#B5622A] text-[11px] font-bold uppercase tracking-widest rounded-xl hover:bg-[rgba(181,98,42,0.12)] transition-all"
            >
              Request Access / Sign Up
            </Link>
          </div>
        </form>

        <div className="mt-8 pt-4 text-center">
            <p className="text-[11px] text-[#C8B89A] font-medium italic">
                &quot;Grace and peace be yours in abundance&quot;
            </p>
        </div>
      </div>
    </div>
  );
}
