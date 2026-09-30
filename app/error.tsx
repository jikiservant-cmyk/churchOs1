'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[RootErrorBoundary] Caught error:', error);
  }, [error]);

  return (
    <div 
      style={{ fontFamily: "'Outfit', sans-serif" }}
      className="min-h-screen flex items-center justify-center p-6 bg-[#2B1A0E] text-[#F5E6CE]"
    >
      <div className="w-full max-w-md bg-[#F0E6D3] text-[#1E1208] border border-[rgba(90,55,20,0.15)] rounded-2xl p-8 shadow-2xl text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-[#B5622A]/10 border border-[#B5622A]/20 flex items-center justify-center text-[#B5622A]">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 style={{ fontFamily: "'Playfair Display', serif" }} className="text-2xl font-bold mb-2">
          Something went wrong
        </h2>
        <p className="text-sm text-[#9A7E65] mb-6">
          {error?.message || 'An unexpected response was received. Please try again or return to the login screen.'}
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => reset()}
            className="flex-1 py-3 px-4 bg-[#2B1A0E] text-[#F5E6CE] font-bold rounded-xl text-xs uppercase tracking-wider hover:bg-[#3D2614] transition-all shadow-md active:scale-95"
          >
            Try Again
          </button>
          <Link
            href="/"
            className="flex-1 py-3 px-4 bg-[rgba(181,98,42,0.1)] border border-[rgba(181,98,42,0.25)] text-[#B5622A] font-bold rounded-xl text-xs uppercase tracking-wider hover:bg-[rgba(181,98,42,0.15)] transition-all flex items-center justify-center"
          >
            Return Home
          </Link>
        </div>
      </div>
    </div>
  );
}
