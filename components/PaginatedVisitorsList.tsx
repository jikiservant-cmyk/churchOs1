'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Pencil, UserCheck } from 'lucide-react';

export default function PaginatedVisitorsList({
  visitors,
  churchSlug,
  error
}: {
  visitors: any[];
  churchSlug: string;
  error: any;
}) {
  const [visibleCount, setVisibleCount] = useState(5);

  if (error) {
    return (
      <div className="p-8 text-center text-[#B5622A] font-bold">
        Failed to load visitors: {error.message}
      </div>
    );
  }

  if (!visitors || visitors.length === 0) {
    return (
      <div className="p-12 text-center flex flex-col items-center justify-center">
        <div className="w-12 h-12 bg-[rgba(90,55,20,0.05)] rounded-full flex items-center justify-center mb-3">
          <UserCheck className="w-6 h-6 text-[#C8B89A]" />
        </div>
        <h3 className="text-[#1E1208] font-bold">No visitors found</h3>
        <p className="text-[#9A7E65] text-sm mt-1">Add your first visitor using the form.</p>
      </div>
    );
  }

  const visibleVisitors = visitors.slice(0, visibleCount);
  const hasMore = visibleCount < visitors.length;

  const getVisitorTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'first_time': 'First Time',
      'returning': 'Returning',
      'guest_from_another_church': 'Guest from Another Church',
      'conference_guest': 'Conference Guest',
      'traveling_member': 'Traveling Member',
      'guest_preacher': 'Guest Preacher'
    };
    return labels[type] || type;
  };

  return (
    <>
      <ul className="divide-y divide-[rgba(90,55,20,0.08)]">
        {visibleVisitors.map((visitor) => (
          <li key={visitor.id} className="p-5 hover:bg-[rgba(90,55,20,0.02)] transition-colors flex items-center justify-between group">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-[rgba(90,55,20,0.1)] text-[#7A4F30] flex items-center justify-center font-bold text-sm border border-[rgba(90,55,20,0.05)]">
                {visitor.full_name?.[0] || '?'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-bold text-[#1E1208]">{visitor.full_name}</p>
                  <span className="px-1.5 py-0.5 rounded-md bg-[rgba(181,98,42,0.12)] text-[#B5622A] text-[10px] uppercase font-bold tracking-wider">
                    {getVisitorTypeLabel(visitor.visitor_type)}
                  </span>
                </div>
                <p className="text-[11px] font-medium text-[#9A7E65] mt-0.5">
                  {visitor.phone_number || visitor.email || 'No contact info'} 
                  {visitor.gender && ` • ${visitor.gender.toUpperCase()}`}
                  {visitor.home_church_name && ` • ${visitor.home_church_name}`}
                </p>
              </div>
            </div>
            <Link 
              href={`/${churchSlug}/admin/visitors/edit/${visitor.id}`}
              className="p-2 text-[#C8B89A] hover:text-[#B5622A] bg-[rgba(90,55,20,0.03)] hover:bg-[rgba(181,98,42,0.1)] rounded-xl transition-all"
              title="Edit Visitor"
            >
              <Pencil className="w-4 h-4" />
            </Link>
          </li>
        ))}
      </ul>
      
      {hasMore && (
        <div className="p-5 text-center border-t border-[rgba(90,55,20,0.08)] bg-white/30 rounded-b-2xl">
          <button 
            onClick={() => setVisibleCount(prev => prev + 10)}
            className="px-6 py-2 bg-[rgba(90,55,20,0.05)] text-[#1E1208] text-sm font-bold rounded-xl hover:bg-[rgba(90,55,20,0.1)] transition-colors"
          >
            See More Visitors ({visitors.length - visibleCount} remaining)
          </button>
        </div>
      )}
    </>
  );
}
