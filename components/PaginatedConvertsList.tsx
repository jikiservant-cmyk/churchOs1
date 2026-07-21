'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Pencil, UserPlus } from 'lucide-react';

export default function PaginatedConvertsList({
  converts,
  churchSlug,
  error
}: {
  converts: any[];
  churchSlug: string;
  error: any;
}) {
  const [visibleCount, setVisibleCount] = useState(5);

  if (error) {
    return (
      <div className="p-8 text-center text-[#FF4747] font-bold">
        Failed to load converts: {error.message}
      </div>
    );
  }

  if (!converts || converts.length === 0) {
    return (
      <div className="p-12 text-center flex flex-col items-center justify-center">
        <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mb-3">
          <UserPlus className="w-6 h-6 text-slate-400" />
        </div>
        <h3 className="text-slate-900 font-bold">No new converts yet</h3>
        <p className="text-slate-500 text-sm mt-1">Add your first new convert using the form.</p>
      </div>
    );
  }

  const visibleConverts = converts.slice(0, visibleCount);
  const hasMore = visibleCount < converts.length;

  return (
    <>
      <ul className="divide-y divide-slate-100">
        {visibleConverts.map((c) => (
          <li key={c.id} className="p-5 hover:bg-slate-50 transition-colors flex items-center justify-between group">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-cyan-50 text-cyan-600 flex items-center justify-center font-bold text-sm border border-cyan-100">
                {c.name?.[0] || '?'}
              </div>
              <div>
                <p className="font-bold text-slate-900">{c.name}</p>
                <p className="text-xs font-medium text-slate-500 mt-0.5">{c.contact}</p>
              </div>
            </div>
            <Link 
              href={`/${churchSlug}/admin/new-converts/edit/${c.id}`}
              className="p-2 text-slate-400 hover:text-cyan-600 rounded-lg hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-all"
              title="Edit Convert"
            >
              <Pencil className="w-4 h-4" />
            </Link>
          </li>
        ))}
      </ul>

      {hasMore && (
        <div className="p-5 text-center border-t border-slate-100 bg-white rounded-b-xl">
          <button 
            onClick={() => setVisibleCount(prev => prev + 10)}
            className="px-6 py-2 bg-slate-100 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-200 transition-colors"
          >
            See More Converts ({converts.length - visibleCount} remaining)
          </button>
        </div>
      )}
    </>
  );
}
