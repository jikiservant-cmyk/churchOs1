'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signup, AuthState } from '@/lib/auth-actions';
import { Loader2, UserPlus } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

const initialState: AuthState = {};

export default function SignupPage() {
  const [state, formAction, isPending] = useActionState(signup, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.success && state.redirectTo) {
      router.push(state.redirectTo);
    }
  }, [state, router]);

  return (
    <div 
      style={{ fontFamily: "'Outfit', sans-serif" }}
      className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden bg-[#2B1A0E]"
    >
      <Image
        src="https://images.unsplash.com/photo-1438232992991-995b7058bbb3?q=80&w=2073&auto=format&fit=crop"
        alt="background"
        fill
        className="object-cover opacity-20"
        priority
        referrerPolicy="no-referrer"
      />
      <div className="absolute inset-0 bg-gradient-to-br from-[#2B1A0E]/60 to-[#1E1208]/40" />

      <div className="relative z-10 w-full max-w-sm bg-[#F0E6D3] border border-[rgba(90,55,20,0.15)] rounded-2xl p-10 shadow-2xl transition-all duration-500">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-[#2B1A0E] rounded-xl shadow-lg">
              <UserPlus className="h-6 w-6 text-[#F5E6CE]" />
            </div>
          </div>
          <h1 style={{ fontFamily: "'Playfair Display', serif" }} className="text-3xl font-bold text-[#1E1208] mb-3">Create Account</h1>
          <p className="text-[14px] text-[#9A7E65] font-medium leading-relaxed">Join the pastorOs network</p>
        </div>

        {state.error && (
          <div className="mb-6 p-4 bg-[#B5622A]/10 border border-[#B5622A]/20 rounded-xl text-[#B5622A] text-xs font-bold leading-relaxed uppercase tracking-wider">
            {state.error}
          </div>
        )}

        <form action={formAction} className="space-y-5">
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
            <label className="block text-[10px] font-bold text-[#C8B89A] uppercase tracking-widest">Password</label>
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
            disabled={isPending}
            className="w-full py-4 bg-[#2B1A0E] text-[#F5E6CE] font-bold rounded-xl shadow-lg active:scale-[0.98] transition-all hover:bg-[#3D2614] flex justify-center items-center uppercase tracking-widest text-[12px] mt-4"
          >
            {isPending ? (
              <div className="w-5 h-5 border-2 border-[rgba(245,230,206,0.3)] border-t-[#F5E6CE] rounded-full animate-spin" />
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-[rgba(90,55,20,0.08)] text-center">
          <p className="text-[12px] text-[#9A7E65]">
            Already have an account?{' '}
            <Link href="/admin/login" className="text-[#B5622A] font-bold hover:underline">
              Login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
