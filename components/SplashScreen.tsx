"use client";

import { useEffect, useState } from "react";

export default function SplashScreen() {
  const [showSplash, setShowSplash] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    // Show splash first, then fade it out
    const fadeTimer = setTimeout(() => {
      setFadeOut(true);
    }, 800);

    // Remove from DOM after transition completes
    const removeTimer = setTimeout(() => {
      setShowSplash(false);
    }, 1400); // 800ms + 600ms transition

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  if (!showSplash) return null;

  return (
    <div
      className={`fixed inset-0 flex flex-col items-center justify-center z-[9999] transition-opacity duration-600 ease-in-out bg-[#d6c3a5] ${
        fadeOut ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      style={{
        background: `
          radial-gradient(circle at 20% 30%, rgba(255,255,255,0.4), transparent 40%),
          radial-gradient(circle at 80% 70%, rgba(160,120,80,0.15), transparent 50%),
          linear-gradient(135deg, #e6d3b3, #d6c3a5, #cdb08a)`,
      }}
    >
      <div
        className="w-[70px] h-[70px] mb-3"
        style={{ animation: "float 2.5s ease-in-out infinite" }}
      >
        <svg viewBox="0 0 100 100" fill="none">
          <path
            d="M40 80 V25 C40 15, 60 15, 60 30 C60 45, 40 45, 40 45"
            stroke="#5a3e2b"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              strokeDasharray: 200,
              strokeDashoffset: 200,
              animation: "draw 1.4s ease forwards",
            }}
          />
        </svg>
      </div>
      <h1 className="m-0 text-[26px] text-[#3e2a1f] font-serif font-bold">
        PastorOS
      </h1>
      <p className="mt-[6px] text-[#6b4b35] text-[14px] font-sans">
        Because every name matters.
      </p>
    </div>
  );
}
