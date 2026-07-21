'use client'

import { useEffect, useState } from 'react';

export default function DashboardGreeting({ pastorName }: { pastorName: string }) {
  const [time, setTime] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setTime(new Date());
    // Update time every minute
    const timer = setInterval(() => setTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // During hydration, render a consistent shell
  if (!mounted || !time) {
    return (
      <div className="mb-10 animate-pulse">
        <h2 style={{ fontFamily: "'Playfair Display', serif" }} className="text-3xl font-bold text-[#1E1208] leading-tight">
          Hello, {pastorName === 'Church' ? 'Pastor' : pastorName}
        </h2>
        <p className="text-[13px] text-[#9A7E65] mt-1.5 font-medium">
          Loading dashboard...
        </p>
      </div>
    );
  }

  let greeting = 'Praise God';

  // Calculate days until next Sunday
  const dayOfWeek = time.getDay(); // 0 is Sunday
  const daysUntilSunday = (7 - dayOfWeek) % 7;
  
  let serviceText = '';
  if (daysUntilSunday === 0) {
    serviceText = 'Join us today for service!';
  } else if (daysUntilSunday === 1) {
    serviceText = 'Next service is tomorrow';
  } else {
    serviceText = `Next service in ${daysUntilSunday} days`;
  }

  const formattedDate = time.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div className="mb-10">
      <h2 style={{ fontFamily: "'Playfair Display', serif" }} className="text-3xl font-bold text-[#1E1208] leading-tight">
        {greeting}, {pastorName === 'Church' ? 'Pastor' : pastorName}
      </h2>
      <p className="text-[13px] text-[#9A7E65] mt-1.5 font-medium">
        {formattedDate} · <span className="text-[#B5622A] font-bold">{serviceText}</span>
      </p>
    </div>
  );
}
