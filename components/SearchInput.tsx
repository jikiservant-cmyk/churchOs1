'use client';

import { Search } from 'lucide-react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTransition, useState, useEffect } from 'react';

export default function SearchInput({ placeholder = 'Search...' }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(searchParams.get('q') || '');

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      startTransition(() => {
        const params = new URLSearchParams(searchParams);
        if (query) {
          params.set('q', query);
        } else {
          params.delete('q');
        }
        router.push(`${pathname}?${params.toString()}`);
      });
    }, 400);

    return () => clearTimeout(delayDebounceFn);
  }, [query, pathname, router, searchParams]);

  return (
    <div className="relative flex-1">
      <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9A7E65] ${isPending ? 'opacity-50' : ''}`} />
      <input 
        type="text" 
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder} 
        className="w-full pl-9 pr-4 py-2.5 bg-[rgba(255,220,170,0.05)] border border-[rgba(90,55,20,0.1)] focus:border-[#B5622A] rounded-xl text-sm outline-none transition-colors font-medium text-[#1E1208] placeholder:text-[#C8B89A]"
      />
    </div>
  );
}
